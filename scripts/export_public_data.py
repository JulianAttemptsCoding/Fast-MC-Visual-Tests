#!/usr/bin/env python3
"""Validate and deterministically compress visual QA artifacts for GitHub Pages."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def validate_artifact(artifact: dict[str, Any], row: dict[str, Any], manifest: dict[str, Any]) -> None:
    if artifact.get("epoch") != row.get("epoch") or artifact.get("stage") != row.get("stage"):
        raise ValueError(f"{row['path']}: epoch/stage mismatch")
    if artifact.get("checkpoint_sha256") != row.get("checkpoint_sha256"):
        raise ValueError(f"{row['path']}: checkpoint hash mismatch")
    if artifact.get("selection_sha256") != manifest.get("selection_sha256"):
        raise ValueError(f"{row['path']}: fixed validation selection mismatch")
    qa = artifact.get("qa", {})
    if qa.get("pass") is not True or qa.get("test_events_used") != 0:
        raise ValueError(f"{row['path']}: visualization QA or closed-test gate failed")
    groups = artifact.get("groups", [])
    if artifact.get("sample_count") != 50 or len(groups) != 50:
        raise ValueError(f"{row['path']}: expected exactly 50 validation conditions")
    if artifact.get("draws_per_condition") != 5:
        raise ValueError(f"{row['path']}: expected exactly five Fast-MC draws")
    if any(len(group.get("fast_mc", [])) != 5 for group in groups):
        raise ValueError(f"{row['path']}: incomplete five-draw event group")


def export(source: Path, destination: Path) -> dict[str, Any]:
    manifest_path = source / "manifest.json"
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest.get("schema_version") != 3:
        raise ValueError("unsupported manifest schema")
    if not manifest.get("epochs"):
        raise ValueError("manifest has no epoch snapshots")

    geometry_path = source / manifest["geometry_path"]
    geometry_bytes = geometry_path.read_bytes()
    geometry = json.loads(geometry_bytes)
    if geometry.get("geometry_sha256") != manifest["geometry_sha256"]:
        raise ValueError("geometry contract hash mismatch")
    atomic_write(destination / manifest["geometry_path"], geometry_bytes)

    public_rows: list[dict[str, Any]] = []
    for row in manifest["epochs"]:
        raw_path = source / row["path"]
        raw = raw_path.read_bytes()
        if sha256_bytes(raw) != row["sha256"]:
            raise ValueError(f"{row['path']}: source SHA-256 mismatch")
        artifact = json.loads(raw)
        validate_artifact(artifact, row, manifest)
        compressed = gzip.compress(raw, compresslevel=6, mtime=0)
        relative = f"epochs/{Path(row['path']).name}.gz"
        atomic_write(destination / relative, compressed)
        public_row = dict(row)
        public_row["path"] = relative
        public_row["source_sha256"] = row["sha256"]
        public_row["sha256"] = sha256_bytes(compressed)
        public_row["compressed_bytes"] = len(compressed)
        public_rows.append(public_row)

    public_manifest = dict(manifest)
    public_manifest["public_data_format"] = "gzip-json-v1"
    public_manifest["geometry_file_sha256"] = sha256_bytes(geometry_bytes)
    public_manifest["source_manifest_sha256"] = sha256_bytes(manifest_bytes)
    public_manifest["epochs"] = public_rows
    atomic_write(destination / "manifest.json", canonical_json(public_manifest))
    return public_manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--destination", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest = export(args.source.resolve(), args.destination.resolve())
    compressed = sum(row["compressed_bytes"] for row in manifest["epochs"])
    print(
        json.dumps(
            {
                "epochs": len(manifest["epochs"]),
                "latest_id": manifest.get("latest_id"),
                "compressed_bytes": compressed,
                "test_events_used": 0,
                "qa": "PASS",
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
