"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EnergyCloud, type CameraState } from "./components/EnergyCloud";
import {
  DistributionStrip,
  EpochTrendChart,
  LayerProfileChart,
} from "./components/Charts";

type Trend = {
  truth_response_mean_gev: number;
  generated_response_mean_gev: number;
  response_bias_fraction: number;
  truth_hit_count_mean: number;
  generated_hit_count_mean: number;
  hit_count_bias_fraction: number;
  mean_longitudinal_profile_relative_l1: number;
};

type EpochRow = {
  id?: string;
  run_label?: string | null;
  epoch: number;
  stage: string;
  path: string;
  sha256: string;
  checkpoint_sha256: string;
  qa_pass: boolean;
  elapsed_seconds: number;
  trend: Trend;
};

type Manifest = {
  schema_version: number;
  public_data_format?: string;
  latest_epoch: number;
  latest_id?: string;
  geometry_path: string;
  geometry_sha256: string;
  selection_sha256: string;
  source_uri?: string;
  epochs: EpochRow[];
};

type Geometry = {
  schema_version: number;
  geometry_sha256: string;
  n_nodes: number;
  positions_mm: number[][];
  layer_index: number[];
  subdetector: number[];
};

type Deposit = {
  cell_index: number[];
  energy_gev: number[];
};

type EventSummary = {
  total_response_gev: number;
  hit_count: number;
  depth_centroid_layer: number;
  x_centroid_mm: number;
  y_centroid_mm: number;
  radial_rms_mm: number;
  top1_fraction: number;
  ecal_fraction: number;
  late_fraction: number;
  layer_energy_gev: number[];
};

type Shower = {
  deposit: Deposit;
  summary: EventSummary;
};

type FastShower = Shower & {
  draw: number;
  seed_group: number;
};

type EventGroup = {
  selection_position: number;
  dataset_index: number;
  global_index: number;
  event_id: number;
  source_group: number;
  kinetic_energy_gev: number;
  p4_total_gev: number[];
  geant4: Shower;
  fast_mc: FastShower[];
};

type EpochArtifact = {
  schema_version: number;
  scientific_status: string;
  synthetic_source: boolean;
  epoch: number;
  stage: string;
  checkpoint_sha256: string;
  split: string;
  sample_count: number;
  draws_per_condition: number;
  profile_steps: number;
  share_steps: number;
  selection_sha256: string;
  groups: EventGroup[];
  aggregate: { trend: Trend };
  qa: {
    pass: boolean;
    test_events_used: number;
    invariants: Record<string, number | boolean>;
  };
  elapsed_seconds: number;
};

type LoadedSource = {
  root: string;
  manifest: Manifest;
};

const COLORS = ["#007a95", "#1687a0", "#2f91a9", "#479bb1", "#5fa5b9"];
const DEFAULT_CAMERA: CameraState = { yaw: -0.72, pitch: -0.34, zoom: 1.08 };
const DATA_ROOT = `${import.meta.env.BASE_URL}data`;

const shortHash = (value: string | undefined) =>
  value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";

