#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import fnmatch
import glob
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

import numpy as np
from netCDF4 import Dataset


REPO_ROOT = Path(__file__).resolve().parent.parent


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


def expand_globs(includes: Iterable[str], excludes: Iterable[str]) -> List[Path]:
    files: List[Path] = []
    for selector in includes:
        if any(ch in selector for ch in ["*", "?", "["]):
            files.extend(Path(p) for p in glob.glob(selector, recursive=True))
        else:
            files.append(Path(selector))

    uniq: List[Path] = []
    seen: Set[str] = set()
    for p in files:
        key = str(p)
        if key in seen:
            continue
        seen.add(key)
        if p.exists() and p.is_file():
            uniq.append(p)

    out: List[Path] = []
    for p in uniq:
        source = str(p)
        if any(fnmatch.fnmatch(source, ex) for ex in excludes):
            continue
        out.append(p)
    return sorted(out, key=lambda p: p.name.lower())


def choose_primary_variable(ds: Dataset) -> Optional[str]:
    coord = {"time", "lat", "latitude", "lon", "longitude", "bnds", "climatology_bnds", "height"}
    candidates: List[str] = []
    for name, variable in ds.variables.items():
        if name.lower() in coord:
            continue
        dims = [d.lower() for d in getattr(variable, "dimensions", ())]
        if len(dims) < 2:
            continue
        has_lat = any(d in ("lat", "latitude") for d in dims)
        has_lon = any(d in ("lon", "longitude") for d in dims)
        if has_lat and has_lon:
            candidates.append(name)
    if candidates:
        return candidates[0]
    for name, variable in ds.variables.items():
        if getattr(variable, "ndim", 0) >= 2 and name.lower() not in coord:
            return name
    return None


def min_max_for_file(path: Path) -> Optional[Tuple[str, float, float]]:
    with Dataset(path) as ds:
        var_name = choose_primary_variable(ds)
        if not var_name or var_name not in ds.variables:
            return None
        variable = ds.variables[var_name]
        data = variable[:]
        fill = getattr(variable, "_FillValue", None)
        missing = getattr(variable, "missing_value", None)
        arr = np.array(data, dtype="float64")
        mask = ~np.isfinite(arr)
        if fill is not None:
            mask |= arr == float(fill)
        if missing is not None:
            try:
                mask |= arr == float(missing)
            except Exception:
                pass
        valid = arr[~mask]
        if valid.size == 0:
            return None
        return var_name, float(np.min(valid)), float(np.max(valid))


def load_existing_rows(path: Path) -> Dict[str, List[str]]:
    if not path.exists():
        return {}
    out: Dict[str, List[str]] = {}
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        for row in reader:
            if len(row) < 5:
                continue
            source = str(row[1] or "").strip()
            if source:
                out[source] = row
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Compute min/max for portal file-pattern definitions.")
    parser.add_argument("--portal", action="append", help="portal id(s), e.g. canada_mosaic")
    parser.add_argument("--portals-dir", default=str(REPO_ROOT / "portal-prep" / "portal-file-patterns"))
    parser.add_argument("--out-csv", default=str(REPO_ROOT / "portal-prep" / "pdp_min_max.csv"))
    parser.add_argument("--all", action="store_true", help="recompute all files, not just missing rows")
    args = parser.parse_args()

    portals_dir = Path(args.portals_dir).resolve()
    out_csv = Path(args.out_csv).resolve()
    portals = [p for p in (args.portal or []) if p]
    if not portals:
        portals = sorted(p.stem for p in portals_dir.glob("*.txt"))

    existing = load_existing_rows(out_csv)
    rows: Dict[str, List[str]] = {} if args.all else dict(existing)

    processed = 0
    added = 0
    failed = 0

    for portal_id in portals:
        selector_file = portals_dir / f"{portal_id}.txt"
        if not selector_file.exists():
            print(f"{portal_id}: missing portal pattern file, skipped")
            continue
        includes, excludes = read_portals(selector_file)
        files = expand_globs(includes, excludes)
        for src in files:
            source_path = str(src)
            if (not args.all) and source_path in rows:
                continue
            processed += 1
            try:
                result = min_max_for_file(src)
                if not result:
                    failed += 1
                    continue
                var_name, min_value, max_value = result
                rows[source_path] = [portal_id, source_path, var_name, f"{min_value:.8g}", f"{max_value:.8g}"]
                added += 1
            except Exception:
                failed += 1

    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with out_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        for source in sorted(rows.keys()):
            writer.writerow(rows[source])

    print(f"portals={len(portals)} processed={processed} added_or_updated={added} failed={failed} total_rows={len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

