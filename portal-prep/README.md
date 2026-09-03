# Portal metadata preparation

Run these commands from the repository root. The complete flow is:

1. Refresh the hardlink mirror from the portal file patterns.
2. Export existing ranges from the `modelmeta` database.
3. Build the ordered portal min/max CSV, calculating only database misses.
4. Rebuild the portal metadata JSON consumed by the viewer.

## 1. Refresh the hardlink mirror

The hardlink mirror under `/storage/data/projects/comp_support/thredds/pdp`
must be current before rebuilding the portal metadata. Refresh it when portal
membership or source files have changed:

```bash
python3 scripts/gen_hardlinks.py
```

## Production locations

The production copies used by PDP are under:

```text
/.../swarm_files/pdp-next
```

The active files produced or consumed by this workflow are:

```text
portal-meta/<portal>.json
portal-prep/pdp_min_max.csv
portal-prep/portal-file-patterns/<portal>.txt
```

## 2. Export ranges from modelmeta

[`min_max_query.sql`](min_max_query.sql) selects only the fields needed by
the range builder and restricts the result to the relevant database
ensembles. Run it against the `modelmeta` database and save the CSV here:

```bash
export PDP_MODELMETA_URL='postgresql://USERNAME@HOSTNAME:5432/modelmeta'

psql \
  --no-psqlrc \
  --quiet \
  --csv \
  --dbname "$PDP_MODELMETA_URL" \
  --file portal-prep/min_max_query.sql \
  > portal-prep/db-export.csv
```

`PDP_MODELMETA_URL` is the connection string for the `modelmeta` database on
the DM host. Replace `USERNAME` and `HOSTNAME` with its connection values.

The export must begin with this exact header:

```text
filename,netcdf_variable_name,range_min,range_max,ensemble_name
```

Check it before continuing:

```bash
head -1 portal-prep/db-export.csv
wc -l portal-prep/db-export.csv
```

`db-export.csv` is an intermediate snapshot. Regenerate it whenever ranges or
ensemble membership change in `modelmeta`.

## 3. Build the ordered min/max CSV

Pass the database export to the range builder and request a complete refresh:

```bash
python3 scripts/calculate-portal-minmax.py \
  --db-csv portal-prep/db-export.csv \
  --out-csv portal-prep/pdp_min_max.csv \
  --all
```

For every file selected by `portal-file-patterns/*.txt`, the builder:

1. Looks for an unambiguous range in `db-export.csv`, preferring an exact
   source path and then an unambiguous basename match.
2. Reads only the NetCDF header when it must choose among multiple variables.
3. Scans database misses in bounded chunks, avoiding whole-file memory loads.
4. Writes `pdp_min_max.csv` atomically in deterministic portal/path order.
5. Saves progress after every completed NetCDF scan, so a later failure does
   not discard completed work.

The output has no header and uses this layout:

```text
portal_id,source_path,variable,min,max,source
```

The default is one scan worker with a 256 MB chunk budget. Keep one worker on
memory-constrained hosts; every additional worker has its own chunk budget.
Files already represented by the database do not need to be scanned.

Useful checks:

```bash
wc -l portal-prep/pdp_min_max.csv
tail -5 portal-prep/pdp_min_max.csv
```

## 4. Rebuild portal metadata

Build the JSON documents from the hardlink mirror and attach the ranges from
the ordered CSV:

```bash
python3 scripts/update-portal-meta.py \
  --minmax-csv portal-prep/pdp_min_max.csv \
  --prune
```

`--prune` removes cached entries that are no longer present in the mirror. The
result is one `portal-meta/<portal>.json` file per portal. Each matched file
receives a `rendering` object containing `min`, `max`, `variable`, `logScale`,
and the min/max source.

For a focused metadata rebuild, repeat `--portal` as needed:

```bash
python3 scripts/update-portal-meta.py \
  --portal vicgl \
  --minmax-csv portal-prep/pdp_min_max.csv \
  --prune
```

## Portal file patterns

`portal-file-patterns/` is the source of truth for portal membership. Each
`<portal>.txt` accepts:

- An absolute file path
- A glob containing `*`, `?`, or `[` patterns
- An exclusion prefixed with `!`

Blank lines and lines beginning with `#` are ignored. Bash extglob syntax such
as `!(...)` is not supported. Basenames must be unique within a portal because
the hardlink mirror stores files as `<portal>/<basename>`.
