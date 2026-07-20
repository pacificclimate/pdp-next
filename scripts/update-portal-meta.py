#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from portal_meta_builder.builder import build_portal_payload
from portal_meta_builder.io_utils import save_json
from portal_meta_builder.minmax import load_minmax_csv


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build per-portal metadata + menu trees from /pdp-style mirror datasets."
    )
    parser.add_argument(
        "--portal",
        action="append",
        help="portal id(s). If omitted, processes all portals.",
    )
    parser.add_argument(
        "--mirror-root",
        default="/storage/data/projects/comp_support/thredds/pdp",
        help="mirror root containing /<portal>/<file>.nc hardlinks",
    )
    parser.add_argument(
        "--out-dir",
        default=str(REPO_ROOT / "portal-meta"),
        help="output directory for <portal>.json",
    )
    parser.add_argument(
        "--minmax-csv",
        default=str(REPO_ROOT / "portal-prep" / "pdp_min_max.csv"),
        help="optional CSV with precomputed min/max rows (portal, path, variable, min, max)",
    )
    parser.add_argument(
        "--prune",
        action="store_true",
        help="drop stale entries not in current inventory",
    )
    args = parser.parse_args()

    mirror_root = Path(args.mirror_root).resolve()
    out_dir = Path(args.out_dir).resolve()
    minmax_path = Path(args.minmax_csv).resolve()
    minmax_lookup = load_minmax_csv(minmax_path)

    portals = [p for p in (args.portal or []) if p]
    if not portals:
        portals = (
            sorted(path.name for path in mirror_root.iterdir() if path.is_dir())
            if mirror_root.exists()
            else []
        )

    if not portals:
        raise SystemExit("No portals found to process.")

    for portal_id in portals:
        out_path = out_dir / f"{portal_id}.json"
        new_payload, stats, inventory_count = build_portal_payload(
            portal_id=portal_id,
            mirror_root=mirror_root,
            out_path=out_path,
            minmax_lookup=minmax_lookup,
            minmax_source_name=minmax_path.name,
            prune=args.prune,
        )
        save_json(out_path, new_payload)

        print(
            f"{portal_id}: {inventory_count} inventory -> {new_payload['count']} cached "
            f"({stats['updated']} updated, {stats['kept']} unchanged, {stats['removed']} removed), "
            f"menu top-level={len(new_payload['menu'])}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

