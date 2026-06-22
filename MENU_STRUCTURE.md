# Menu Structure

This file describes the menu schemas currently generated into `portal-meta/<portal>.json`.

## Schemas

- `prism`: `period -> frequency -> variable`
- `canada_mosaic`: `period -> frequency -> variable`
- `gridded_daily`: `source -> variable`
- `vicgl`: `scenario -> model -> variable`
- `bccaqv2`: `scenario -> model -> run -> variable`
- `bccaqv2_u5`: `scenario -> model -> run -> variable`
- `bccaqv2_u6`: `scenario -> model -> run -> variable`
- `canesm5_u6`: `scenario -> model -> run -> variable`
- `canesm5_m6`: `scenario -> model -> run -> variable`
- `mbcn`: `scenario -> model -> run -> variable`

## Notes

- Menu labels and portal-specific derivation live in `portal_meta_builder/portals.py`.
- Normalized metadata used by menu builders is created in `portal_meta_builder/metadata.py` under `metadata.derived`.
- `bccaqv2_u6` also emits alternate scenario labels with a `(PCIC12)` suffix for the PCIC12 subset.
- `vicgl` uses metadata fields such as forcing type, experiment, model, and dataset identifiers to distinguish historical baseline output from downscaled GCM runs.
