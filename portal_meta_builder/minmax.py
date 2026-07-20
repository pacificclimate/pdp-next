from __future__ import annotations

import csv
from pathlib import Path
from typing import Any, Dict, List, Optional


def parse_float_safe(value: str) -> Optional[float]:
    try:
        parsed = float(str(value).strip())
    except Exception:
        return None
    if not (parsed == parsed):
        return None
    return parsed


def is_precip_variable(var_name: str) -> bool:
    value = str(var_name or "").strip().lower()
    return value in {"pr", "ppt", "prec", "precip", "precipitation", "rainf"}


def looks_like_netcdf_ref(value: str) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    lowered = text.lower()
    return lowered.endswith(".nc") or lowered.endswith(".nc4") or "/" in text


def load_minmax_csv(path: Path) -> Dict[str, List[Dict[str, Any]]]:
    if not path.exists():
        return {}

    out: Dict[str, List[Dict[str, Any]]] = {}
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        for row in reader:
            if len(row) < 4:
                continue

            source_path = ""
            var_name = ""
            min_value: Optional[float] = None
            max_value: Optional[float] = None

            if len(row) >= 5 and looks_like_netcdf_ref(row[1]):
                source_path = str(row[1] or "").strip()
                var_name = str(row[2] or "").strip()
                min_value = parse_float_safe(row[3])
                max_value = parse_float_safe(row[4])
            elif len(row) >= 4 and looks_like_netcdf_ref(row[0]):
                source_path = str(row[0] or "").strip()
                var_name = str(row[1] or "").strip()
                min_value = parse_float_safe(row[2])
                max_value = parse_float_safe(row[3])
            elif len(row) >= 5:
                source_path = str(row[1] or "").strip()
                var_name = str(row[2] or "").strip()
                min_value = parse_float_safe(row[3])
                max_value = parse_float_safe(row[4])
            else:
                continue

            if not source_path or min_value is None or max_value is None:
                continue

            ensemble = str(row[0] or "").strip()
            record = {
                "min": min_value,
                "max": max_value,
                "variable": var_name,
                "logScale": is_precip_variable(var_name),
                "source": str(path.name),
                "ensemble": ensemble,
            }
            out.setdefault(source_path, []).append(record)
            out.setdefault(Path(source_path).name, []).append(record)
    return out


def select_minmax_record(
    lookup: Dict[str, List[Dict[str, Any]]],
    source_key: str,
    basename: str,
    portal_id: str,
) -> Optional[Dict[str, Any]]:
    candidates = list(lookup.get(source_key, [])) + list(lookup.get(basename, []))
    if not candidates:
        return None

    wanted = str(portal_id or "").strip().lower()
    for record in candidates:
        ensemble = str(record.get("ensemble") or "").strip().lower()
        if ensemble and ensemble == wanted:
            return record
    return candidates[0]

