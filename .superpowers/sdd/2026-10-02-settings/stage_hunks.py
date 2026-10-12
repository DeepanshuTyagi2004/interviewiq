"""Stage selected hunks of one file's working-tree diff (vs HEAD) into the index.

usage: stage_hunks.py FILE KEEP [DROP_FROM_REGEX DROP_UNTIL_REGEX]
  KEEP: comma-separated hunk indexes (0-based) to stage.
  Optional: inside kept hunks, drop the '+' lines from the first line matching
  DROP_FROM_REGEX up to (not including) the first later line matching DROP_UNTIL_REGEX.
  A single '+' line can be dropped with DROP_FROM_REGEX and DROP_UNTIL_REGEX='^$NEVER'
  combined with --one (drops just the matching line).
"""
import re
import subprocess
import sys

path, keep = sys.argv[1], {int(i) for i in sys.argv[2].split(",")}
drop_from = re.compile(sys.argv[3]) if len(sys.argv) > 3 else None
drop_until = re.compile(sys.argv[4]) if len(sys.argv) > 4 else None
one = "--one" in sys.argv

diff = subprocess.run(["git", "diff", "HEAD", "--", path], capture_output=True, text=True, check=True).stdout
lines = diff.splitlines(keepends=True)
header, hunks, cur = [], [], None
for ln in lines:
    if ln.startswith("@@"):
        cur = [ln]
        hunks.append(cur)
    elif cur is None:
        header.append(ln)
    else:
        cur.append(ln)

out = list(header)
for i, h in enumerate(hunks):
    if i not in keep:
        continue
    dropping = False
    kept = [h[0]]
    for ln in h[1:]:
        body = ln[1:]
        if drop_from and ln.startswith("+") and not dropping and drop_from.search(body):
            if one:
                continue
            dropping = True
            continue
        if dropping:
            if drop_until and drop_until.search(body):
                dropping = False
            else:
                if ln.startswith("+"):
                    continue
                dropping = False
        kept.append(ln)
    out.extend(kept)

patch = "".join(out)
subprocess.run(["git", "apply", "--cached", "--recount", "-"], input=patch, text=True, check=True)
print(f"staged hunks {sorted(keep)} of {path} ({len(hunks)} total)")