const signed = (value: number, digits = 1) =>
  `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;

const snapshotId = (row: Pick<EpochRow, "id" | "stage" | "epoch">) =>
  row.id ?? `${row.stage}:${String(row.epoch).padStart(4, "0")}`;

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchEpoch(path: string, expectedSha256: string): Promise<EpochArtifact> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const compressed = await response.arrayBuffer();
  if ((await sha256Hex(compressed)) !== expectedSha256) {
    throw new Error("Downloaded epoch artifact hash mismatch");
  }
  if (!("DecompressionStream" in window)) {
    throw new Error("This browser cannot open gzip epoch evidence. Use a current browser.");
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  return (await new Response(stream).json()) as EpochArtifact;
}

async function loadSource(): Promise<LoadedSource> {
  const manifest = await fetchJson<Manifest>(`${DATA_ROOT}/manifest.json`);
  if (manifest.schema_version !== 3 || manifest.public_data_format !== "gzip-json-v1") {
    throw new Error("Unsupported public evidence manifest");
  }
  return { root: DATA_ROOT, manifest };
}

function runName(value: string | null | undefined): string {
  const names: Record<string, string> = {
    "viability-wave2-r1-calibrated-lr3e4": "Calibrated · LR 3×10⁻⁴",
    "viability-wave2-r1-calibrated-lr1e4-halfbatch":
      "Calibrated · LR 1×10⁻⁴ · half batch",
    "viability-r1-calibrated-lr3e5": "Calibration · LR 3×10⁻⁵",
    "viability-r1-calibrated-lr1e4": "Calibration · LR 1×10⁻⁴",
    "viability-r1-calibrated-lr1e4-halfbatch": "Calibration · LR 1×10⁻⁴ · half batch",
    "viability-r1-calibrated-lr3e4": "Calibration · LR 3×10⁻⁴",
  };
  if (!value) return "Unlabelled run";
  if (names[value]) return names[value];
  return value
    .replace(/^component-/, "Component · ")
    .replace(/^viability-/, "Viability · ")
    .replaceAll("-", " ");
}

function StatCard({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className={`stat-card ${accent ? "stat-card--accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function MetricCell({
  label,
  question,
  explanation,
  equation,
  variables,
  interpretation,
  comparisonKind,
  truth,
  generated,
  unit = "",
  format = "decimal",
}: {
  label: string;
  question: string;
  explanation: string;
  equation: string;
  variables: string;
  interpretation: string;
  comparisonKind: "energy" | "count" | "depth" | "width" | "fraction";
  truth: number;
  generated: number[];
  unit?: string;
  format?: "decimal" | "integer" | "percent";
}) {
  const mean = generated.reduce((sum, value) => sum + value, 0) / generated.length;
  const delta = mean - truth;

  const formatValue = (value: number) => {
    if (format === "integer") return Math.round(value).toLocaleString();
    if (format === "percent") return `${(value * 100).toFixed(1)}%`;
    return `${value.toFixed(2)}${unit}`;
  };

  const formatDifference = (value: number) => {
    const sign = value >= 0 ? "+" : "−";
    const magnitude = Math.abs(value);
    if (format === "integer") return `${sign}${magnitude.toFixed(1)} cells`;
    if (format === "percent") return `${sign}${(magnitude * 100).toFixed(1)} percentage points`;
    return `${sign}${magnitude.toFixed(2)}${unit}`;
  };

  const describeDifference = () => {
    if (Math.abs(delta) < 1e-12) {
      return "The Fast-MC average and Geant4 have the same value for this summary.";
    }
    if (comparisonKind === "depth") {
      return `The Fast-MC shower centre is ${Math.abs(delta).toFixed(1)} layers ${
        delta > 0 ? "deeper in the detector" : "closer to the detector front"
      } than the Geant4 shower.`;
    }
    if (comparisonKind === "fraction") {
      return `Fast MC places ${Math.abs(delta * 100).toFixed(1)} percentage points ${
        delta > 0 ? "more" : "less"
      } of the shower energy in this detector region than Geant4.`;
    }
    const percent = Math.abs(truth) > 1e-12 ? (Math.abs(delta) / Math.abs(truth)) * 100 : null;
    if (comparisonKind === "count") {
      return `The Fast-MC average lights up ${Math.abs(delta).toFixed(0)} ${
        delta > 0 ? "more" : "fewer"
      } cells than Geant4${percent === null ? "" : ` (${percent.toFixed(0)}% difference)`}.`;
    }
    if (comparisonKind === "width") {
      return `The Fast-MC shower is ${Math.abs(delta).toFixed(1)} mm ${
        delta > 0 ? "wider" : "narrower"
      } than the Geant4 shower${percent === null ? "" : ` (${percent.toFixed(0)}% difference)`}.`;
    }
    return `The Fast-MC average deposits ${percent === null ? `${Math.abs(delta).toFixed(2)} GeV` : `${percent.toFixed(0)}%`} ${
      delta > 0 ? "more" : "less"
    } energy than the Geant4 shower.`;
  };

  return (
    <div className="metric-cell">
      <div className="metric-cell__heading">
        <span>{question}</span>
        <h4>{label}</h4>
        <p>{explanation}</p>
      </div>
      <p className="metric-result">{describeDifference()}</p>
      <dl className="metric-comparison">
        <div>
          <dt>Geant4 reference</dt>
          <dd>{formatValue(truth)}</dd>
        </div>
        <div>
          <dt>Fast MC average (5 showers)</dt>
          <dd>{formatValue(mean)}</dd>
        </div>
        <div>
          <dt>Difference: Fast MC average − Geant4</dt>
          <dd className={Math.abs(delta) < 1e-12 ? "" : delta > 0 ? "is-positive" : "is-negative"}>
            {formatDifference(delta)}
          </dd>
        </div>
      </dl>
      <div className="metric-formula">
        <span>Equation</span>
        <code>{equation}</code>
        <p>{variables}</p>
      </div>
      <p className="metric-interpretation">{interpretation}</p>
    </div>
  );
}

