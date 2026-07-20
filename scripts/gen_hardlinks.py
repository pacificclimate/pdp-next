#!/usr/bin/env python3

import argparse
import errno
import fnmatch
import glob
import os
from pathlib import Path
from typing import Dict, List, Sequence, Set, Tuple


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MIRROR_ROOT = Path("/storage/data/projects/comp_support/thredds/pdp")
MANIFEST_NAME = ".gen_hardlinks_manifest.txt"

ALLOWED_SOURCE_PREFIXES = {
    Path("/storage/data/climate").resolve(),
    Path("/storage/data/projects/hydrology").resolve(),
    Path("/storage/data/projects/dataportal").resolve(),
    Path("/storage/data/projects/comp_support").resolve(),
}


def read_file_list(path: Path) -> Tuple[List[str], List[str]]:
    includes: List[str] = []
    excludes: List[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("!"):
            excludes.append(line[1:].strip())
        else:
            includes.append(line)
    return includes, excludes


def is_glob_pattern(value: str) -> bool:
    return any(ch in value for ch in ["*", "?", "["])


def expand_file_list(includes: Sequence[str], excludes: Sequence[str]) -> List[Path]:
    out: List[Path] = []
    for include_pattern in includes:
        if is_glob_pattern(include_pattern):
            out.extend(Path(p) for p in glob.glob(include_pattern, recursive=True))
        else:
            out.append(Path(include_pattern))

    seen: Set[str] = set()
    unique: List[Path] = []
    for path in out:
        resolved = path.resolve()
        key = str(resolved)
        if key in seen:
            continue
        seen.add(key)
        unique.append(resolved)

    files: List[Path] = []
    for path in unique:
        if not path.exists() or not path.is_file():
            continue
        files.append(path)

    exclude_patterns = [p for p in excludes if p]
    if exclude_patterns:
        filtered: List[Path] = []
        for path in files:
            path_str = str(path)
            if any(fnmatch.fnmatch(path_str, pat) for pat in exclude_patterns):
                continue
            filtered.append(path)
        files = filtered

    return sorted(files, key=lambda p: str(p).lower())


def manifest_path(mirror_root: Path) -> Path:
    return mirror_root / MANIFEST_NAME


def read_manifest(mirror_root: Path) -> Set[Path]:
    p = manifest_path(mirror_root)
    if not p.exists():
        return set()
    out: Set[Path] = set()
    for raw in p.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        out.add(Path(line))
    return out


def write_manifest(mirror_root: Path, managed_paths: Sequence[Path]) -> None:
    p = manifest_path(mirror_root)
    lines = [str(path) for path in sorted(managed_paths, key=lambda item: str(item).lower())]
    p.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def prune_from_manifest(mirror_root: Path) -> Tuple[int, int, int]:
    if not mirror_root.exists():
        return 0, 0, 0

    managed = read_manifest(mirror_root)
    removed_files = 0
    removed_dirs = 0

    for rel in sorted(managed, key=lambda p: (len(p.parts), str(p)), reverse=True):
        target = mirror_root / rel
        if target.is_file() or target.is_symlink():
            target.unlink()
            removed_files += 1

    for path in sorted(mirror_root.rglob("*"), key=lambda p: (len(p.parts), str(p)), reverse=True):
        if path.is_dir():
            try:
                path.rmdir()
                removed_dirs += 1
            except OSError:
                pass

    unmanaged = 0
    for path in mirror_root.rglob("*"):
        if path.name == MANIFEST_NAME:
            continue
        if path.is_file() or path.is_symlink():
            unmanaged += 1

    return removed_files, removed_dirs, unmanaged


def ensure_hardlink(dst: Path, src: Path) -> str:
    dst.parent.mkdir(parents=True, exist_ok=True)

    if dst.exists():
        if dst.is_dir():
            raise SystemExit(f"Refusing to replace directory with hardlink: {dst}")
        if os.path.samefile(dst, src):
            return "kept"
        dst.unlink()
        try:
            os.link(src, dst)
        except OSError as exc:
            if exc.errno == errno.EXDEV:
                raise SystemExit(
                    f"Cross-device hardlink is not possible.\nsource: {src}\ntarget: {dst}\n"
                    "Put --mirror-root on the same filesystem as source data."
                ) from exc
            raise
        return "updated"

    try:
        os.link(src, dst)
    except OSError as exc:
        if exc.errno == errno.EXDEV:
            raise SystemExit(
                f"Cross-device hardlink is not possible.\nsource: {src}\ntarget: {dst}\n"
                "Put --mirror-root on the same filesystem as source data."
            ) from exc
        raise
    return "created"


def enforce_directory_mode(root: Path, mode: int = 0o755) -> None:
    root.mkdir(parents=True, exist_ok=True)
    os.chmod(root, mode)
    for path in root.rglob("*"):
        if path.is_dir():
            os.chmod(path, mode)


def validate_source_path(src: Path) -> None:
    if not any(src.is_relative_to(prefix) for prefix in ALLOWED_SOURCE_PREFIXES):
        allowed = ", ".join(sorted(str(p) for p in ALLOWED_SOURCE_PREFIXES))
        raise SystemExit(
            f"Source path is outside allowed prefixes: {src}\nAllowed: {allowed}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Rebuild a hardlink mirror as /pdp/<portal>/<file>.nc from portal file-pattern definitions."
    )
    parser.add_argument(
        "--patterns-dir",
        default=str(REPO_ROOT / "portal-prep" / "portal-file-patterns"),
        help="Directory containing per-portal file-pattern files (<portal>.txt).",
    )
    parser.add_argument(
        "--mirror-root",
        default=str(DEFAULT_MIRROR_ROOT),
        help="Output root for hardlinks; links are written to <mirror-root>/<portal>/<basename>.",
    )
    parser.add_argument(
        "--portal",
        action="append",
        help="Portal id(s). If omitted, process all pattern files in --patterns-dir.",
    )
    parser.add_argument(
        "--no-clean",
        action="store_true",
        help="Do not clean mirror root before creating hardlinks.",
    )
    args = parser.parse_args()

    patterns_dir = Path(args.patterns_dir).resolve()
    mirror_root = Path(args.mirror_root).resolve()

    portal_ids = [p for p in (args.portal or []) if p]
    if not portal_ids:
        portal_ids = sorted(path.stem for path in patterns_dir.glob("*.txt"))

    file_lists = [patterns_dir / f"{portal_id}.txt" for portal_id in portal_ids]
    missing_lists = [path for path in file_lists if not path.exists()]
    if missing_lists:
        lines = "\n".join(f"  - {path}" for path in missing_lists)
        raise SystemExit(f"Missing portal pattern files:\n{lines}")
    if not file_lists:
        raise SystemExit(f"No portal file-pattern files found under {patterns_dir}")

    wanted: Dict[Path, Path] = {}
    all_matches = 0
    per_portal_counts: Dict[str, int] = {}
    for file_list in file_lists:
        portal_id = file_list.stem
        includes, excludes = read_file_list(file_list)
        files = expand_file_list(includes, excludes)
        all_matches += len(files)
        per_portal_counts[portal_id] = len(files)

        for src in files:
            validate_source_path(src)
            if src.is_relative_to(mirror_root):
                raise SystemExit(f"Source path is inside mirror root, refusing: {src}")

            dst = mirror_root / portal_id / src.name
            existing = wanted.get(dst)
            if existing is not None and existing != src:
                raise SystemExit(
                    f"Conflicting sources map to same mirror path:\n"
                    f"  dst:    {dst}\n"
                    f"  first:  {existing}\n"
                    f"  second: {src}\n"
                    f"Filenames must be unique per portal."
                )
            wanted[dst] = src

    removed_files = 0
    removed_dirs = 0
    unmanaged_files = 0
    if not args.no_clean:
        removed_files, removed_dirs, unmanaged_files = prune_from_manifest(mirror_root)

    mirror_root.mkdir(parents=True, exist_ok=True)

    created = 0
    updated = 0
    kept = 0
    for dst, src in sorted(wanted.items(), key=lambda item: str(item[0]).lower()):
        status = ensure_hardlink(dst, src)
        if status == "created":
            created += 1
        elif status == "updated":
            updated += 1
        else:
            kept += 1

    managed_rel = [path.relative_to(mirror_root) for path in wanted.keys()]
    write_manifest(mirror_root, managed_rel)
    enforce_directory_mode(mirror_root, mode=0o755)

    print(f"portal pattern files: {len(file_lists)}")
    for portal_id in sorted(per_portal_counts):
        print(f"  {portal_id}: {per_portal_counts[portal_id]} files")
    print(f"matches:   {all_matches} input files")
    print(f"wanted:    {len(wanted)}")
    if not args.no_clean:
        print(f"cleaned files: {removed_files}")
        print(f"cleaned dirs:  {removed_dirs}")
        if unmanaged_files:
            print(f"unmanaged files kept: {unmanaged_files}")
    print(f"created:   {created}")
    print(f"updated:   {updated}")
    print(f"kept:      {kept}")
    print(f"root:      {mirror_root}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

