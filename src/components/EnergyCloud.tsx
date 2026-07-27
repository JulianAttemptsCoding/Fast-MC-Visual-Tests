"use client";

import { useEffect, useRef } from "react";

type Geometry = {
  positions_mm: number[][];
  layer_index: number[];
  subdetector: number[];
};

type Deposit = {
  cell_index: number[];
  energy_gev: number[];
};

type Summary = {
  total_response_gev: number;
  hit_count: number;
};

export type CameraState = {
  yaw: number;
  pitch: number;
  zoom: number;
};

type Props = {
  title: string;
  subtitle: string;
  geometry: Geometry;
  deposit: Deposit;
  summary: Summary;
  color: string;
  camera: CameraState;
  onCameraChange: (camera: CameraState) => void;
};

function colorChannels(hex: string) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

export function EnergyCloud({
  title,
  subtitle,
  geometry,
  deposit,
  summary,
  color,
  camera,
  onCameraChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
      canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const width = bounds.width;
      const height = bounds.height;
      context.clearRect(0, 0, width, height);

      const positions = geometry.positions_mm;
      const xs = positions.map((value) => value[0]);
      const ys = positions.map((value) => value[1]);
      const zs = positions.map((value) => value[2]);
      const center = [
        (Math.min(...xs) + Math.max(...xs)) / 2,
        (Math.min(...ys) + Math.max(...ys)) / 2,
        (Math.min(...zs) + Math.max(...zs)) / 2,
      ];
      const extent = Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
        Math.max(...zs) - Math.min(...zs),
        1,
      );

      const project = (position: number[]) => {
        const x = (position[0] - center[0]) / extent;
        const y = (position[1] - center[1]) / extent;
        const z = (position[2] - center[2]) / extent;
        const cy = Math.cos(camera.yaw);
        const sy = Math.sin(camera.yaw);
        const cp = Math.cos(camera.pitch);
        const sp = Math.sin(camera.pitch);
        const x1 = cy * x + sy * z;
        const z1 = -sy * x + cy * z;
        const y2 = cp * y - sp * z1;
        const z2 = sp * y + cp * z1;
        const perspective = camera.zoom * Math.min(width, height) * 1.18;
        const denominator = 2.25 + z2;
        return {
          x: width / 2 + (x1 * perspective) / denominator,
          y: height / 2 - (y2 * perspective) / denominator,
          z: z2,
        };
      };

      context.strokeStyle = "rgba(139, 166, 194, .10)";
      context.lineWidth = 1;
      const box = [
        [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
        [Math.max(...xs), Math.min(...ys), Math.min(...zs)],
        [Math.max(...xs), Math.max(...ys), Math.min(...zs)],
        [Math.min(...xs), Math.max(...ys), Math.min(...zs)],
        [Math.min(...xs), Math.min(...ys), Math.max(...zs)],
        [Math.max(...xs), Math.min(...ys), Math.max(...zs)],
        [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
        [Math.min(...xs), Math.max(...ys), Math.max(...zs)],
      ].map(project);
      const edges = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7],
      ];
      edges.forEach(([start, end]) => {
        context.beginPath();
        context.moveTo(box[start].x, box[start].y);
        context.lineTo(box[end].x, box[end].y);
        context.stroke();
      });

      const maximum = Math.max(...deposit.energy_gev, 1e-12);
      const [red, green, blue] = colorChannels(color);
      const points = deposit.cell_index
        .map((cell, index) => ({
          ...project(positions[cell]),
          energy: deposit.energy_gev[index],
        }))
        .sort((a, b) => a.z - b.z);

      points.forEach((point) => {
        const normalized =
          Math.log1p((point.energy / maximum) * 120) / Math.log1p(120);
        const radius = 1.05 + normalized * 5.8;
        const alpha = 0.24 + normalized * 0.76;
        const glow = context.createRadialGradient(
          point.x,
          point.y,
          0,
          point.x,
          point.y,
          radius * 2.1,
        );
        glow.addColorStop(0, `rgba(255,255,255,${alpha})`);
        glow.addColorStop(
          0.25,
          `rgba(${red},${green},${blue},${Math.min(alpha, 0.92)})`,
        );
        glow.addColorStop(1, `rgba(${red},${green},${blue},0)`);
        context.fillStyle = glow;
        context.beginPath();
        context.arc(point.x, point.y, radius * 2.1, 0, Math.PI * 2);
        context.fill();
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [camera, color, deposit, geometry]);

  return (
    <article className="cloud-card" style={{ "--cloud-color": color } as React.CSSProperties}>
      <div className="cloud-card__heading">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <div>
          <strong>{summary.total_response_gev.toFixed(2)} GeV</strong>
          <span>{summary.hit_count} active cells</span>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        aria-label={`${title} 3D deposited-energy view`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          const dx = event.clientX - dragRef.current.x;
          const dy = event.clientY - dragRef.current.y;
          dragRef.current = { x: event.clientX, y: event.clientY };
          onCameraChange({
            ...camera,
            yaw: camera.yaw + dx * 0.008,
            pitch: Math.max(-1.35, Math.min(1.35, camera.pitch + dy * 0.008)),
          });
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onWheel={(event) => {
          event.preventDefault();
          onCameraChange({
            ...camera,
            zoom: Math.max(0.55, Math.min(2.4, camera.zoom * Math.exp(-event.deltaY * 0.001))),
          });
        }}
      />
    </article>
  );
}
