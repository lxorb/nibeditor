"""A build machine's boot script with this run's values in, as the custom data Azure takes.

    boot.py windows <arch> <jit config> <runner url> <run id> <repo> <lifetime min> <row>
"""

import base64
import pathlib
import re
import sys

_, arch, jit, url, run_id, repo, lifetime, row = sys.argv[1:9]
values = {
    "JIT": jit,
    "RUNNER_URL": url,
    "RUN_ID": run_id,
    "REPO": repo,
    "LIFETIME": lifetime,
    "ARM64": "1" if arch == "arm64" else "0",
    "ROW": row,
}
for key, value in values.items():
    # Everything lands inside single quotes in the script.
    if not re.fullmatch(r"[A-Za-z0-9+/=:._\-]+", value):
        sys.exit(f"boot.py: {key} has a character the script cannot carry")

script = (pathlib.Path(__file__).parent / "boot.ps1").read_text(encoding="utf-8")
script = re.sub(r"__([A-Z0-9_]+)__", lambda m: values[m.group(1)], script)
print(base64.b64encode(script.encode("utf-8")).decode("ascii"))
