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

    def test_event_metrics_define_comparison_equations_and_variables(self) -> None:
        source = (ROOT / "src" / "ZdcDashboard.tsx").read_text(encoding="utf-8")
        self.assertIn("Fast MC average − Geant4", source)
        self.assertIn("one fixed four-momentum input", source)
        self.assertIn("T = Σᵢ Eᵢ", source)
        self.assertIn("Nhit = Σᵢ 1(Eᵢ > 0)", source)
        self.assertIn("L̄ = (Σₗ l · Eₗ) / T", source)
        self.assertIn("rRMS = √[Σᵢ Eᵢ", source)
        self.assertIn("fECAL = E₀ / T", source)
        self.assertIn("flate = (Σₗ₌₄₈⁶⁴ Eₗ) / T", source)
        self.assertIn("Fast MC average (5 showers)", source)
        self.assertNotIn("MC μ", source)

    def test_longitudinal_chart_uses_nonoverlapping_switchable_scale(self) -> None:
        source = (ROOT / "src" / "components" / "Charts.tsx").read_text(encoding="utf-8")
        self.assertIn("Math.log10", source)
        self.assertIn("base-10 logarithmic", source)
        self.assertIn("log10 scale · zero at floor", source)
        self.assertIn('useState<ProfileScale>("log")', source)
        self.assertIn('onClick={() => setScale("linear")}', source)
        self.assertIn("linear scale", source)
        self.assertIn("left: 72", source)
        self.assertIn('textAnchor="end"', source)
        self.assertIn('dominantBaseline="middle"', source)


if __name__ == "__main__":
    unittest.main()
