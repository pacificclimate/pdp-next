from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from .metadata import ensure_derived_fields, normalize_run_label, normalize_scenario_label

PCIC12_MODELS: Set[str] = {
    "BCC-CSM2-MR",
    "NorESM2-LM",
    "MIROC-ES2L",
    "MPI-ESM1-2-HR",
    "MRI-ESM2-0",
    "UKESM1-0-LL",
    "EC-Earth3-Veg",
    "CMCC-ESM2",
    "INM-CM5-0",
    "FGOALS-g3",
    "TaiESM1",
    "IPSL-CM6A-LR",
}


MenuBuilder = Callable[[Dict[str, Any], Dict[str, Any]], Dict[str, str]]
UNKNOWN = "unknown"


def menu_schema(portal_id: str, order: List[str]) -> Dict[str, Any]:
    return {"order": order}


def prism_period_label(start_year: Optional[int], end_year: Optional[int]) -> str:
    if start_year is None or end_year is None:
        return UNKNOWN
    period = f"{start_year}-{end_year}"
    return period


def prism_frequency_label(metadata: Dict[str, Any]) -> str:
    metadata = ensure_derived_fields(metadata)
    derived = metadata.get("derived", {})
    frequency = str(derived.get("frequency") or "").lower()
    if any(token in frequency for token in ["mclim", "mon", "month"]):
        return "monthly"
    if any(token in frequency for token in ["aclim", "ann", "year", "yr"]):
        return "annual"

    time_count = int(derived.get("timeCount", 0) or 0)
    if time_count == 12:
        return "monthly"
    if time_count == 1:
        return "annual"
    if time_count > 12:
        return "monthly"
    return UNKNOWN


def prism_menu_builder(metadata: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, str]:
    metadata = ensure_derived_fields(metadata)
    derived = metadata.get("derived", {})
    variable_code = str(derived.get("variableCode") or "").lower()
    variable_label = variable_code or UNKNOWN
    return {
        "period": prism_period_label(
            derived.get("climoStartYear"), derived.get("climoEndYear")
        ),
        "frequency": prism_frequency_label(metadata),
        "variable": variable_label,
    }


def canada_mosaic_menu_builder(
    metadata: Dict[str, Any], config: Dict[str, Any]
) -> Dict[str, str]:
    metadata = ensure_derived_fields(metadata)
    derived = metadata.get("derived", {})
    time_count = int(derived.get("timeCount", 0) or 0)
    if time_count == 12:
        frequency = "monthly"
    elif time_count == 4:
        frequency = "seasonal"
    elif time_count == 1:
        frequency = "annual"
    else:
        frequency = UNKNOWN

    variable_code = str(derived.get("variableCode") or "").lower()
    variable = variable_code or UNKNOWN
    return {
        "period": "1981-2010",
        "frequency": frequency,
        "variable": variable,
    }


def gridded_daily_menu_builder(
    metadata: Dict[str, Any], config: Dict[str, Any]
) -> Dict[str, str]:
    metadata = ensure_derived_fields(metadata)
    derived = metadata.get("derived", {})
    model_id = str(derived.get("model") or "").strip()
    source = model_id or UNKNOWN
    variable_code = str(derived.get("variableCode") or "").lower()
    variable = variable_code or UNKNOWN
    return {"source": source, "variable": variable}


def vicgl_menu_builder(metadata: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, str]:
    metadata = ensure_derived_fields(metadata)
    derived = metadata.get("derived", {})
    global_attrs = metadata.get("global", {})

    variable_code = str(derived.get("variableCode") or "").upper()
    variable = variable_code or UNKNOWN

    scenario_raw = str(derived.get("scenarioRaw") or "").lower()
    forcing_type = str(derived.get("forcingType") or "").lower()
    model_id = str(derived.get("model") or "").strip()
    run_raw = str(derived.get("runRaw") or "").strip()
    target_dataset = str(derived.get("targetDatasetId") or "").strip()

    if forcing_type == "gridded observations":
        scenario = str(global_attrs.get("experiment_id") or "historical")
        model = target_dataset or model_id or UNKNOWN
        return {"scenario": scenario, "model": model, "variable": variable}

    scenario = normalize_scenario_label(scenario_raw, "legacy")
    run = normalize_run_label(run_raw)
    model = model_id or UNKNOWN
    if run != UNKNOWN:
        model = f"{model} {run}"
    return {"scenario": scenario or UNKNOWN, "model": model, "variable": variable}


