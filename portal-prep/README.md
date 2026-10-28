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
receives a `rendering` object containing `min`, `max`, `variable`, `scaleType`,
and the min/max source. When needed, it also contains `suggestedMin` and
`suggestedMax`. The CSV path is supplied through `--minmax-csv`.

### Rendering defaults and portal overrides

The CSV supplies the measured `min` and `max`.
[`LOG_VARIABLE_PATTERNS`](../portal_meta_builder/minmax.py) chooses the
default scale by variable class. Portal-specific settings belong in
[`PORTAL_CONFIGS`](../portal_meta_builder/portals.py) under
`renderingOverrides`. The builder applies these settings when generating
the portal JSON; the viewer reads the resulting `rendering` record from that
JSON. Use `"*"` for every variable in a portal; a class entry such as
`"precip"` takes precedence over `"*"`. For example:

```python
"example_portal": {
    "renderingOverrides": {
        "*": {"rangeDecimalPlaces": 2},
        "precip": {
            "logMinFloor": 0.05,
            "suggestedMax": 500,
        },
    },
},
```

`scaleType` is `"linear"` or `"log"`. `suggestedMin` and `suggestedMax`
set the initial input values; omitted values come from the CSV range. Users can
edit either input and choose a different scale. These fields do not enforce
limits on user-entered ranges. The default `0.01` minimum applies to
precipitation, rain, or snow in millimetre amounts or daily rates (including
`kg m-2 d-1`). When the CSV minimum is nonpositive, the fallback is
`1e-7` for precipitation, rain, or snow in per-second flux units and `0.01`
for wind speed. A manual switch to Log without a dataset suggestion starts at
`0.01`. These values are editable defaults, not limits. PRISM's annual and other precipitation suggestions are
configured in PRISM's `renderingOverrides`. `logMinFloor` sets a positive minimum for
automatic log defaults in that portal or class; an explicit `suggestedMin` wins.
`rangeDecimalPlaces` rounds generated default minima down and maxima up to
that many decimal places, and sets legend formatting. These rounded defaults
appear in the inputs and are the values sent to WMS. User-entered numbers are
never rounded; if they contain more decimals, the legend shows the full value.
`rangeDecimalPlaces` accepts integers from 0 to 12.

After editing the overrides, rebuild the affected portal metadata with the
existing `--portal` and `--minmax-csv` options below. The CSV path can point to
an external file; it does not need to be copied into this repository.

For a focused metadata rebuild, repeat `--portal` as needed:

```bash
python3 scripts/update-portal-meta.py \
  --portal vicgl \
  --minmax-csv portal-prep/pdp_min_max.csv \
  --prune
```

### Rebuilding after menu or display-label changes

Portal-specific menu order and grouping are configured in:

```text
portal_meta_builder/portals.py
```

Steward-editable portal titles, menu headings, and display labels for datasets
or sources, models, variables, scenarios, and runs are configured in the
Git-tracked source:

```text
config/display-labels.json
```

These mappings affect presentation only. Changing a display label does not
rename the underlying dataset, filename, metadata identifier, or THREDDS path.

After changing portal-specific menu configuration or stable menu-key derivation,
regenerate the affected portal metadata:

```bash
python3 scripts/update-portal-meta.py --portal <portal>
```

For example:

```bash
python3 scripts/update-portal-meta.py --portal prism
```

The resulting `portal-meta/<portal>.json` is generated output and should not be
edited directly.

Publish label-only changes from that source beside the metadata instead:

```bash
install -m 0644 config/display-labels.json /portal-meta/display-labels.json
```

They take effect after the viewer is refreshed; they do not require metadata or
viewer-image rebuilds.

See the top-level [`README.md`](../README.md#customizing-display-labels) for
details on the distinction between application-wide and portal-specific
display labels.

## Portal file patterns

`portal-file-patterns/` is the source of truth for portal membership. Each
`<portal>.txt` accepts:

* An absolute file path
* A glob containing `*`, `?`, or `[` patterns
* An exclusion prefixed with `!`

Blank lines and lines beginning with `#` are ignored. Bash extglob syntax such
as `!(...)` is not supported. Basenames must be unique within a portal because
the hardlink mirror stores files as `<portal>/<basename>`.
