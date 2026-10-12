#!/usr/bin/env python3
"""Parse the Unusual Whales OpenAPI spec into a flat endpoint inventory."""
from __future__ import annotations

import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "docs" / "openapi.yaml"
OUT = ROOT / "docs" / "endpoints.json"


def main() -> None:
    spec = yaml.safe_load(SPEC.read_text())
    servers = spec.get("servers", [])
    base = servers[0]["url"] if servers else "https://api.unusualwhales.com"

    endpoints = []
    for path, ops in spec.get("paths", {}).items():
        for method, op in ops.items():
            if method not in {"get", "post"}:
                continue
            params = op.get("parameters", []) or []
            path_params = [p["name"] for p in params if p.get("in") == "path"]
            required_query = [
                p["name"]
                for p in params
                if p.get("in") == "query" and p.get("required")
            ]
            optional_query = [
                p["name"]
                for p in params
                if p.get("in") == "query" and not p.get("required")
            ]
            endpoints.append(
                {
                    "method": method.upper(),
                    "path": path,
                    "tags": op.get("tags", []),
                    "summary": op.get("summary", ""),
                    "operation_id": op.get("operationId", ""),
                    "path_params": path_params,
                    "required_query": required_query,
                    "optional_query": optional_query,
                }
            )

    endpoints.sort(key=lambda e: (e["tags"][0] if e["tags"] else "zzz", e["path"]))
    OUT.write_text(json.dumps({"base_url": base, "count": len(endpoints), "endpoints": endpoints}, indent=2))

    by_tag: dict[str, int] = {}
    for e in endpoints:
        tag = e["tags"][0] if e["tags"] else "untagged"
        by_tag[tag] = by_tag.get(tag, 0) + 1
    print(f"parsed {len(endpoints)} endpoints from {SPEC.name}")
    print(f"base_url={base}")
    print("by tag:")
    for tag, n in sorted(by_tag.items()):
        print(f"  {tag:24s} {n}")


if __name__ == "__main__":
    main()
