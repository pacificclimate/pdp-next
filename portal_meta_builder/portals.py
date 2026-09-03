from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from .metadata import ensure_derived_fields, normalize_run_label, normalize_scenario_label


PRISM_PERIOD_LABELS: Dict[Tuple[int, int], str] = {
    (1950, 2007): "Averaged months, 1950-2007",
    (1971, 2000): "Climatological averages 1970-2000",
    (1981, 2010): "Climatological averages 1981-2010",
    (1991, 2020): "Climatological averages 1991-2020",
}

PRISM_VARIABLE_LABELS: Dict[str, str] = {
    "tasmax": "Maximum Temperature",
    "tmax": "Maximum Temperature",
    "tasmin": "Minimum Temperature",
    "tmin": "Minimum Temperature",
    "pr": "Total Precipitation",
    "ppt": "Total Precipitation",
}

CANADA_MOSAIC_VARIABLE_LABELS: Dict[str, str] = {
    "pr": "Total Precipitation",
    "tmax": "Maximum Temperature",
    "tmin": "Minimum Temperature",
    "tas": "Mean Temperature",
    "tasmean": "Mean Temperature",
}

GRIDDED_DAILY_SOURCE_BY_MODEL: Dict[str, str] = {
    "ANUSPLIN_CDA_v2012.1": "NRCANmet 2012",
    "TPS_NWNA_v1": "PNWNAmet 2015",
    "PCIC_BLEND_v1": "PCIC Blend 2021",
}

GRIDDED_DAILY_VARIABLE_LABELS: Dict[str, str] = {
    "tasmax": "Maximum Temperature",
    "tmax": "Maximum Temperature",
    "tasmin": "Minimum Temperature",
    "tmin": "Minimum Temperature",
    "pr": "Precipitation",
    "wind": "Wind",
}

VICGL_VARIABLE_LABELS: Dict[str, str] = {
    "BASEFLOW": "Baseflow",
    "EVAP": "Evapotranspiration",
    "GLAC_AREA": "Glacier Area",
    "GLAC_MBAL": "Glacier Mass Balance",
    "GLAC_OUTFLOW": "Glacier Outflow",
    "PET_NATVEG": "Potential Evapotranspiration",
    "PREC": "Precipitation",
    "RAINF": "Rainfall",
    "SNOW_MELT": "Snow Melt",
    "SWE": "Snow Water Equivalent",
    "RUNOFF": "Surface Runoff",
    "SOIL_MOIST_TOT": "Total Column Soil Moisture",
    "TRANSP_VEG": "Transpiration",
}

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


def prism_period_label(start_year: Optional[int], end_year: Optional[int]) -> str:
    if start_year is None or end_year is None:
        return "Unknown"
    if (start_year, end_year) in PRISM_PERIOD_LABELS:
        return PRISM_PERIOD_LABELS[(start_year, end_year)]
    return f"{start_year}-{end_year}"


def prism_frequency_label(metadata: Dict[str, Any]) -> str:
    metadata = ensure_derived_fields(metadata)
    derived = metadata.get("derived", {})
    frequency = str(derived.get("frequency") or "").lower()
    if any(token in frequency for token in ["mclim", "mon", "month"]):
        return "Monthly"
    if any(token in frequency for token in ["aclim", "ann", "year", "yr"]):
        return "Annual"

    time_count = int(derived.get("timeCount", 0) or 0)
    if time_count == 12:
        return "Monthly"
    if time_count == 1:
        return "Annual"
    if time_count > 12:
        return "Monthly"
    return "Unknown"


def prism_menu_builder(metadata: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, str]:
    metadata = ensure_derived_fields(metadata)
    derived = metadata.get("derived", {})
    variable_code = str(derived.get("variableCode") or "").lower()
    variable_label = PRISM_VARIABLE_LABELS.get(variable_code, variable_code or "Unknown")
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
        frequency = "Monthly"
    elif time_count == 4:
        frequency = "Seasonal"
    elif time_count == 1:
        frequency = "Annual"
    else:
        frequency = "Unknown"

    variable_code = str(derived.get("variableCode") or "").lower()
    variable = CANADA_MOSAIC_VARIABLE_LABELS.get(variable_code, variable_code or "Unknown")
    return {
        "period": "Climatological averages 1981-2010",
        "frequency": frequency,
        "variable": variable,
    }


def gridded_daily_menu_builder(
    metadata: Dict[str, Any], config: Dict[str, Any]
) -> Dict[str, str]:
    metadata = ensure_derived_fields(metadata)
    derived = metadata.get("derived", {})
    model_id = str(derived.get("model") or "").strip()
    source = GRIDDED_DAILY_SOURCE_BY_MODEL.get(model_id, model_id or "Unknown")
    variable_code = str(derived.get("variableCode") or "").lower()
    variable = GRIDDED_DAILY_VARIABLE_LABELS.get(variable_code, variable_code or "Unknown")
    return {"source": source, "variable": variable}


