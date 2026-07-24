# PDP-Next

THREDDS-backed, database-free replacement for the Pacific Climate Data Portal (PDP) with projection support, additional palettes, and portal-based interactive map viewing.

## Layout

- `scripts/`: operational entrypoints
- `portal_meta_builder/`: shared metadata parsing and menu-building code
- `portal-prep/portal-file-patterns/`: source-of-truth file patterns for each portal
- `portal-meta/`: generated per-portal metadata JSON consumed by the viewer
- `viewer/`: current frontend/viewer assets
- `thredds/`: local THREDDS config and support files

## Production Files

The production metadata files are deployed under:

```text
/.../swarm_files/
```

The active generated metadata is in `portal-meta/*.json`. The production
min/max CSV and portal membership definitions are in `portal-prep/`:

```text
portal-meta/<portal>.json
portal-prep/pdp_min_max.csv
portal-prep/portal-file-patterns/<portal>.txt
```

`portal-meta/portal-meta-bu/` contains backup JSON files and is not an active
metadata output directory.

## Current Metadata Flow

1. Build or refresh the `/pdp/<portal>/<file>.nc` hardlink mirror from portal file patterns.
2. Export existing min/max ranges from the `modelmeta` database.
3. Build the ordered min/max CSV, scanning only files missing from the export.
4. Build `portal-meta/<portal>.json` from NetCDF metadata and normalized derived fields.

The metadata builder reads NetCDF metadata, normalizes common fields into `metadata.derived`, and applies per-portal
menu rules from `portal_meta_builder/portals.py`.

See [`portal-prep/README.md`](portal-prep/README.md) for the complete,
copy-pasteable metadata preparation workflow.

## Scripts

### Build hardlink mirror

```bash
python3 scripts/gen_hardlinks.py
python3 scripts/gen_hardlinks.py --portal prism --portal vicgl
```

Uses file-pattern definitions from `portal-prep/portal-file-patterns/`.

### Compute rendering min/max CSV

```bash
export PDP_MODELMETA_URL='postgresql://USERNAME@HOSTNAME:5432/modelmeta'

psql --no-psqlrc --quiet --csv --dbname "$PDP_MODELMETA_URL" \
  --file portal-prep/min_max_query.sql \
  > portal-prep/db-export.csv

python3 scripts/calculate-portal-minmax.py \
  --db-csv portal-prep/db-export.csv \
  --out-csv portal-prep/pdp_min_max.csv \
  --all
```

Uses `portal-prep/db-export.csv` as its first source and scans remaining files
in bounded chunks. The reduced export query is
`portal-prep/min_max_query.sql`. Writes `portal-prep/pdp_min_max.csv`.

### Build portal metadata JSON

```bash
python3 scripts/update-portal-meta.py --prune
python3 scripts/update-portal-meta.py --portal prism
```

Writes `portal-meta/<portal>.json`.

## Adding A New Portal

1. Add a portal pattern file at `portal-prep/portal-file-patterns/<portal>.txt`.
2. Add a portal definition in `portal_meta_builder/portals.py`.
3. Run `scripts/gen_hardlinks.py` for the portal.
4. If ModelMeta contains the portal's ensemble, add its database ensemble name
   to `portal-prep/min_max_query.sql` and regenerate `portal-prep/db-export.csv`.
5. Run `scripts/calculate-portal-minmax.py --portal <portal>`.
6. Run `scripts/update-portal-meta.py --portal <portal>`.

If the portal needs custom menu labels or grouping, add a focused menu builder in
`portal_meta_builder/portals.py`. If it needs additional normalized metadata, add that in
`portal_meta_builder/metadata.py`.
