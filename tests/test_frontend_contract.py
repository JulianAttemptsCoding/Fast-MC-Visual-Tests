from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class FrontendContractTest(unittest.TestCase):
    def test_detector_rendering_keeps_bounded_frame_cost(self) -> None:
        source = (ROOT / "src" / "components" / "EnergyCloud.tsx").read_text(encoding="utf-8")
        self.assertNotIn("createRadialGradient", source)
        self.assertIn("requestAnimationFrame", source)
        self.assertIn("Math.min(window.devicePixelRatio || 1, 1.25)", source)
        self.assertIn("context.globalCompositeOperation = \"lighter\"", source)

    def test_public_interface_explains_scale_and_selection(self) -> None:
        source = (ROOT / "src" / "ZdcDashboard.tsx").read_text(encoding="utf-8")
        self.assertIn("Detector-view key", source)
        self.assertIn("normalised to its own largest cell deposit", source)
        self.assertIn("one checkpoint each", source)
        self.assertNotIn("A100 SCREENING · NO-GO", source)
        self.assertIn("Longitudinal shower-profile error", source)
        self.assertIn("Mean FastMC–Geant4 layer-energy mismatch across all 65 ZDC layers", source)
        self.assertIn("0% is identical", source)
        self.assertNotIn("sample mean longitudinal relative L1", source)
        self.assertNotIn('label="Snapshot"', source)


if __name__ == "__main__":
    unittest.main()
