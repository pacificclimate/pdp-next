# PDP-Next

THREDDS-backed, database-free replacement for the Pacific Climate Data Portal (PDP) with projection support, faster subsetting, additional palettes, and portal-based interactive map viewing.

## Layout

- `scripts/`: operational entrypoints
- `portal_meta_builder/`: shared metadata parsing and menu-building code
- `portal-prep/portal-file-patterns/`: source-of-truth file patterns for each portal
- `portal-meta/`: generated per-portal metadata JSON consumed by the viewer
- `viewer/`: current frontend/viewer assets
- `thredds/`: local THREDDS config and support files

## Current Metadata Flow

1. Build or refresh the `/pdp/<portal>/<file>.nc` hardlink mirror from portal file patterns.
2. Optionally compute min/max rendering metadata for selected files.
3. Build `portal-meta/<portal>.json` from NetCDF metadata and normalized derived fields.

The metadata builder reads NetCDF metadata, normalizes common fields into `metadata.derived`, and applies per-portal
menu rules from `portal_meta_builder/portals.py`.

## Scripts

### Build hardlink mirror

```bash
python3 scripts/gen_hardlinks.py
python3 scripts/gen_hardlinks.py --portal prism --portal vicgl
```

Uses file-pattern definitions from `portal-prep/portal-file-patterns/`.

### Compute rendering min/max CSV

```bash
python3 scripts/calculate-portal-minmax.py
python3 scripts/calculate-portal-minmax.py --portal prism
```

Writes `portal-prep/pdp_min_max.csv`.

### Build portal metadata JSON

```bash
python3 scripts/update-portal-meta.py
python3 scripts/update-portal-meta.py --portal prism
```

Writes `portal-meta/<portal>.json`.

## Adding A New Portal

1. Add a portal pattern file at `portal-prep/portal-file-patterns/<portal>.txt`.
2. Add a portal definition in `portal_meta_builder/portals.py`.
3. Run `scripts/gen_hardlinks.py` for the portal.
4. Run `scripts/update-portal-meta.py --portal <portal>`.

If the portal needs custom menu labels or grouping, add a focused menu builder in
`portal_meta_builder/portals.py`. If it needs additional normalized metadata, add that in
`portal_meta_builder/metadata.py`.
