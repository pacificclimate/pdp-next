from __future__ import annotations

import csv
import fnmatch
import re
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
from pathlib import Path
from typing import Any, Dict, List, Optional

from .portals import get_portal_config


def parse_float_safe(value: str) -> Optional[float]:
    try:
        parsed = float(str(value).strip())
    except Exception:
        return None
    if not (parsed == parsed):
        return None
    return parsed


LOG_VARIABLE_PATTERNS = {
    "precip": ("pr", "ppt", "prec", "precip", "precipitation", "prsn"),
    "rain": ("rainf", "rain", "rainfall"),
    "snow": ("snowf", "snowfall", "snow_melt", "swe"),
    "wind_speed": ("wind", "wind_speed", "windspeed", "sfcwind", "wspd"),
}
LOG_MIN_FALLBACK = {
    "precip": 1e-7,  # About 0.01 mm/day in kg m-2 s-1.
    "rain": 1e-7,
    "snow": 1e-7,
    "wind_speed": 0.01,  # m/s.
}
GENERIC_LOG_MIN_FALLBACK = 0.01


def variable_class(var_name: str) -> Optional[str]:
    value = str(var_name or "").strip().lower()
    for class_name, patterns in LOG_VARIABLE_PATTERNS.items():
        if any(fnmatch.fnmatchcase(value, pattern) for pattern in patterns):
            return class_name
    return None


def is_mm_equivalent_unit(units: str) -> bool:
    value = " ".join(str(units or "").strip().lower().split())
    # A daily water mass flux has the same numeric value as mm/day.
    return bool(re.fullmatch(r"(?:mm|millimeters?|millimetres?)(?:[/ ](?:d|day)(?:-1)?)?", value)) or value in {
        "kg m-2 d-1", "kg m-2 day-1", "kg/m2/day", "kg m^-2 d^-1",
    }


def rendering_defaults(record: Dict[str, Any], portal_id: str, metadata: Dict[str, Any], basename: str) -> Dict[str, Any]:
    result = {key: value for key, value in record.items() if key != "logScale"}
    class_name = variable_class(result.get("variable"))
    result["scaleType"] = "log" if class_name else "linear"
    units = (metadata.get("primary") or {}).get("units") if isinstance(metadata, dict) else None
    mm_precip = class_name in {"precip", "rain", "snow"} and is_mm_equivalent_unit(units)
    if class_name and result["min"] <= 0:
        fallback = LOG_MIN_FALLBACK[class_name]
        result["suggestedMin"] = max(fallback, 0.01) if mm_precip else fallback
    elif mm_precip and result["min"] < 0.01:
        result["suggestedMin"] = 0.01
    portal_overrides = get_portal_config(portal_id).get("renderingOverrides", {})
    overrides = {**portal_overrides.get("*", {}), **portal_overrides.get(class_name, {})}
    result.update({
        key: value for key, value in overrides.items()
        if key in {"scaleType", "suggestedMax"}
    })
    if result["scaleType"] == "linear" and "suggestedMin" not in overrides:
        result.pop("suggestedMin", None)
    elif result["scaleType"] == "log" and result["min"] <= 0 and "suggestedMin" not in result:
        result["suggestedMin"] = LOG_MIN_FALLBACK.get(class_name, GENERIC_LOG_MIN_FALLBACK)
    suggested_min = overrides.get("suggestedMin")
    if isinstance(suggested_min, dict):
        time_count = (metadata.get("time") or {}).get("count") if isinstance(metadata, dict) else None
        annual = "_aclim" in basename.lower() or "annual" in basename.lower() or time_count == 1
        result["suggestedMin"] = suggested_min["annual" if annual else "other"]
    elif suggested_min is not None:
        result["suggestedMin"] = suggested_min
    elif result["scaleType"] == "log" and overrides.get("logMinFloor") is not None:
        floor = float(overrides["logMinFloor"])
        if floor <= 0:
            raise ValueError("logMinFloor must be greater than zero")
        base_min = result["min"] if result["min"] > 0 else LOG_MIN_FALLBACK.get(class_name, GENERIC_LOG_MIN_FALLBACK)
        result["suggestedMin"] = max(base_min, floor)

    places = overrides.get("rangeDecimalPlaces")
    if places is not None:
        if type(places) is not int or not 0 <= places <= 12:
            raise ValueError("rangeDecimalPlaces must be an integer from 0 to 12")
        result["rangeDecimalPlaces"] = places
        quantum = Decimal(1).scaleb(-places)
        if "suggestedMin" not in overrides:
            minimum = Decimal(str(result.get("suggestedMin", result["min"])))
            rounded = minimum.quantize(quantum, rounding=ROUND_FLOOR)
            if result["scaleType"] == "log" and rounded <= 0:
                rounded = quantum
            result["suggestedMin"] = float(rounded)
        if "suggestedMax" not in overrides:
            maximum = Decimal(str(result["max"]))
            result["suggestedMax"] = float(maximum.quantize(quantum, rounding=ROUND_CEILING))
    return result


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

