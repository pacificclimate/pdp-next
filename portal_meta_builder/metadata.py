from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from netCDF4 import Dataset, num2date


SCENARIO_LABELS_FROM_SSP: Dict[str, str] = {
    "historical,ssp126": "historical,rcp26",
    "historical,ssp245": "historical,rcp45",
    "historical,ssp585": "historical,rcp85",
    "historical+ssp126": "historical,rcp26",
    "historical+ssp245": "historical,rcp45",
    "historical+ssp585": "historical,rcp85",
}

SCENARIO_LABELS_FROM_RCP: Dict[str, str] = {
    "historical,rcp26": "historical,rcp26",
    "historical,rcp45": "historical,rcp45",
    "historical,rcp85": "historical,rcp85",
    "historical+rcp26": "historical,rcp26",
    "historical+rcp45": "historical,rcp45",
    "historical+rcp85": "historical,rcp85",
}

SCENARIO_LABELS_FROM_SSP_U6: Dict[str, str] = {
    "historical,ssp126": "Historical, SSP1-2.6",
    "historical,ssp245": "Historical, SSP2-4.5",
    "historical,ssp370": "Historical, SSP3-7.0",
    "historical,ssp585": "Historical, SSP5-8.5",
    "historical+ssp126": "Historical, SSP1-2.6",
    "historical+ssp245": "Historical, SSP2-4.5",
    "historical+ssp370": "Historical, SSP3-7.0",
    "historical+ssp585": "Historical, SSP5-8.5",
}


def parse_year(value: str) -> Optional[int]:
    if not value:
        return None
    match = re.search(r"(\d{4})", str(value))
    if not match:
        return None
    return int(match.group(1))


def choose_primary_variable(ds: Dataset) -> Optional[str]:
    coord_names = {
        "time",
        "lat",
        "latitude",
        "lon",
        "longitude",
        "bnds",
        "climatology_bnds",
        "climatology_bounds",
        "height",
    }
    candidates: List[str] = []
    for name, variable in ds.variables.items():
        lower_name = name.lower()
        if lower_name in coord_names:
            continue
        dims = [dimension.lower() for dimension in getattr(variable, "dimensions", ())]
        if len(dims) < 2:
            continue
        has_lat = any(dimension in ("lat", "latitude") for dimension in dims)
        has_lon = any(dimension in ("lon", "longitude") for dimension in dims)
        if has_lat and has_lon:
            candidates.append(name)

    if candidates:
        return candidates[0]

    for name, variable in ds.variables.items():
        if getattr(variable, "ndim", 0) >= 2 and name.lower() not in coord_names:
            return name
    return None


def first_non_empty(values: Sequence[Any]) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def normalize_scenario_label(raw: str, scenario_style: str) -> str:
    value = str(raw or "").strip()
    if not value:
        return "Unknown"
    if scenario_style == "ssp_u6" and value in SCENARIO_LABELS_FROM_SSP_U6:
        return SCENARIO_LABELS_FROM_SSP_U6[value]
    if value in SCENARIO_LABELS_FROM_SSP:
        return SCENARIO_LABELS_FROM_SSP[value]
    if value in SCENARIO_LABELS_FROM_RCP:
        return SCENARIO_LABELS_FROM_RCP[value]
    return value.replace("+", ",")


def normalize_run_label(raw: str, preserve_forcing: bool = False) -> str:
    value = str(raw or "").strip()
    if not value:
        return "Unknown"
    if preserve_forcing:
        return value
    match = re.match(r"^r(?P<r>\d+)i(?P<i>\d+)p(?P<p>\d+)(?:f\d+)?$", value)
    if match:
        return f"r{match.group('r')}i{match.group('i')}p{match.group('p')}"
    return value


def compose_run_from_attrs(global_attrs: Dict[str, Any], prefixes: Sequence[str]) -> str:
    for prefix in prefixes:
        realization = str(global_attrs.get(f"{prefix}realization_index") or "").strip()
        initialization = str(
            global_attrs.get(f"{prefix}initialization_index") or ""
        ).strip()
        physics = str(global_attrs.get(f"{prefix}physics_index") or "").strip()
        forcing = str(global_attrs.get(f"{prefix}forcing_index") or "").strip()
        if realization and initialization and physics:
            run = f"r{realization}i{initialization}p{physics}"
            if forcing:
                run += f"f{forcing}"
            return run
    return str(global_attrs.get("run") or "").strip()


