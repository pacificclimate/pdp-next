#!/bin/sh
set -eu

DIR="/storage/..../gridded_daily"
OUT_DIR="/storage/..../gridded_chunked"

TIME_CHUNK="90"
LAT_CHUNK="64"
LON_CHUNK="64"

# Set to 1 to overwrite existing outputs
OVERWRITE="${OVERWRITE:-0}"

if [ ! -d "$DIR" ]; then
  echo "ERROR: directory not found: $DIR" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

find "$DIR" -maxdepth 1 -type f -name "*.nc" -print0 |
while IFS= read -r -d '' in; do
  base=$(basename "$in")

  # Skip already chunked inputs
  case "$base" in
    chunked_*) continue ;;
  esac

  out="${OUT_DIR}/chunked_${base}"

  if [ -e "$out" ] && [ "$OVERWRITE" != "1" ]; then
    echo "SKIP: output exists: $out"
    continue
  fi

  echo "CHUNK: $base -> $(basename "$out")"

  nccopy -k 4 -d 0 \
   -c time/$TIME_CHUNK,lat/$LAT_CHUNK,lon/$LON_CHUNK \
   "$in" "$out"

  if [ ! -s "$out" ]; then
    echo "ERROR: output missing/empty: $out" >&2
    exit 1
  fi
done

echo "Done."
