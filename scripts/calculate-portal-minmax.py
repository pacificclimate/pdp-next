#!/usr/bin/env python3
"""
Compute portal NetCDF min/max values, DB-first, netCDF4 fallback.

For each candidate file (selected via portal pattern files), we first look
the filename up in a CSV export of the data_file_variables/data_files/
variable_aliases/ensembles join (see min_max_query.sql). If the DB already
has usable range_min/range_max for that filename, we reuse it -- no file
read needed. Only files with no usable DB row get scanned, and that scan
is done with netCDF4 + numpy directly (no CDO subprocess), reading in
memory-bounded chunks and reducing with numpy's C-level min/max.

Usage:
    python3 scripts/calculate-portal-minmax.py [--db-csv db_export.csv]
"""

from __future__ import annotations

import argparse
import csv
import fnmatch
import glob
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

import numpy as np
from netCDF4 import Dataset

REPO_ROOT = Path(__file__).resolve().parent.parent
RowKey = Tuple[str, str]
MinMaxResult = Tuple[str, float, float]
DbRecord = Tuple[str, float, float, bool, str]
DbLookup = Tuple[Dict[str, List[DbRecord]], Dict[str, List[DbRecord]]]


# ---------------------------------------------------------------------------
# DB export lookup
# ---------------------------------------------------------------------------


def load_db_lookup(path: Path) -> DbLookup:
    """Build exact-path and basename indexes for usable database ranges.

    from the reduced data_file_variables/data_files export produced by
    min_max_query.sql. Rows with a missing/NULL range_min or range_max are
    skipped -- those still need computing.
    """
    exact_lookup: Dict[str, List[DbRecord]] = defaultdict(list)
    basename_lookup: Dict[str, List[DbRecord]] = defaultdict(list)

    def is_missing(value: Optional[str]) -> bool:
        return value is None or value.strip() == "" or value.strip().upper() == "NULL"

    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)

        required = {
            "filename",
            "netcdf_variable_name",
            "range_min",
            "range_max",
            "ensemble_name",
        }
        missing_cols = required - set(reader.fieldnames or [])
        if missing_cols:
            raise ValueError(
                f"--db-csv is missing expected column(s): {sorted(missing_cols)}"
            )

        for row in reader:
            filename = (row.get("filename") or "").strip()
            variable_name = (row.get("netcdf_variable_name") or "").strip()
            ensemble_name = (row.get("ensemble_name") or "").strip().lower()

            if not filename or not variable_name or not ensemble_name:
                continue

            if is_missing(row.get("range_min")) or is_missing(row.get("range_max")):
                continue

            try:
                range_min = float(row["range_min"])
                range_max = float(row["range_max"])
            except ValueError:
                continue

            disabled_raw = (row.get("disabled") or "").strip().lower()
            disabled = disabled_raw in ("true", "t", "1")

            record = (
                variable_name,
                range_min,
                range_max,
                disabled,
                ensemble_name,
            )
            if record not in exact_lookup[filename]:
                exact_lookup[filename].append(record)
            basename = Path(filename).name
            if record not in basename_lookup[basename]:
                basename_lookup[basename].append(record)

    return dict(exact_lookup), dict(basename_lookup)


def select_db_record(
    source: Path,
    lookup: DbLookup,
    include_disabled: bool,
) -> Optional[DbRecord]:
    """Return one unambiguous DB range for a portal source file.

    Exact source paths take precedence. Basename matching supports portal
    mirrors and moved source trees. A file containing multiple data variables
    requires a cheap NetCDF header read so the selected DB variable agrees
    with the portal metadata builder's primary-variable selection.
    """
    exact_lookup, basename_lookup = lookup
    entries = exact_lookup.get(str(source)) or basename_lookup.get(source.name) or []
    usable = [entry for entry in entries if include_disabled or not entry[3]]
    if not usable:
        return None

    variable_names = {entry[0].lower() for entry in usable}
    if len(variable_names) > 1:
        try:
            with Dataset(source, mode="r") as dataset:
                primary = choose_primary_variable(dataset)
        except Exception:
            return None
        if not primary:
            return None
        usable = [entry for entry in usable if entry[0].lower() == primary.lower()]

    # Basename collisions or inconsistent duplicate rows are unsafe to guess.
    distinct = {(entry[0].lower(), entry[1], entry[2]) for entry in usable}
    if len(distinct) != 1:
        return None
    return usable[0]


# ---------------------------------------------------------------------------
# Portal pattern handling
# ---------------------------------------------------------------------------