def derive_common_fields(metadata: Dict[str, Any]) -> Dict[str, Any]:
    global_attrs = metadata.get("global", {})
    primary = metadata.get("primary", {})
    time_meta = metadata.get("time", {})

    scenario_raw = first_non_empty(
        [
            global_attrs.get("GCM__experiment_id"),
            global_attrs.get("downscaling__GCM__experiment_id"),
            global_attrs.get("experiment_id"),
        ]
    )
    model = first_non_empty(
        [
            global_attrs.get("GCM__model_id"),
            global_attrs.get("downscaling__GCM__model_id"),
            global_attrs.get("model_id"),
        ]
    )
    run_raw = compose_run_from_attrs(
        global_attrs,
        prefixes=["GCM__", "downscaling__GCM__", ""],
    )

    climo_start = parse_year(str(global_attrs.get("climo_start_time") or ""))
    climo_end = parse_year(str(global_attrs.get("climo_end_time") or ""))

    if climo_start is None:
        climo_start = time_meta.get("startYear")
    if climo_end is None:
        climo_end = time_meta.get("endYear")

    return {
        "variableCode": str(primary.get("name") or "").strip(),
        "timeCount": int(time_meta.get("count", 0) or 0),
        "startYear": time_meta.get("startYear"),
        "endYear": time_meta.get("endYear"),
        "climoStartYear": climo_start,
        "climoEndYear": climo_end,
        "frequency": str(global_attrs.get("frequency") or "").strip(),
        "scenarioRaw": scenario_raw,
        "model": model,
        "runRaw": run_raw,
        "forcingType": str(global_attrs.get("forcing_type") or "").strip(),
        "targetDatasetId": first_non_empty(
            [
                global_attrs.get("target__dataset_id"),
                global_attrs.get("downscaling__target__dataset_id"),
                global_attrs.get("observations__dataset_id"),
                global_attrs.get("model_cal__dataset_id"),
            ]
        ),
        "projectId": str(global_attrs.get("project_id") or "").strip(),
        "methodId": str(global_attrs.get("method_id") or "").strip(),
    }


def ensure_derived_fields(metadata: Dict[str, Any]) -> Dict[str, Any]:
    derived = metadata.get("derived")
    if isinstance(derived, dict):
        return metadata
    metadata["derived"] = derive_common_fields(metadata)
    return metadata


def read_netcdf_metadata(path: Path) -> Dict[str, Any]:
    metadata: Dict[str, Any] = {
        "global": {},
        "time": {},
        "primary": {},
    }

    with Dataset(path) as ds:
        for attr in ds.ncattrs():
            try:
                value = getattr(ds, attr)
                if isinstance(value, (str, int, float, bool)):
                    metadata["global"][attr] = value
                else:
                    metadata["global"][attr] = str(value)
            except Exception:
                continue

        primary_name = choose_primary_variable(ds)
        if primary_name and primary_name in ds.variables:
            variable = ds.variables[primary_name]
            metadata["primary"] = {
                "name": primary_name,
                "units": getattr(variable, "units", None),
                "standard_name": getattr(variable, "standard_name", None),
                "long_name": getattr(variable, "long_name", None),
                "cell_methods": getattr(variable, "cell_methods", None),
            }

        if "time" in ds.variables:
            time_var = ds.variables["time"]
            metadata["time"]["count"] = int(len(time_var))
            units = getattr(time_var, "units", None)
            calendar = getattr(time_var, "calendar", "standard")
            if units and len(time_var) > 0:
                try:
                    start = num2date(time_var[0], units=units, calendar=calendar)
                    end = num2date(time_var[-1], units=units, calendar=calendar)
                    metadata["time"]["start"] = str(start)
                    metadata["time"]["end"] = str(end)
                    metadata["time"]["startYear"] = int(start.year)
                    metadata["time"]["endYear"] = int(end.year)
                except Exception:
                    pass

    return ensure_derived_fields(metadata)

