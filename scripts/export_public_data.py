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


def export(
    source: Path,
    destination: Path,
    selected_ids: list[str] | None = None,
    default_snapshot_id: str | None = None,
) -> dict[str, Any]:
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

    source_rows = manifest["epochs"]
    if selected_ids is not None:
        if len(selected_ids) != len(set(selected_ids)):
            raise ValueError("public selection contains duplicate snapshot IDs")
        by_id = {row.get("id"): row for row in source_rows}
        missing = [snapshot_id for snapshot_id in selected_ids if snapshot_id not in by_id]
        if missing:
            raise ValueError(f"public selection IDs missing from source manifest: {missing}")
        source_rows = [by_id[snapshot_id] for snapshot_id in selected_ids]
        if any("calibrated" not in str(row.get("run_label", "")) for row in source_rows):
            raise ValueError("public selection contains a non-calibrated run")

    public_rows: list[dict[str, Any]] = []
    expected_paths: set[str] = set()
    for row in source_rows:
        raw_path = source / row["path"]
        raw = raw_path.read_bytes()
        if sha256_bytes(raw) != row["sha256"]:
            raise ValueError(f"{row['path']}: source SHA-256 mismatch")
        artifact = json.loads(raw)
        validate_artifact(artifact, row, manifest)
        compressed = gzip.compress(raw, compresslevel=6, mtime=0)
        relative = f"epochs/{Path(row['path']).name}.gz"
        expected_paths.add(relative)
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
    public_manifest["latest_id"] = public_rows[-1]["id"]
    public_manifest["latest_epoch"] = public_rows[-1]["epoch"]
    available_ids = {str(row["id"]) for row in public_rows}
    if default_snapshot_id is None:
        default_snapshot_id = str(public_rows[-1]["id"])
    if default_snapshot_id not in available_ids:
        raise ValueError("default snapshot is not in the public selection")
    public_manifest["default_snapshot_id"] = default_snapshot_id
    public_manifest["publication_selection"] = {
        "policy": "one accepted checkpoint per calibrated model family",
        "snapshot_count": len(public_rows),
        "default_snapshot_id": default_snapshot_id,
    }
    atomic_write(destination / "manifest.json", canonical_json(public_manifest))
    epoch_directory = (destination / "epochs").resolve()
    removed = 0
    if epoch_directory.exists():
        for candidate in epoch_directory.glob("*.json.gz"):
            if candidate.parent.resolve() != epoch_directory:
                raise ValueError(f"unsafe generated-artifact cleanup target: {candidate}")
            relative = candidate.relative_to(destination.resolve()).as_posix()
            if relative not in expected_paths:
                candidate.unlink()
                removed += 1
    public_manifest["_removed_stale_epoch_files"] = removed
    return public_manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--destination", required=True, type=Path)
    parser.add_argument("--selection", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    selected_ids = None
    default_snapshot_id = None
    if args.selection:
        selection = json.loads(args.selection.resolve().read_text(encoding="utf-8"))
        if selection.get("schema_version") != 1:
            raise ValueError("unsupported public selection schema")
        snapshots = selection.get("snapshots", [])
        families = [row.get("family") for row in snapshots]
        if not snapshots or len(families) != len(set(families)):
            raise ValueError("public selection must contain unique model families")
        selected_ids = [str(row["id"]) for row in snapshots]
        default_snapshot_id = selection.get("default_snapshot_id")
    manifest = export(
        args.source.resolve(),
        args.destination.resolve(),
        selected_ids,
        default_snapshot_id,
    )
    compressed = sum(row["compressed_bytes"] for row in manifest["epochs"])
    print(
        json.dumps(
            {
                "epochs": len(manifest["epochs"]),
                "latest_id": manifest.get("latest_id"),
                "default_snapshot_id": manifest.get("default_snapshot_id"),
                "compressed_bytes": compressed,
                "test_events_used": 0,
                "removed_stale_epoch_files": manifest.pop("_removed_stale_epoch_files", 0),
                "qa": "PASS",
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