def climate_projection_menu_builder(
    metadata: Dict[str, Any], config: Dict[str, Any]
) -> Dict[str, str]:
    metadata = ensure_derived_fields(metadata)
    derived = metadata.get("derived", {})
    scenario_style = str(config.get("scenarioStyle") or "legacy")
    preserve_forcing = bool(config.get("preserveRunForcing"))

    scenario = normalize_scenario_label(
        str(derived.get("scenarioRaw") or "").lower(),
        scenario_style,
    )
    model = str(derived.get("model") or "").strip() or UNKNOWN
    run = normalize_run_label(str(derived.get("runRaw") or ""), preserve_forcing)
    variable = str(derived.get("variableCode") or "").lower() or UNKNOWN

    fields = {
        "scenario": scenario,
        "model": model,
        "run": run,
        "variable": variable,
    }
    if config.get("addPcic12ScenarioSuffix") and model in PCIC12_MODELS and scenario in {
        "historical,ssp126", "historical,ssp245", "historical,ssp370", "historical,ssp585",
    }:
        fields["scenarioPcic12"] = f"{scenario}__pcic12"
    return fields


PORTAL_CONFIGS: Dict[str, Dict[str, Any]] = {
    "prism": {
        "menuSchema": menu_schema("prism", ["period", "frequency", "variable"]),
        "menuBuilder": prism_menu_builder,
    },
    "canada_mosaic": {
        "menuSchema": menu_schema("canada_mosaic", ["period", "frequency", "variable"]),
        "menuBuilder": canada_mosaic_menu_builder,
    },
    "gridded_daily": {
        "menuSchema": menu_schema("gridded_daily", ["source", "variable"]),
        "menuBuilder": gridded_daily_menu_builder,
    },
    "vicgl": {
        "menuSchema": menu_schema("vicgl", ["scenario", "model", "variable"]),
        "menuBuilder": vicgl_menu_builder,
    },
    "bccaqv2": {
        "menuSchema": menu_schema("bccaqv2", ["scenario", "model", "run", "variable"]),
        "menuBuilder": climate_projection_menu_builder,
        "scenarioStyle": "legacy",
    },
    "bccaqv2_u5": {
        "menuSchema": menu_schema("bccaqv2_u5", ["scenario", "model", "run", "variable"]),
        "menuBuilder": climate_projection_menu_builder,
        "scenarioStyle": "legacy",
    },
    "bccaqv2_u6": {
        "menuSchema": menu_schema("bccaqv2_u6", ["scenario", "model", "run", "variable"]),
        "menuBuilder": climate_projection_menu_builder,
        "scenarioStyle": "ssp_u6",
        "addPcic12ScenarioSuffix": True,
    },
    "canesm5_u6": {
        "menuSchema": menu_schema("canesm5_u6", ["scenario", "model", "run", "variable"]),
        "menuBuilder": climate_projection_menu_builder,
        "scenarioStyle": "ssp_u6",
        "preserveRunForcing": True,
    },
    "canesm5_m6": {
        "menuSchema": menu_schema("canesm5_m6", ["scenario", "model", "run", "variable"]),
        "menuBuilder": climate_projection_menu_builder,
        "scenarioStyle": "ssp_u6",
        "preserveRunForcing": True,
    },
    "mbcn": {
        "menuSchema": menu_schema("mbcn", ["scenario", "model", "run", "variable"]),
        "menuBuilder": climate_projection_menu_builder,
        "scenarioStyle": "ssp_u6",
    },
}


DEFAULT_PORTAL_CONFIG: Dict[str, Any] = {
    "menuSchema": {"order": ["variable"]},
    "menuBuilder": lambda metadata, config: {
        "variable": str(metadata.get("derived", {}).get("variableCode") or UNKNOWN)
    },
}


def get_portal_config(portal_id: str) -> Dict[str, Any]:
    return PORTAL_CONFIGS.get(portal_id, DEFAULT_PORTAL_CONFIG)


def derive_menu_fields(portal_id: str, metadata: Dict[str, Any]) -> Dict[str, str]:
    config = get_portal_config(portal_id)
    builder = config["menuBuilder"]
    return builder(metadata, config)


def build_menu_tree(
    file_items: List[Tuple[str, Dict[str, str]]], order: List[str]
) -> Dict[str, Any]:
    tree: Dict[str, Any] = {}
    for basename, fields in file_items:
        current: Dict[str, Any] = tree
        for key in order[:-1]:
            label = str(fields.get(key) or UNKNOWN)
            if label not in current:
                current[label] = {}
            current = current[label]
        leaf = str(fields.get(order[-1]) or UNKNOWN)
        current.setdefault(leaf, []).append(basename)
    return tree