def read_portals(path: Path) -> Tuple[List[str], List[str]]:
    includes: List[str] = []
    excludes: List[str] = []

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()

        if not line or line.startswith("#"):
            continue

        if line.startswith("!"):
            excludes.append(line[1:].strip())
        else:
            includes.append(line)

    return includes, excludes


def expand_globs(
    includes: Iterable[str],
    excludes: Iterable[str],
) -> List[Path]:
    files: List[Path] = []

    for selector in includes:
        if any(ch in selector for ch in ("*", "?", "[")):
            files.extend(Path(p) for p in glob.glob(selector, recursive=True))
        else:
            files.append(Path(selector))

    unique_files: List[Path] = []
    seen: Set[str] = set()

    for path in files:
        source = str(path)

        if source in seen:
            continue

        seen.add(source)

        if path.exists() and path.is_file():
            unique_files.append(path)

    output: List[Path] = []

    for path in unique_files:
        source = str(path)

        if any(fnmatch.fnmatch(source, pattern) for pattern in excludes):
            continue

        output.append(path)

    return sorted(output, key=lambda path: str(path).lower())


def choose_primary_variable(dataset: Dataset) -> Optional[str]:
    coordinate_names = {
        "time",
        "lat",
        "latitude",
        "lon",
        "longitude",
        "bnds",
        "climatology_bnds",
        "height",
    }

    candidates: List[str] = []

    for name, variable in dataset.variables.items():
        if name.lower() in coordinate_names:
            continue

        dimensions = [
            dimension.lower() for dimension in getattr(variable, "dimensions", ())
        ]

        if len(dimensions) < 2:
            continue

        has_latitude = any(dimension in ("lat", "latitude") for dimension in dimensions)
        has_longitude = any(
            dimension in ("lon", "longitude") for dimension in dimensions
        )

        if has_latitude and has_longitude:
            candidates.append(name)

    if candidates:
        return candidates[0]

    for name, variable in dataset.variables.items():
        if getattr(variable, "ndim", 0) >= 2 and name.lower() not in coordinate_names:
            return name

    return None


# ---------------------------------------------------------------------------
# netCDF4 min/max scan
# ---------------------------------------------------------------------------


def _chunked_min_max(variable, max_chunk_bytes: int) -> Tuple[float, float]:
    """Stream the variable's leading dimension in memory-bounded chunks and
    reduce with numpy's C-level min/max. Respects netCDF4's auto-mask, so
    _FillValue/missing_value cells are excluded from the result."""

    shape = variable.shape

    if len(shape) == 0:
        data = variable[...]
        if np.ma.isMaskedArray(data):
            data = data.compressed()
        if data.size == 0:
            raise ValueError("variable has no unmasked data")
        return float(data.min()), float(data.max())

    outer_dim = shape[0]
    per_slice_elems = 1
    for size in shape[1:]:
        per_slice_elems *= size

    # Packed variables may be expanded by netCDF4 during auto-scaling. Budget
    # for float64 even when their on-disk dtype is smaller.
    itemsize = max(
        8,
        variable.dtype.itemsize if hasattr(variable.dtype, "itemsize") else 8,
    )
    per_slice_bytes = max(1, per_slice_elems * itemsize)
    chunk_len = max(1, max_chunk_bytes // per_slice_bytes)

    current_min: Optional[float] = None
    current_max: Optional[float] = None

    for start in range(0, outer_dim, chunk_len):
        end = min(start + chunk_len, outer_dim)
        block = variable[start:end, ...]

        if np.ma.isMaskedArray(block):
            if block.mask is np.ma.nomask:
                block_data = block.data
                if block_data.size == 0:
                    continue
                block_min = block_data.min()
                block_max = block_data.max()
            else:
                compressed = block.compressed()
                if compressed.size == 0:
                    continue
                block_min = compressed.min()
                block_max = compressed.max()
        else:
            if block.size == 0:
                continue
            block_min = block.min()
            block_max = block.max()

        block_min = float(block_min)
        block_max = float(block_max)

        if not np.isfinite(block_min) or not np.isfinite(block_max):
            # fall back to nan-aware reduction only for this chunk
            finite = (
                block[np.isfinite(block)]
                if not np.ma.isMaskedArray(block)
                else block.compressed()
            )
            finite = np.asarray(finite)
            finite = finite[np.isfinite(finite)]
            if finite.size == 0:
                continue
            block_min = float(finite.min())
            block_max = float(finite.max())

        if current_min is None or block_min < current_min:
            current_min = block_min
        if current_max is None or block_max > current_max:
            current_max = block_max

    if current_min is None or current_max is None:
        raise ValueError("no valid (unmasked, finite) data found")

    return current_min, current_max


def netcdf4_min_max_for_file(
    path: Path,
    max_chunk_bytes: int,
    trust_metadata_range: bool,
) -> MinMaxResult:
    with Dataset(path, mode="r") as dataset:
        variable_name = choose_primary_variable(dataset)

        if not variable_name:
            raise ValueError("no suitable primary variable found")

        variable = dataset.variables[variable_name]

        if trust_metadata_range:
            for attr_name in ("actual_range", "valid_range"):
                if attr_name in variable.ncattrs():
                    values = np.atleast_1d(variable.getncattr(attr_name))
                    if values.size == 2:
                        return variable_name, float(values[0]), float(values[1])

            has_min = "valid_min" in variable.ncattrs()
            has_max = "valid_max" in variable.ncattrs()
            if has_min and has_max:
                return (
                    variable_name,
                    float(variable.getncattr("valid_min")),
                    float(variable.getncattr("valid_max")),
                )

        minimum, maximum = _chunked_min_max(variable, max_chunk_bytes)

    return variable_name, minimum, maximum


# ---------------------------------------------------------------------------
# Output CSV handling (extended with a `source` column)
# ---------------------------------------------------------------------------


def load_existing_rows(path: Path) -> Dict[RowKey, List[str]]:
    if not path.exists():
        return {}

    rows: Dict[RowKey, List[str]] = {}

    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)

        for row in reader:
            if len(row) < 5:
                continue

            portal_id = str(row[0] or "").strip()
            source_path = str(row[1] or "").strip()

            if portal_id and source_path:
                rows[(portal_id, source_path)] = row

    return rows