def vicgl_menu_builder(metadata: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, str]:
    metadata = ensure_derived_fields(metadata)
    derived = metadata.get("derived", {})
    global_attrs = metadata.get("global", {})

    variable_code = str(derived.get("variableCode") or "").upper()
    variable = VICGL_VARIABLE_LABELS.get(variable_code, variable_code or "Unknown")

    scenario_raw = str(derived.get("scenarioRaw") or "").lower()
    forcing_type = str(derived.get("forcingType") or "").lower()
    model_id = str(derived.get("model") or "").strip()
    run_raw = str(derived.get("runRaw") or "").strip()
    target_dataset = str(derived.get("targetDatasetId") or "").strip()

    if forcing_type == "gridded observations":
        scenario = str(global_attrs.get("experiment_id") or "historical")
        model = "PNWNAmet base" if target_dataset == "PNWNAmet" else (model_id or "Unknown")
        return {"scenario": scenario, "model": model, "variable": variable}

    scenario = normalize_scenario_label(scenario_raw, "legacy")
    run = normalize_run_label(run_raw)
    model = model_id or "Unknown"
    if run != "Unknown":
        model = f"{model} {run}"
    return {"scenario": scenario or "Unknown", "model": model, "variable": variable}


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
    model = str(derived.get("model") or "").strip() or "Unknown"
    run = normalize_run_label(str(derived.get("runRaw") or ""), preserve_forcing)
    variable = str(derived.get("variableCode") or "").lower() or "unknown"

    fields = {
        "scenario": scenario,
        "model": model,
        "run": run,
        "variable": variable,
    }
    if config.get("addPcic12ScenarioSuffix") and model in PCIC12_MODELS and scenario in {
        "Historical, SSP1-2.6",
        "Historical, SSP2-4.5",
        "Historical, SSP3-7.0",
        "Historical, SSP5-8.5",
    }:
        fields["scenarioPcic12"] = f"{scenario} (PCIC12)"
    return fields


PORTAL_CONFIGS: Dict[str, Dict[str, Any]] = {
    "prism": {
        "menuSchema": {
            "order": ["period", "frequency", "variable"],
            "labels": {
                "period": "Period",
                "frequency": "Frequency",
                "variable": "Variable",
            },
        },
        "menuBuilder": prism_menu_builder,
    },
    "canada_mosaic": {
        "menuSchema": {
            "order": ["period", "frequency", "variable"],
            "labels": {
                "period": "Period",
                "frequency": "Frequency",
                "variable": "Variable",
            },
        },
        "menuBuilder": canada_mosaic_menu_builder,
    },
    "gridded_daily": {
        "menuSchema": {
            "order": ["source", "variable"],
            "labels": {
                "source": "Dataset",
                "variable": "Variable",
            },
        },
        "menuBuilder": gridded_daily_menu_builder,
    },
    "vicgl": {
        "menuSchema": {
            "order": ["scenario", "model", "variable"],
            "labels": {
                "scenario": "Scenario",
                "model": "Model",
                "variable": "Variable",
            },
        },
        "menuBuilder": vicgl_menu_builder,
    },
    "bccaqv2": {
        "menuSchema": {
            "order": ["scenario", "model", "run", "variable"],
            "labels": {
                "scenario": "Scenario",
                "model": "Model",
                "run": "Run",
                "variable": "Variable",
            },
        },
        "menuBuilder": climate_projection_menu_builder,
        "scenarioStyle": "legacy",
    },
    "bccaqv2_u5": {
        "menuSchema": {
            "order": ["scenario", "model", "run", "variable"],
            "labels": {
                "scenario": "Scenario",
                "model": "Model",
                "run": "Run",
                "variable": "Variable",
            },
        },
        "menuBuilder": climate_projection_menu_builder,
        "scenarioStyle": "legacy",
    },
    "bccaqv2_u6": {
        "menuSchema": {
            "order": ["scenario", "model", "run", "variable"],
            "labels": {
                "scenario": "Scenario",
                "model": "Model",
                "run": "Run",
                "variable": "Variable",
            },
        },
        "menuBuilder": climate_projection_menu_builder,
        "scenarioStyle": "ssp_u6",
        "addPcic12ScenarioSuffix": True,
    },
    "canesm5_u6": {
        "menuSchema": {
            "order": ["scenario", "model", "run", "variable"],
            "labels": {
                "scenario": "Scenario",
                "model": "Model",
                "run": "Run",
                "variable": "Variable",
            },
        },
        "menuBuilder": climate_projection_menu_builder,
        "scenarioStyle": "ssp_u6",
        "preserveRunForcing": True,
    },
    "canesm5_m6": {
        "menuSchema": {
            "order": ["scenario", "model", "run", "variable"],
            "labels": {
                "scenario": "Scenario",
                "model": "Model",
                "run": "Run",
                "variable": "Variable",
            },
        },
        "menuBuilder": climate_projection_menu_builder,
        "scenarioStyle": "ssp_u6",
        "preserveRunForcing": True,
    },
    "mbcn": {
        "menuSchema": {
            "order": ["scenario", "model", "run", "variable"],
            "labels": {
                "scenario": "Scenario",
                "model": "Model",
                "run": "Run",
                "variable": "Variable",
            },
        },
        "menuBuilder": climate_projection_menu_builder,
        "scenarioStyle": "ssp_u6",
    },
}


DEFAULT_PORTAL_CONFIG: Dict[str, Any] = {
    "menuSchema": {"order": ["variable"], "labels": {"variable": "Variable"}},
    "menuBuilder": lambda metadata, config: {
        "variable": str(metadata.get("derived", {}).get("variableCode") or "Unknown")
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
            label = str(fields.get(key) or "Unknown")
            if label not in current:
                current[label] = {}
            current = current[label]
        leaf = str(fields.get(order[-1]) or "Unknown")
        current.setdefault(leaf, []).append(basename)
    return tree

