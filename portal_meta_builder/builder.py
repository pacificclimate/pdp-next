from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

from .io_utils import file_fingerprint, load_json, utc_now_iso
from .metadata import ensure_derived_fields, read_netcdf_metadata
from .minmax import select_minmax_record
from .portals import build_menu_tree, derive_menu_fields, get_portal_config


def files_from_mirror_root(mirror_root: Path, portal_id: str) -> List[Path]:
    portal_root = mirror_root / portal_id
    if not portal_root.exists() or not portal_root.is_dir():
        raise SystemExit(f"Mirror portal directory not found: {portal_root}")

    files = sorted(
        [path for path in portal_root.iterdir() if path.is_file()],
        key=lambda path: path.name.lower(),
    )
    if not files:
        raise SystemExit(f"No files found in mirror portal directory: {portal_root}")
    return files


def build_entry(
    portal_id: str,
    src: Path,
    fingerprint: Dict[str, int],
    metadata: Dict[str, Any],
) -> Dict[str, Any]:
    return {
        "portal": portal_id,
        "sourcePath": str(src),
        "basename": src.name,
        "fingerprint": fingerprint,
        "thredds": {
            "urlPath": f"data/{portal_id}/{src.name}",
            "fileServer": f"/thredds/fileServer/data/{portal_id}/{src.name}",
            "wms": f"/thredds/wms/data/{portal_id}/{src.name}",
            "ncssGrid": f"/thredds/ncss/grid/data/{portal_id}/{src.name}",
            "ncml": f"/thredds/ncml/data/{portal_id}/{src.name}",
        },
        "metadata": metadata,
        "menuFields": derive_menu_fields(portal_id, metadata),
        "updatedAt": utc_now_iso(),
    }


def build_portal_payload(
    portal_id: str,
    mirror_root: Path,
    out_path: Path,
    minmax_lookup: Dict[str, List[Dict[str, Any]]],
    minmax_source_name: str,
    prune: bool = False,
) -> Tuple[Dict[str, Any], Dict[str, int], int]:
    files = files_from_mirror_root(mirror_root, portal_id)
    payload = load_json(out_path)
    entries: Dict[str, Any] = (
        payload.get("files") if isinstance(payload.get("files"), dict) else {}
    )

    updated = 0
    kept = 0
    removed = 0
    current_keys: Set[str] = set()
    menu_items: List[Tuple[str, Dict[str, str]]] = []

    for src in files:
        source_key = str(src)
        current_keys.add(source_key)

        existing = entries.get(source_key) if isinstance(entries.get(source_key), dict) else {}
        fingerprint = file_fingerprint(src)
        needs_refresh = (
            not existing
            or existing.get("fingerprint") != fingerprint
            or not isinstance(existing.get("metadata"), dict)
            or not isinstance(existing.get("menuFields"), dict)
        )

        if needs_refresh:
            metadata = read_netcdf_metadata(src)
            entry = build_entry(portal_id, src, fingerprint, metadata)
            lookup = select_minmax_record(minmax_lookup, source_key, src.name, portal_id)
            if lookup:
                entry["rendering"] = lookup
            entries[source_key] = entry
            updated += 1
        else:
            entry = existing
            kept += 1

            cached_metadata = entry.get("metadata") if isinstance(entry.get("metadata"), dict) else {}
            if cached_metadata:
                cached_metadata = ensure_derived_fields(cached_metadata)
                entry["metadata"] = cached_metadata
                recomputed = derive_menu_fields(portal_id, cached_metadata)
                if recomputed and recomputed != entry.get("menuFields"):
                    entry["menuFields"] = recomputed
                    entry["updatedAt"] = utc_now_iso()
                    entries[source_key] = entry
                    updated += 1

            lookup = select_minmax_record(minmax_lookup, source_key, src.name, portal_id)
            existing_render = entry.get("rendering") if isinstance(entry.get("rendering"), dict) else None
            if lookup:
                if existing_render != lookup:
                    entry["rendering"] = lookup
                    entry["updatedAt"] = utc_now_iso()
                    entries[source_key] = entry
                    updated += 1
            elif existing_render and existing_render.get("source") == minmax_source_name:
                entry.pop("rendering", None)
                entry["updatedAt"] = utc_now_iso()
                entries[source_key] = entry
                updated += 1

        fields = entry.get("menuFields") if isinstance(entry.get("menuFields"), dict) else {}
        menu_items.append((src.name, fields))
        if portal_id == "bccaqv2_u6":
            alt = str(fields.get("scenarioPcic12") or "").strip()
            if alt:
                fields_alt = dict(fields)
                fields_alt["scenario"] = alt
                menu_items.append((src.name, fields_alt))

    if prune:
        stale = [key for key in list(entries.keys()) if key not in current_keys]
        for key in stale:
            del entries[key]
        removed = len(stale)

    config = get_portal_config(portal_id)
    schema = config["menuSchema"]
    order = list(schema.get("order") or ["variable"])
    tree = build_menu_tree(menu_items, order)

    new_payload = {
        "portal": {
            "id": portal_id,
            "menuSchema": schema,
        },
        "generatedAt": utc_now_iso(),
        "count": len(entries),
        "files": entries,
        "menu": tree,
    }
    stats = {"updated": updated, "kept": kept, "removed": removed}
    return new_payload, stats, len(files)