def write_rows(path: Path, rows: Dict[RowKey, List[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")

    with temporary_path.open(
        "w",
        encoding="utf-8",
        newline="",
    ) as handle:
        writer = csv.writer(handle)

        for key in sorted(rows):
            writer.writerow(rows[key])

    temporary_path.replace(path)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Compute portal NetCDF min/max values: reuse the DB export "
            "wherever a filename already has values there, and scan with "
            "netCDF4 + numpy (no CDO) only for files the DB doesn't know "
            "about."
        )
    )
    parser.add_argument(
        "--db-csv",
        help=(
            "CSV export produced by portal-prep/min_max_query.sql. "
            "Used to skip scanning "
            "filenames that already have range_min/range_max."
        ),
        default=str(REPO_ROOT / "portal-prep" / "db-export.csv"),
    )
    parser.add_argument(
        "--portal",
        action="append",
        help="portal id(s), e.g. canada_mosaic",
    )
    parser.add_argument(
        "--portals-dir",
        default=str(REPO_ROOT / "portal-prep" / "portal-file-patterns"),
    )
    parser.add_argument(
        "--out-csv",
        default=str(REPO_ROOT / "portal-prep" / "pdp_min_max.csv"),
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="refresh all rows from the DB or a scan instead of skipping existing rows",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="number of NetCDF files scanned concurrently (default: 1)",
    )
    parser.add_argument(
        "--include-disabled",
        action="store_true",
        help=(
            "By default, DB rows with disabled=True are ignored (treated "
            "as if the DB doesn't have them, so they get rescanned). Pass "
            "this flag to trust disabled DB rows too."
        ),
    )
    parser.add_argument(
        "--max-chunk-mb",
        type=int,
        default=256,
        help=(
            "Memory budget per read chunk when scanning a file, in MB "
            "(default: 256). Larger = fewer, bigger reads (usually "
            "faster up to a point); smaller = lower peak memory."
        ),
    )
    parser.add_argument(
        "--trust-metadata-range",
        action="store_true",
        help=(
            "If the variable carries actual_range/valid_range/valid_min+"
            "valid_max attributes, use them directly instead of scanning "
            "the data. Fast, but only as accurate as those attributes -- "
            "off by default because valid_range is sometimes a QC bound "
            "rather than the true data range."
        ),
    )
    args = parser.parse_args()

    if args.workers <= 0:
        parser.error("--workers must be greater than zero")
    if args.max_chunk_mb <= 0:
        parser.error("--max-chunk-mb must be greater than zero")

    max_chunk_bytes = args.max_chunk_mb * 1024 * 1024

    db_csv_path = Path(args.db_csv).resolve()
    db_lookup = load_db_lookup(db_csv_path)
    print(
        f"Loaded DB export: {len(db_lookup[0])} unique paths, "
        f"{len(db_lookup[1])} unique basenames",
        flush=True,
    )

    portals_dir = Path(args.portals_dir).resolve()
    out_csv = Path(args.out_csv).resolve()

    portals = [portal for portal in (args.portal or []) if portal]

    if not portals:
        portals = sorted(path.stem for path in portals_dir.glob("*.txt"))

    existing = load_existing_rows(out_csv)
    rows: Dict[RowKey, List[str]] = {} if args.all else dict(existing)

    # Group portal/file pairs by source file, so a file referenced by
    # multiple portals is only scanned once.
    pending_by_source: Dict[str, List[str]] = {}
    candidate_pairs = 0
    skipped_pairs = 0
    db_hits = 0

    for portal_id in portals:
        selector_file = portals_dir / f"{portal_id}.txt"

        if not selector_file.exists():
            print(
                f"{portal_id}: missing portal pattern file, skipped",
                flush=True,
            )
            continue

        includes, excludes = read_portals(selector_file)
        files = expand_globs(includes, excludes)

        for source in files:
            candidate_pairs += 1
            source_path = str(source)
            key = (portal_id, source_path)

            if not args.all and key in rows:
                skipped_pairs += 1
                continue

            # --- DB-first check -------------------------------------------
            db_record = select_db_record(
                source,
                db_lookup,
                args.include_disabled,
            )

            if db_record:
                variable_name, minimum, maximum, _disabled, ensemble_name = db_record
                rows[key] = [
                    portal_id,
                    source_path,
                    variable_name,
                    f"{minimum:.8g}",
                    f"{maximum:.8g}",
                    f"db:{ensemble_name}",
                ]
                db_hits += 1
                continue

            # Not in the DB (or only disabled rows) -- queue for a scan.
            pending_by_source.setdefault(source_path, []).append(portal_id)

    total_unique_files = len(pending_by_source)

    print(
        f"Starting: portals={len(portals)} "
        f"candidate_pairs={candidate_pairs} "
        f"skipped_existing={skipped_pairs} "
        f"filled_from_db={db_hits} "
        f"unique_files_to_scan={total_unique_files} "
        f"workers={args.workers} "
        f"existing_rows={len(rows)}",
        flush=True,
    )

    if total_unique_files == 0:
        write_rows(out_csv, rows)
        print(
            f"Finished: scanned=0 failed=0 total_rows={len(rows)}",
            flush=True,
        )
        return 0

    completed_count = 0
    added_rows = 0
    failed_files = 0

    # ProcessPoolExecutor, not threads: the numpy/HDF5 decompression work
    # here is CPU-bound, so separate processes give real parallelism
    # instead of fighting over the GIL.
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = {}

        for source_path in pending_by_source:
            print(f"QUEUE: {source_path}", flush=True)
            future = executor.submit(
                netcdf4_min_max_for_file,
                Path(source_path),
                max_chunk_bytes,
                args.trust_metadata_range,
            )
            futures[future] = source_path

        for future in as_completed(futures):
            source_path = futures[future]
            completed_count += 1

            try:
                variable_name, minimum, maximum = future.result()

                for portal_id in pending_by_source[source_path]:
                    key = (portal_id, source_path)
                    rows[key] = [
                        portal_id,
                        source_path,
                        variable_name,
                        f"{minimum:.8g}",
                        f"{maximum:.8g}",
                        "computed",
                    ]
                    added_rows += 1

                write_rows(out_csv, rows)

                print(
                    f"[{completed_count}/{total_unique_files}] "
                    f"DONE {Path(source_path).name}: "
                    f"{variable_name} "
                    f"min={minimum:.8g} "
                    f"max={maximum:.8g} "
                    f"rows_added={len(pending_by_source[source_path])} "
                    f"saved_rows={len(rows)}",
                    flush=True,
                )

            except Exception as exc:
                failed_files += 1
                print(
                    f"[{completed_count}/{total_unique_files}] "
                    f"FAILED {source_path}: "
                    f"{type(exc).__name__}: {exc}",
                    flush=True,
                )

    write_rows(out_csv, rows)

    print(
        f"Finished: scanned={total_unique_files} "
        f"rows_added={added_rows} "
        f"filled_from_db={db_hits} "
        f"failed_files={failed_files} "
        f"total_rows={len(rows)}",
        flush=True,
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
