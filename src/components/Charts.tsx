"use client";

import { useState } from "react";

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

const profileMargin = { left: 72, right: 16, top: 38, bottom: 28 };
type ProfileScale = "log" | "linear";

function profileLogDomain(series: Series[]) {
  const positive = series
    .flatMap((item) => item.values)
    .filter((value) => Number.isFinite(value) && value > 0);
  const minimum = Math.min(...positive, 1);
  const maximum = Math.max(...positive, 1);
  const minimumExponent = Math.floor(Math.log10(minimum));
  let maximumExponent = Math.ceil(Math.log10(maximum));
  if (maximumExponent <= minimumExponent) maximumExponent = minimumExponent + 1;

  const exponentCount = maximumExponent - minimumExponent + 1;
  const stride = Math.max(1, Math.ceil((exponentCount - 1) / 5));
  const tickExponents: number[] = [];
  for (let exponent = minimumExponent; exponent <= maximumExponent; exponent += stride) {
    tickExponents.push(exponent);
  }
  if (tickExponents.at(-1) !== maximumExponent) tickExponents.push(maximumExponent);

  return { minimumExponent, maximumExponent, tickExponents };
}

function profileLogPath(
  values: number[],
  width: number,
  height: number,
  minimumExponent: number,
  maximumExponent: number,
) {
  const plotWidth = width - profileMargin.left - profileMargin.right;
  const plotHeight = height - profileMargin.top - profileMargin.bottom;
  const exponentSpan = maximumExponent - minimumExponent;
  const floor = 10 ** minimumExponent;
  return values
    .map((value, index) => {
      const x =
        profileMargin.left +
        (index / Math.max(values.length - 1, 1)) * plotWidth;
      const safeValue = Number.isFinite(value) && value > 0 ? value : floor;
      const fraction =
        (Math.log10(Math.max(safeValue, floor)) - minimumExponent) / exponentSpan;
      const y = profileMargin.top + (1 - fraction) * plotHeight;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function profileLinearDomain(series: Series[]) {
  const maximum = Math.max(
    ...series.flatMap((item) =>
      item.values.filter((value) => Number.isFinite(value) && value >= 0),
    ),
    1,
  );
  const tickValues = [0, 0.25, 0.5, 0.75, 1].map(
    (fraction) => fraction * maximum,
  );
  return { maximum, tickValues };
}

function profileLinearPath(
  values: number[],
  width: number,
  height: number,
  maximum: number,
) {
  const plotWidth = width - profileMargin.left - profileMargin.right;
  const plotHeight = height - profileMargin.top - profileMargin.bottom;
  return values
    .map((value, index) => {
      const x =
        profileMargin.left +
        (index / Math.max(values.length - 1, 1)) * plotWidth;
      const safeValue = Number.isFinite(value) ? Math.max(value, 0) : 0;
      const y =
        profileMargin.top +
        (1 - Math.min(safeValue / maximum, 1)) * plotHeight;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function formatLogTick(exponent: number) {
  if (exponent === 0) return "1";
  if (exponent === 1) return "10";
  if (exponent === 2) return "100";
  if (exponent === -1) return "0.1";
  if (exponent === -2) return "0.01";
  return `1e${exponent}`;
}

function formatLinearTick(value: number) {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2);
  return value.toPrecision(2);
}

export function LayerProfileChart({ series }: { series: Series[] }) {
  const [scale, setScale] = useState<ProfileScale>("log");
  const width = 780;
  const height = 260;
  const { minimumExponent, maximumExponent, tickExponents } =
    profileLogDomain(series);
  const { maximum: linearMaximum, tickValues: linearTickValues } =
    profileLinearDomain(series);
  const plotHeight = height - profileMargin.top - profileMargin.bottom;
  const exponentSpan = maximumExponent - minimumExponent;
  const isLog = scale === "log";
  return (
    <div className="chart-wrap">
      <div className="chart-scale-controls">
        <span>Vertical scale</span>
        <div
          className="chart-scale-toggle"
          role="group"
          aria-label="Layer energy vertical scale"
        >
          <button
            type="button"
            aria-pressed={isLog}
            onClick={() => setScale("log")}
          >
            Log
          </button>
          <button
            type="button"
            aria-pressed={!isLog}
            onClick={() => setScale("linear")}
          >
            Linear
          </button>
        </div>
      </div>
      <svg
        className="line-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Longitudinal deposited energy by detector layer on a ${
          isLog ? "base-10 logarithmic" : "linear"
        } scale`}
      >
        {(isLog ? tickExponents : linearTickValues).map((tick) => {
          const fraction = isLog
            ? (tick - minimumExponent) / exponentSpan
            : tick / linearMaximum;
          const y = profileMargin.top + (1 - fraction) * plotHeight;
          return (
            <g key={`${scale}-${tick}`}>
              <line
                x1={profileMargin.left}
                x2={width - profileMargin.right}
                y1={y}
                y2={y}
              />
              <text
                x={profileMargin.left - 10}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {isLog ? formatLogTick(tick) : formatLinearTick(tick)}
              </text>
            </g>
          );
        })}
        {series.map((item) => (
          <path
            key={item.name}
            d={
              isLog
                ? profileLogPath(
                    item.values,
                    width,
                    height,
                    minimumExponent,
                    maximumExponent,
                  )
                : profileLinearPath(item.values, width, height, linearMaximum)
            }
            stroke={item.color}
            className={item.name === "Geant4" ? "truth-line" : ""}
          />
        ))}
        <text className="axis-title" x={profileMargin.left} y="16">
          {isLog
            ? "deposited energy per layer [GeV] · log10 scale · zero at floor"
            : "deposited energy per layer [GeV] · linear scale"}
        </text>
        <text
          className="axis-label"
          x={width - profileMargin.right}
          y={height - 5}
          textAnchor="end"
        >
          detector layer
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
        <span><i className="key-truth" />Geant4 · 50 events</span>
        <span><i className="key-mc" />Fast MC · 250 pooled draws</span>
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
      name: "Absolute response bias",
      color: "#ff9c63",
      values: ordered.map((row) => Math.abs(row.trend.response_bias_fraction)),
    },
    {
      name: "Absolute hit-count bias",
      color: "#5ce1e6",
      values: ordered.map((row) => Math.abs(row.trend.hit_count_bias_fraction)),
    },
    {
      name: "Longitudinal shower-profile error",
      color: "#b195ff",
      values: ordered.map((row) => row.trend.mean_longitudinal_profile_relative_l1),
    },
  ];
  const maximum = Math.max(...series.flatMap((item) => item.values), 0.01);
  const modelLabel = (row: Epoch) => {
    const label = row.run_label ?? row.stage;
    if (label.includes("lr1e4-halfbatch")) return "LR 1e-4 · ½ batch";
    if (label.includes("lr3e5")) return "LR 3e-5";
    if (label.includes("lr3e4")) return "LR 3e-4";
    if (label.includes("lr1e4")) return "LR 1e-4";
    return `E${row.epoch}`;
  };
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
        <text className="axis-title" x="24" y="12">
          fractional bias / relative distance
        </text>
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
              {modelLabel(row)}
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
