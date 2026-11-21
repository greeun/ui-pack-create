#!/usr/bin/env python3
"""Lists the pack files whose source changed since the source commit the pack was made from. Changes nothing.

Usage: python3 source-changes.py <pack dir> [--since <commit>]
Output: 1) changed source files, the matching pack files, and changed line counts
        2) files added in source folders that hold pack files (decide whether to include them with the classification in extract.md)
A person (or Claude) applies the changes by reading the diff of each file. --since tries a different base commit (for testing).
Pack files carry pack-only edits such as the ui-pack-config wiring, so never overwrite them with the source.
"""
import json, pathlib, subprocess, sys

args = sys.argv[1:]
since = None
if "--since" in args:
    i = args.index("--since")
    since = args[i + 1]
    del args[i:i + 2]
pack = pathlib.Path(args[0]).expanduser()
meta = json.loads((pack / "pack.json").read_text())
if not meta.get("source", {}).get("repo"):
    sys.exit(f"The pack {meta['name']} has no source repository (made without source code). Nothing to sync.")
repo = pathlib.Path(meta["source"]["repo"])
base = since or meta["source"]["commit"]

def git(*a):
    return subprocess.run(["git", "-C", str(repo), *a], capture_output=True, text=True, check=True).stdout

head = git("rev-parse", "--short", "HEAD").strip()
changed = {}
for line in git("diff", "--numstat", f"{base}..HEAD").splitlines():
    add, rem, path = line.split("\t")
    changed[path] = f"+{add} -{rem}"

rows = []
for pack_rel, src_rel in meta["sources"].items():
    if pack_rel.endswith("/"):
        for f in sorted((pack / pack_rel).glob("*")):
            if f.is_file():
                s = src_rel + f.name
                if s in changed:
                    rows.append((s, pack_rel + f.name, changed[s]))
    elif src_rel in changed:
        rows.append((src_rel, pack_rel, changed[src_rel]))

# Files added in source folders that hold pack files (subfolders are not checked). Files already matched to the pack are excluded.
mapped, dirs = set(), set()
for pack_rel, src_rel in meta["sources"].items():
    if pack_rel.endswith("/"):
        dirs.add(src_rel.rstrip("/"))
        mapped.update(src_rel + f.name for f in (pack / pack_rel).glob("*") if f.is_file())
    else:
        dirs.add(str(pathlib.PurePosixPath(src_rel).parent))
        mapped.add(src_rel)
added = [p for p in git("diff", "--name-only", "--diff-filter=A", f"{base}..HEAD").splitlines()
         if str(pathlib.PurePosixPath(p).parent) in dirs and p not in mapped]

print(f"Source: {repo}  pack base commit: {base}  current: {head}")
if not rows:
    print("No pack file has changed in the source.")
for s, p, n in sorted(set(rows)):
    print(f"{n:>10}  {s}  →  {p}")
if added:
    print("\nFiles added in the source (in folders that hold pack files). Decide with the classification in extract.md (as-is / after wiring / reference pattern / excluded),")
    print("and when you include one, record it in sources and components of pack.json (add it to catalog.json first if the component is not there):")
    for p in added:
        print(f"  + {p}")
print("\nHow to apply: read git -C <source> diff <base commit>..HEAD -- <source file>, carry it into the pack file, then update source.commit in pack.json.")
