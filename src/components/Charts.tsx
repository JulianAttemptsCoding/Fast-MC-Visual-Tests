"use client";

type Series = {
  name: string;
  color: string;
  values: number[];
};

type Trend = {
  response_bias_fraction: number;
  hit_count_bias_fraction: number;
  mean_longitudinal_profile_relative_l1: number;
};

type Epoch = {
  id?: string;
  run_label?: string | null;
  epoch: number;
  stage: string;
  trend: Trend;
};

function pathFor(values: number[], width: number, height: number, maximum: number) {
  return values
    .map((value, index) => {
      const x = 24 + (index / Math.max(values.length - 1, 1)) * (width - 38);
      const y = height - 22 - (value / Math.max(maximum, 1e-12)) * (height - 40);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function LayerProfileChart({ series }: { series: Series[] }) {
  const width = 780;
  const height = 260;
  const maximum = Math.max(...series.flatMap((item) => item.values), 1e-9);
  return (
    <div className="chart-wrap">
      <svg
        className="line-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Longitudinal deposited energy by detector layer"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = height - 22 - fraction * (height - 40);
          return (
            <g key={fraction}>
              <line x1="24" x2={width - 14} y1={y} y2={y} />
              <text x="22" y={y - 4}>
                {(maximum * fraction).toFixed(1)}
              </text>
            </g>
          );
        })}
        {series.map((item) => (
          <path
            key={item.name}
            d={pathFor(item.values, width, height, maximum)}
            stroke={item.color}
            className={item.name === "Geant4" ? "truth-line" : ""}
          />
        ))}
        <text className="axis-label" x={width - 14} y={height - 6} textAnchor="end">
          layer
        </text>
      </svg>
      <div className="chart-legend">
        {series.map((item) => (
          <span key={item.name}>
            <i style={{ backgroundColor: item.color }} />
            {item.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function histogram(values: number[], low: number, high: number, bins: number) {
  const counts = Array.from({ length: bins }, () => 0);
  const span = Math.max(high - low, 1e-9);
  values.forEach((value) => {
    const index = Math.min(bins - 1, Math.max(0, Math.floor(((value - low) / span) * bins)));
    counts[index] += 1;
  });
  const total = Math.max(values.length, 1);
  return counts.map((value) => value / total);
}

export function DistributionStrip({
  title,
  truth,
  generated,
  unit,
}: {
  title: string;
  truth: number[];
  generated: number[];
  unit: string;
}) {
  const low = Math.min(...truth, ...generated);
  const high = Math.max(...truth, ...generated);
  const truthBins = histogram(truth, low, high, 18);
  const generatedBins = histogram(generated, low, high, 18);
  const maximum = Math.max(...truthBins, ...generatedBins, 1e-9);
  return (
    <div className="distribution-strip">
      <div className="distribution-label">
        <strong>{title}</strong>
        <span>
          {low.toFixed(1)}–{high.toFixed(1)} {unit}
        </span>
      </div>
      <div className="histogram" aria-label={`${title} sample histogram`}>
        {truthBins.map((value, index) => (
          <div className="histogram-bin" key={index}>
            <i
              className="histogram-mc"
              style={{ height: `${(generatedBins[index] / maximum) * 100}%` }}
            />
            <i
              className="histogram-truth"
              style={{ height: `${(value / maximum) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="distribution-key">
        <span><i className="key-truth" />Geant4</span>
        <span><i className="key-mc" />Fast MC</span>
      </div>
    </div>
  );
}

export function EpochTrendChart({ epochs }: { epochs: Epoch[] }) {
  const ordered = [...epochs];
  const width = 540;
  const height = 230;
  const series = [
    {
      name: "|response bias|",
      color: "#ff9c63",
      values: ordered.map((row) => Math.abs(row.trend.response_bias_fraction)),
    },
    {
      name: "|hit bias|",
      color: "#5ce1e6",
      values: ordered.map((row) => Math.abs(row.trend.hit_count_bias_fraction)),
    },
    {
      name: "profile L1",
      color: "#b195ff",
      values: ordered.map((row) => row.trend.mean_longitudinal_profile_relative_l1),
    },
  ];
  const maximum = Math.max(...series.flatMap((item) => item.values), 0.01);
  return (
    <div className="chart-wrap trend-chart">
      <svg
        className="line-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Fixed visualization bank metrics across epochs"
      >
        {[0, 0.5, 1].map((fraction) => {
          const y = height - 22 - fraction * (height - 40);
          return (
            <g key={fraction}>
              <line x1="24" x2={width - 14} y1={y} y2={y} />
              <text x="22" y={y - 4}>
                {(maximum * fraction).toFixed(2)}
              </text>
            </g>
          );
        })}
        {series.map((item) => (
          <path
            key={item.name}
            d={pathFor(item.values, width, height, maximum)}
            stroke={item.color}
          />
        ))}
        {ordered.map((row, index) => {
          const x = 24 + (index / Math.max(ordered.length - 1, 1)) * (width - 38);
          return (
            <text
              key={row.id ?? `${row.stage}:${row.epoch}`}
              className="axis-label"
              x={x}
              y={height - 6}
              textAnchor="middle"
            >
              {(row.run_label ?? row.stage)
                .split(/[-_]/)
                .map((part) => part.slice(0, 1).toUpperCase())
                .join("")
                .slice(0, 3)}
              :E{row.epoch}
            </text>
          );
        })}
      </svg>
      <div className="chart-legend">
        {series.map((item) => (
          <span key={item.name}>
            <i style={{ backgroundColor: item.color }} />
            {item.name}
          </span>
        ))}
      </div>
    </div>
  );
}
