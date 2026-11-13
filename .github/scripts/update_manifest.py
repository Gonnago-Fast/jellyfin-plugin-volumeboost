"""Adds the current release to manifest.json (Jellyfin plugin repository format).

Reads plugin metadata from build.yaml (simple "key: value" lines) and the release
details from env vars: VERSION, MD5, URL, OWNER.
"""
import datetime
import json
import os
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
meta = {}
for line in (root / "build.yaml").read_text(encoding="utf-8").splitlines():
    m = re.match(r'^(\w+):\s*"?(.*?)"?\s*$', line)
    if m and m.group(2) not in ("", ">"):
        meta[m.group(1)] = m.group(2)

version = os.environ["VERSION"]
manifest_path = root / "manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else []

plugin = next((p for p in manifest if p.get("guid") == meta["guid"]), None)
if plugin is None:
    plugin = {"guid": meta["guid"], "versions": []}
    manifest.append(plugin)

plugin.update({
    "name": meta["name"],
    "description": meta.get("overview", ""),
    "overview": meta.get("overview", ""),
    "owner": os.environ.get("OWNER", meta.get("owner", "")),
    "category": meta.get("category", "General"),
})

plugin["versions"] = [v for v in plugin["versions"] if v["version"] != version]
plugin["versions"].insert(0, {
    "version": version,
    "changelog": f"See https://github.com/{os.environ.get('GITHUB_REPOSITORY', '')}/releases",
    "targetAbi": meta["targetAbi"],
    "sourceUrl": os.environ["URL"],
    "checksum": os.environ["MD5"],
    "timestamp": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
})

manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"manifest.json: added {meta['name']} {version}")
