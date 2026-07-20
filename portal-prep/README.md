Portal prep files

`portal-prep/portal-file-patterns/` is the source of truth for which datasets belong to each portal.

Each portal has a `<portal>.txt` file containing one file pattern rule per line:
- Absolute file path, for example `/storage/.../file.nc`
- A glob pattern containing `*`, `?`, or `[`
- An exclude pattern prefixed with `!`

Rules:
- Blank lines are ignored
- Lines starting with `#` are ignored
- `!(...)` extglob is not supported
- Filenames must remain unique within a portal after expansion because the hardlink mirror uses `<portal>/<basename>`

Primary commands:

```bash
python3 scripts/gen_hardlinks.py
python3 scripts/calculate-portal-minmax.py
python3 scripts/update-portal-meta.py
```

