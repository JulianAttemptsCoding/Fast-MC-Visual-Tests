"use client";

import { useEffect, useMemo, useRef } from "react";

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
  const cameraRef = useRef(camera);
  const pendingCameraRef = useRef<CameraState | null>(null);
  const cameraFrameRef = useRef<number | null>(null);
  const drawFrameRef = useRef<number | null>(null);
  const scheduleDrawRef = useRef<() => void>(() => undefined);

  const geometryFrame = useMemo(() => {
    const low = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const high = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const position of geometry.positions_mm) {
      for (let axis = 0; axis < 3; axis += 1) {
        low[axis] = Math.min(low[axis], position[axis]);
        high[axis] = Math.max(high[axis], position[axis]);
      }
    }
    return {
      low,
      high,
      center: low.map((value, axis) => (value + high[axis]) / 2),
      extent: Math.max(high[0] - low[0], high[1] - low[1], high[2] - low[2], 1),
    };
  }, [geometry]);

  const pointData = useMemo(() => {
    let maximum = 1e-12;
    for (const energy of deposit.energy_gev) maximum = Math.max(maximum, energy);
    return deposit.cell_index.map((cell, index) => {
      const normalized =
        Math.log1p((deposit.energy_gev[index] / maximum) * 120) / Math.log1p(120);
      return {
        position: geometry.positions_mm[cell],
        normalized,
        radius: 1.05 + normalized * 5.8,
      };
    });
  }, [deposit, geometry]);

  useEffect(() => {
    cameraRef.current = camera;
    scheduleDrawRef.current();
  }, [camera]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
      const pixelWidth = Math.max(1, Math.floor(bounds.width * ratio));
      const pixelHeight = Math.max(1, Math.floor(bounds.height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const width = bounds.width;
      const height = bounds.height;
      context.clearRect(0, 0, width, height);

      const activeCamera = cameraRef.current;
      const cy = Math.cos(activeCamera.yaw);
      const sy = Math.sin(activeCamera.yaw);
      const cp = Math.cos(activeCamera.pitch);
      const sp = Math.sin(activeCamera.pitch);
      const perspective = activeCamera.zoom * Math.min(width, height) * 1.18;

      const project = (position: number[]) => {
        const x = (position[0] - geometryFrame.center[0]) / geometryFrame.extent;
        const y = (position[1] - geometryFrame.center[1]) / geometryFrame.extent;
        const z = (position[2] - geometryFrame.center[2]) / geometryFrame.extent;
        const x1 = cy * x + sy * z;
        const z1 = -sy * x + cy * z;
        const y2 = cp * y - sp * z1;
        const z2 = sp * y + cp * z1;
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
        [geometryFrame.low[0], geometryFrame.low[1], geometryFrame.low[2]],
        [geometryFrame.high[0], geometryFrame.low[1], geometryFrame.low[2]],
        [geometryFrame.high[0], geometryFrame.high[1], geometryFrame.low[2]],
        [geometryFrame.low[0], geometryFrame.high[1], geometryFrame.low[2]],
        [geometryFrame.low[0], geometryFrame.low[1], geometryFrame.high[2]],
        [geometryFrame.high[0], geometryFrame.low[1], geometryFrame.high[2]],
        [geometryFrame.high[0], geometryFrame.high[1], geometryFrame.high[2]],
        [geometryFrame.low[0], geometryFrame.high[1], geometryFrame.high[2]],
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

      const [red, green, blue] = colorChannels(color);
      const points = pointData.map((point) => ({ ...point, ...project(point.position) }));

      context.save();
      context.globalCompositeOperation = "lighter";
      context.fillStyle = `rgba(${red},${green},${blue},0.14)`;
      context.beginPath();
      for (const point of points) {
        context.moveTo(point.x + point.radius * 1.8, point.y);
        context.arc(point.x, point.y, point.radius * 1.8, 0, Math.PI * 2);
      }
      context.fill();

      context.fillStyle = `rgba(${red},${green},${blue},0.72)`;
      context.beginPath();
      for (const point of points) {
        context.moveTo(point.x + point.radius, point.y);
        context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      }
      context.fill();

      context.fillStyle = "rgba(255,255,255,0.78)";
      context.beginPath();
      for (const point of points) {
        if (point.normalized < 0.62) continue;
        const core = Math.max(0.65, point.radius * 0.24);
        context.moveTo(point.x + core, point.y);
        context.arc(point.x, point.y, core, 0, Math.PI * 2);
      }
      context.fill();
      context.restore();
    };

    const scheduleDraw = () => {
      if (drawFrameRef.current !== null) return;
      drawFrameRef.current = window.requestAnimationFrame(() => {
        drawFrameRef.current = null;
        draw();
      });
    };
    scheduleDrawRef.current = scheduleDraw;
    scheduleDraw();
    const observer = new ResizeObserver(scheduleDraw);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      if (drawFrameRef.current !== null) window.cancelAnimationFrame(drawFrameRef.current);
      drawFrameRef.current = null;
    };
  }, [color, geometryFrame, pointData]);

  useEffect(
    () => () => {
      if (cameraFrameRef.current !== null) window.cancelAnimationFrame(cameraFrameRef.current);
    },
    [],
  );

  const scheduleCamera = (next: CameraState) => {
    pendingCameraRef.current = next;
    cameraRef.current = next;
    if (cameraFrameRef.current !== null) return;
    cameraFrameRef.current = window.requestAnimationFrame(() => {
      cameraFrameRef.current = null;
      const pending = pendingCameraRef.current;
      pendingCameraRef.current = null;
      if (pending) onCameraChange(pending);
    });
  };

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
          const current = pendingCameraRef.current ?? cameraRef.current;
          scheduleCamera({
            ...current,
            yaw: current.yaw + dx * 0.008,
            pitch: Math.max(-1.35, Math.min(1.35, current.pitch + dy * 0.008)),
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
          const current = pendingCameraRef.current ?? cameraRef.current;
          scheduleCamera({
            ...current,
            zoom: Math.max(0.55, Math.min(2.4, current.zoom * Math.exp(-event.deltaY * 0.001))),
          });
        }}
      />
    </article>
  );
}
