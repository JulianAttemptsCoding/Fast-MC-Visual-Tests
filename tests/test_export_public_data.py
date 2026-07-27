from __future__ import annotations

import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from scripts.export_public_data import export


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class ExportTest(unittest.TestCase):
    def fixture(self, root: Path, test_events: int = 0) -> tuple[Path, Path]:
        source, destination = root / "source", root / "public"
        source.mkdir()
        geometry_contract = "g" * 64
        geometry = (
            json.dumps({"geometry": "fixed", "geometry_sha256": geometry_contract}) + "\n"
        ).encode()
        (source / "geometry.json").write_bytes(geometry)
        groups = [{"fast_mc": [{}, {}, {}, {}, {}]} for _ in range(50)]
        artifact = {
            "epoch": 2,
            "stage": "joint",
            "checkpoint_sha256": "c" * 64,
            "selection_sha256": "s" * 64,
            "sample_count": 50,
            "draws_per_condition": 5,
            "groups": groups,
            "qa": {"pass": True, "test_events_used": test_events},
        }
        artifact_bytes = (json.dumps(artifact, separators=(",", ":")) + "\n").encode()
        (source / "epoch.json").write_bytes(artifact_bytes)
        manifest = {
            "schema_version": 3,
            "geometry_path": "geometry.json",
            "geometry_sha256": geometry_contract,
            "selection_sha256": "s" * 64,
            "latest_id": "run:joint:0002",
            "epochs": [
                {
                    "id": "run:joint:0002",
                    "epoch": 2,
                    "stage": "joint",
                    "path": "epoch.json",
                    "sha256": digest(artifact_bytes),
                    "checkpoint_sha256": "c" * 64,
                }
            ],
        }
        (source / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        return source, destination

    def test_exports_deterministic_verified_gzip(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source, destination = self.fixture(Path(temporary))
            first = export(source, destination)
            first_bytes = (destination / first["epochs"][0]["path"]).read_bytes()
            second = export(source, destination)
            second_bytes = (destination / second["epochs"][0]["path"]).read_bytes()
            self.assertEqual(first_bytes, second_bytes)
            self.assertEqual(gzip.decompress(first_bytes), (source / "epoch.json").read_bytes())
            self.assertEqual(first["epochs"][0]["sha256"], digest(first_bytes))

    def test_rejects_test_split_use(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source, destination = self.fixture(Path(temporary), test_events=1)
            with self.assertRaisesRegex(ValueError, "closed-test gate"):
                export(source, destination)


if __name__ == "__main__":
    unittest.main()