export function ZdcDashboard() {
  const [source, setSource] = useState<LoadedSource | null>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [artifact, setArtifact] = useState<EpochArtifact | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState(0);
  const [camera, setCamera] = useState<CameraState>(DEFAULT_CAMERA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refreshManifest = useCallback(async () => {
    const next = await loadSource();
    setSource(next);
    const latestRow =
      next.manifest.epochs.find(
        (row) => snapshotId(row) === next.manifest.latest_id,
      ) ??
      next.manifest.epochs.find(
        (row) => row.epoch === next.manifest.latest_epoch,
      ) ??
      next.manifest.epochs[next.manifest.epochs.length - 1];
    const latest = next.manifest.latest_id ?? snapshotId(latestRow);
    setSelectedSnapshot((current) =>
      current == null ||
      !next.manifest.epochs.some((row) => snapshotId(row) === current)
        ? latest
        : current,
    );
    setLastRefresh(new Date());
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    const initial = window.setTimeout(() => {
      refreshManifest()
        .catch((reason) => {
          if (active) setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);
    const timer = window.setInterval(() => {
      refreshManifest().catch(() => undefined);
    }, 60_000);
    return () => {
      active = false;
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refreshManifest]);

  useEffect(() => {
    if (!source) return;
    fetchJson<Geometry>(`${source.root}/${source.manifest.geometry_path}`)
      .then((value) => {
        if (value.geometry_sha256 !== source.manifest.geometry_sha256) {
          throw new Error("Geometry hash mismatch");
        }
        setGeometry(value);
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, [source]);

  useEffect(() => {
    if (!source || selectedSnapshot == null) return;
    const row = source.manifest.epochs.find(
      (entry) => snapshotId(entry) === selectedSnapshot,
    );
    if (!row) return;
    let active = true;
    const request = window.setTimeout(() => {
      setLoading(true);
      fetchEpoch(`${source.root}/${row.path}`, row.sha256)
        .then((value) => {
          if (!active) return;
          if (!value.qa.pass || value.qa.test_events_used !== 0) {
            throw new Error("Epoch visualization QA contract failed");
          }
          if (value.selection_sha256 !== source.manifest.selection_sha256) {
            throw new Error("Validation selection changed across epochs");
          }
          setArtifact(value);
          setSelectedEvent((current) => Math.min(current, value.groups.length - 1));
        })
        .catch((reason) => {
          if (active) setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(request);
    };
  }, [selectedSnapshot, source]);

  const group = artifact?.groups[selectedEvent];
  const epochRow = source?.manifest.epochs.find(
    (row) => snapshotId(row) === selectedSnapshot,
  );
  const selectedRun = epochRow?.run_label ?? epochRow?.stage ?? "";
  const runLabels = useMemo(
    () =>
      source
        ? [...new Set(source.manifest.epochs.map((row) => row.run_label ?? row.stage))]
        : [],
    [source],
  );
  const profileSeries = useMemo(() => {
    if (!group) return [];
    return [
      { name: "Geant4 reference", color: "#c45100", values: group.geant4.summary.layer_energy_gev },
      ...group.fast_mc.map((item, index) => ({
        name: `Fast MC ${index + 1}`,
        color: COLORS[index],
        values: item.summary.layer_energy_gev,
      })),
    ];
  }, [group]);

  const responseDistribution = useMemo(() => {
    if (!artifact) return { truth: [], generated: [] };
    return {
      truth: artifact.groups.map((item) => item.geant4.summary.total_response_gev),
      generated: artifact.groups.flatMap((item) =>
        item.fast_mc.map((sample) => sample.summary.total_response_gev),
      ),
    };
  }, [artifact]);

  const hitDistribution = useMemo(() => {
    if (!artifact) return { truth: [], generated: [] };
    return {
      truth: artifact.groups.map((item) => item.geant4.summary.hit_count),
      generated: artifact.groups.flatMap((item) =>
        item.fast_mc.map((sample) => sample.summary.hit_count),
      ),
    };
  }, [artifact]);

  if (loading && !artifact) {
    return (
      <main className="loading-screen">
        <div className="loading-orbit" aria-hidden="true" />
        <p>Loading immutable epoch evidence…</p>
      </main>
    );
  }

  if (error && !artifact) {
    return (
      <main className="loading-screen">
        <div className="error-mark">!</div>
        <h1>Dashboard data unavailable</h1>
        <p>{error}</p>
        <p>Generate the UI fixture or start the Vertex visualization sync.</p>
      </main>
    );
  }

  if (!source || !artifact || !geometry || !group || !epochRow) return null;

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <p>CBSC–ZDC</p>
            <h1>Visual validation monitor</h1>
          </div>
        </div>
        <div className="topbar-status">
          <span className={`status-dot ${artifact.qa.pass ? "is-live" : ""}`} />
          <div>
            <strong>VERTEX EVIDENCE SYNCED</strong>
            <small>
              {lastRefresh
                ? `refreshed ${lastRefresh.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : "checking evidence"}
            </small>
          </div>
        </div>
      </header>

      <section className="hero-row">
        <div>
          <p className="eyebrow">CHECKPOINT-LEVEL MATCHED-EVENT QA</p>
          <h2>
            Geant4 and Fast-MC
            <br />
            shower comparison
          </h2>
          <p className="hero-copy">
            One held-out Geant4 event is compared with five independently sampled
            Fast-MC showers conditioned on the same incident neutron four-vector.
            Rotate any detector view to inspect all six with a shared camera.
          </p>
        </div>
        <div className="epoch-control">
          <label htmlFor="run">Calibrated model</label>
          <select
            id="run"
            value={selectedRun}
            onChange={(event) => {
              const rows = source.manifest.epochs.filter(
                (row) => (row.run_label ?? row.stage) === event.target.value,
              );
              const latest = rows[rows.length - 1];
              if (latest) setSelectedSnapshot(snapshotId(latest));
            }}
          >
            {[...runLabels].reverse().map((label) => (
              <option key={label} value={label}>
                {runName(label)}
              </option>
            ))}
          </select>
          <div className="epoch-hash">
            <span>accepted checkpoint · epoch {epochRow.epoch}</span>
            <code>{shortHash(epochRow.checkpoint_sha256)}</code>
          </div>
        </div>
      </section>

      <section
        className={`science-banner ${artifact.synthetic_source ? "is-fixture" : ""}`}
      >
        <strong>{artifact.synthetic_source ? "INTERFACE QA ONLY" : "SCIENTIFIC BOUNDARY"}</strong>
        <span>{artifact.scientific_status}</span>
      </section>
      <section className="stats-grid" aria-label="Epoch summary">
        <StatCard
          label="Comparison bank"
          value={`${artifact.sample_count} × ${artifact.draws_per_condition}`}
          detail="validation truths × conditional draws"
        />
        <StatCard
          label="Mean response bias"
          value={signed(artifact.aggregate.trend.response_bias_fraction)}
          detail={`${artifact.aggregate.trend.generated_response_mean_gev.toFixed(2)} vs ${artifact.aggregate.trend.truth_response_mean_gev.toFixed(2)} GeV`}
        />
        <StatCard
          label="Longitudinal shower-profile error"
          value={`${(artifact.aggregate.trend.mean_longitudinal_profile_relative_l1 * 100).toFixed(1)}%`}
          detail="Mean FastMC–Geant4 layer-energy mismatch across all 65 ZDC layers · 0% is identical"
        />
      </section>

      <section className="event-toolbar">
        <div className="event-picker">
          <button
            type="button"
            onClick={() =>
              setSelectedEvent(
                (selectedEvent - 1 + artifact.groups.length) % artifact.groups.length,
              )
            }
            aria-label="Previous validation event"
          >
            ←
          </button>
          <div>
            <span>Validation event</span>
            <strong>
              {String(selectedEvent + 1).padStart(2, "0")} / {artifact.groups.length}
            </strong>
          </div>
          <input
            aria-label="Selected validation event"
            type="range"
            min={0}
            max={artifact.groups.length - 1}
            value={selectedEvent}
            onChange={(event) => setSelectedEvent(Number(event.target.value))}
          />
          <button
            type="button"
            onClick={() => setSelectedEvent((selectedEvent + 1) % artifact.groups.length)}
            aria-label="Next validation event"
          >
            →
          </button>
        </div>
        <div className="condition-strip">
          <div>
            <span>Kinetic energy</span>
            <strong>{group.kinetic_energy_gev.toFixed(2)} GeV</strong>
          </div>
          <div>
            <span>Four-vector [E, pₓ, pᵧ, pz]</span>
            <code>
              {group.p4_total_gev.map((value) => value.toFixed(3)).join(", ")}
            </code>
          </div>
          <div>
            <span>Geant4 event ID</span>
            <code>{group.event_id}</code>
          </div>
        </div>
      </section>

      <section className="panel detector-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">3D ENERGY DEPOSITION</p>
            <h3>Deposited energy at active cell centres</h3>
          </div>
          <div className="view-controls">
            <span>drag to rotate · wheel to zoom</span>
            <button type="button" onClick={() => setCamera(DEFAULT_CAMERA)}>
              Reset view
            </button>
          </div>
        </div>
        <div className="cloud-grid">
          <EnergyCloud
            title="Geant4"
            subtitle="reference deposit"
            geometry={geometry}
            deposit={group.geant4.deposit}
            summary={group.geant4.summary}
            color="#c45100"
            camera={camera}
            onCameraChange={setCamera}
          />
          {group.fast_mc.map((sample, index) => (
            <EnergyCloud
              key={sample.draw}
              title={`Fast MC ${index + 1}`}
              subtitle={`draw ${index + 1} · seed ${sample.seed_group}`}
              geometry={geometry}
              deposit={sample.deposit}
              summary={sample.summary}
              color={COLORS[index]}
              camera={camera}
              onCameraChange={setCamera}
            />
          ))}
        </div>
        <div className="deposit-key" aria-label="Detector view marker key">
          <div className="deposit-key__heading">
            <strong>Detector-view key</strong>
            <span>Each panel is normalised to its own largest cell deposit.</span>
          </div>
          <div className="deposit-key__content">
            <div className="deposit-key__series">
              <span><i className="swatch swatch--truth" />Geant4 reference</span>
              <span><i className="swatch swatch--mc" />Fast-MC draws 1–5</span>
            </div>
            <div className="deposit-key__scale">
              <span><i className="deposit-dot deposit-dot--low" />Lower relative E</span>
              <span><i className="deposit-dot deposit-dot--mid" />Medium relative E</span>
              <span><i className="deposit-dot deposit-dot--high" />Higher relative E</span>
            </div>
          </div>
          <p>
            Marker radius follows ln(1 + 120 Ecell/Emax); a white core identifies
            the upper part of that within-panel scale. Use the GeV totals and
            layer profile for absolute comparisons.
          </p>
        </div>
      </section>

      <section className="analysis-grid analysis-grid--event">
        <div className="panel profile-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LONGITUDINAL DEVELOPMENT</p>
              <h3>Energy by detector layer</h3>
            </div>
            <span className="micro-label">same event · all six showers</span>
          </div>
          <LayerProfileChart series={profileSeries} />
        </div>

        <div className="panel metrics-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">EVENT RECONSTRUCTION</p>
              <h3>Six simple ways to describe a ZDC shower</h3>
            </div>
          </div>
          <div className="comparison-context" aria-label="How this comparison works">
            <div className="comparison-context__input">
              <span>Same starting point</span>
              <strong>One fixed neutron four-momentum input</strong>
              <small>Its energy and direction entering the ZDC</small>
            </div>
            <div className="comparison-context__arrow" aria-hidden="true">→</div>
            <div>
              <span>Detailed simulation</span>
              <strong>1 Geant4 shower</strong>
              <small>The reference event shown in orange</small>
            </div>
            <div>
              <span>Machine-learning model</span>
              <strong>5 Fast-MC showers</strong>
              <small>Five independent possibilities shown in blue</small>
            </div>
          </div>
          <div className="metric-reading-guide">
            <p>
              <strong>What is being measured?</strong> The ZDC has 6,790 readout cells
              arranged from front to back in 65 layers. A shower leaves some energy in
              each cell. These six summaries describe how much energy was left and where
              it was distributed.
            </p>
            <p>
              <strong>Why are the showers different?</strong> Particle showers are random.
              Fast MC is not expected to copy this one Geant4 event cell-for-cell. The useful
              question is whether many Fast-MC showers reproduce the same distributions as
              many Geant4 showers. Five draws here are a visual check, not a physics verdict.
            </p>
          </div>
          <p className="metric-equation-note">
            Read the bold comparison sentence first. Equations are included below each
            card so the displayed number can be reproduced exactly.
          </p>
          <div className="metric-grid">
            <MetricCell
              label="Total deposited energy"
              question="1 · HOW MUCH ENERGY?"
              explanation="Energy left inside the ZDC by the full shower. This is not the neutron’s incoming energy; most incoming energy may leave the modeled readout or go into invisible processes."
              equation="T = Σᵢ Eᵢ"
              variables="Eᵢ is the deposited energy in ZDC readout cell i. The sum runs over all 6,790 cells. T is the resulting total deposited energy."
              interpretation="Larger T means the shower deposited more energy in the detector."
              comparisonKind="energy"
              truth={group.geant4.summary.total_response_gev}
              generated={group.fast_mc.map((item) => item.summary.total_response_gev)}
              unit=" GeV"
            />
            <MetricCell
              label="Cells containing deposited energy"
              question="2 · HOW MANY CELLS?"
              explanation="The number of readout cells that contain any positive deposited energy in this raw simulation output."
              equation="Nhit = Σᵢ 1(Eᵢ > 0)"
              variables="1(Eᵢ > 0) equals 1 when cell i contains deposited energy and 0 otherwise. Adding these indicators gives Nhit, the number of hit cells."
              interpretation="A larger count usually indicates a shower spread across more readout cells."
              comparisonKind="count"
              truth={group.geant4.summary.hit_count}
              generated={group.fast_mc.map((item) => item.summary.hit_count)}
              format="integer"
            />
            <MetricCell
              label="Energy-weighted shower depth"
              question="3 · HOW DEEP?"
              explanation="The shower’s front-to-back centre. Layers near 0 are at the detector front; layer 64 is at the back."
              equation="L̄ = (Σₗ l · Eₗ) / T"
              variables="l is the layer number from 0 to 64. Eₗ is the total energy deposited in layer l, and T is the total deposited energy in all layers."
              interpretation="A larger L̄ means the shower’s energy is centred deeper inside the ZDC."
              comparisonKind="depth"
              truth={group.geant4.summary.depth_centroid_layer}
              generated={group.fast_mc.map((item) => item.summary.depth_centroid_layer)}
              unit=" layers"
            />
            <MetricCell
              label="Transverse shower width"
              question="4 · HOW WIDE?"
              explanation="The typical sideways distance of deposited energy from the shower centre, viewed across the face of the detector."
              equation="rRMS = √[Σᵢ Eᵢ((xᵢ−x̄)² + (yᵢ−ȳ)²) / T]"
              variables="(xᵢ, yᵢ) is cell i’s transverse position. (x̄, ȳ) is the energy-weighted shower centre, Eᵢ is that cell’s deposited energy, and T is total deposited energy."
              interpretation="A larger radial RMS means a wider shower in the plane perpendicular to the beam."
              comparisonKind="width"
              truth={group.geant4.summary.radial_rms_mm}
              generated={group.fast_mc.map((item) => item.summary.radial_rms_mm)}
              unit=" mm"
            />
            <MetricCell
              label="Fraction deposited in the ECAL"
              question="5 · HOW MUCH AT THE FRONT?"
              explanation="The percentage of deposited energy found in layer 0, the electromagnetic calorimeter at the front of this ZDC."
              equation="fECAL = E₀ / T"
              variables="E₀ is the energy deposited in layer 0, the ECAL. T is the total deposited energy across the full ZDC."
              interpretation="For example, 14% means that 14% of this shower’s deposited energy was in the ECAL."
              comparisonKind="fraction"
              truth={group.geant4.summary.ecal_fraction}
              generated={group.fast_mc.map((item) => item.summary.ecal_fraction)}
              format="percent"
            />
            <MetricCell
              label="Fraction deposited in the final quarter"
              question="6 · HOW MUCH AT THE BACK?"
              explanation="The percentage of deposited energy found in layers 48–64, the deepest quarter of the ZDC."
              equation="flate = (Σₗ₌₄₈⁶⁴ Eₗ) / T"
              variables="Eₗ is the energy in layer l. Layers 48 through 64 are the final quarter of this 65-layer ZDC, and T is total deposited energy."
              interpretation="A larger value indicates a longer shower tail reaching the back of the detector."
              comparisonKind="fraction"
              truth={group.geant4.summary.late_fraction}
              generated={group.fast_mc.map((item) => item.summary.late_fraction)}
              format="percent"
            />
          </div>
        </div>
      </section>

      <section className="analysis-grid analysis-grid--lower">
        <div className="panel distributions-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SAMPLE DISTRIBUTIONS</p>
              <h3>{artifact.sample_count}-condition visual bank</h3>
            </div>
            <span className="micro-label">descriptive · not a gate</span>
          </div>
          <DistributionStrip
            title="Total response"
            truth={responseDistribution.truth}
            generated={responseDistribution.generated}
            unit="GeV"
          />
          <DistributionStrip
            title="Hit count"
            truth={hitDistribution.truth}
            generated={hitDistribution.generated}
            unit="cells"
          />
        </div>
        <div className="panel trend-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SELECTED CALIBRATED CHECKPOINTS</p>
              <h3>Fixed-bank model comparison</h3>
            </div>
            <span className="micro-label">
              {source.manifest.epochs.length} models · one checkpoint each
            </span>
          </div>
          <EpochTrendChart epochs={source.manifest.epochs} />
        </div>
      </section>

      <section className="method-panel panel" aria-labelledby="method-heading">
        <div>
          <p className="eyebrow">HOW TO READ THIS</p>
          <h3 id="method-heading">A fixed validation bank, viewed honestly</h3>
        </div>
        <div className="method-grid">
          <p>
            <strong>Matched condition.</strong> Each row begins with one held-out
            Geant4 event. The same incident four-vector conditions five independent
            Fast-MC draws.
          </p>
          <p>
            <strong>Raw deposited energy.</strong> The 3D points and summary plots
            use the production target without a display-tuned energy threshold.
          </p>
          <p>
            <strong>Descriptive sample.</strong> Fifty conditions make regressions
            visible across epochs, but this small visual bank is not a physics
            validation set.
          </p>
          <p>
            <strong>Closed test split.</strong> Every public artifact passed schema,
            hash, geometry, invariant, and zero-test-use gates before publication.
          </p>
        </div>
      </section>

      <section className="provenance-panel">
        <div>
          <span>Validation selection</span>
          <code>{shortHash(source.manifest.selection_sha256)}</code>
        </div>
        <div>
          <span>Geometry</span>
          <code>{shortHash(source.manifest.geometry_sha256)}</code>
        </div>
        <div>
          <span>Solver</span>
          <code>
            profile {artifact.profile_steps}/8 · share {artifact.share_steps}/8
          </code>
        </div>
        <div>
          <span>Visual export</span>
          <code>{artifact.elapsed_seconds.toFixed(1)} s · test events 0</code>
        </div>
      </section>

      <footer>
        <p>
          Visual similarity is diagnostic evidence—not physics validation. Frozen
          validation metrics and untouched test evaluation remain authoritative.
        </p>
        <span>CBSC-ZDC v2.2 · public visual QA</span>
      </footer>
    </main>
  );
}
