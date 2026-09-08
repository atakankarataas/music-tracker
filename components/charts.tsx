"use client";

import { useId, useState, type CSSProperties } from "react";

import type { ChartPoint } from "@/lib/data";

const numberFormatter = new Intl.NumberFormat("en-US");

const HEATMAP_ROWS = 7;

function playLabel(value: number) {
  return `${numberFormatter.format(value)} ${value === 1 ? "play" : "plays"}`;
}

function percentage(value: number, total: number) {
  return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "0%";
}

// The tooltip used to be pinned to the top-right corner of every chart, so it
// sat in the same spot no matter where the pointer was. These custom properties
// let it track the active point; the CSS clamps it so it stays inside the panel.
function tooltipAnchor(x?: number, y?: number) {
  const style: Record<string, string> = {};
  if (x !== undefined) style["--tooltip-x"] = `${x}%`;
  if (y !== undefined) style["--tooltip-y"] = `${y}%`;
  return style as CSSProperties;
}

function ChartTooltip({
  title,
  value,
  detail,
  x,
  y,
  followY = false,
}: {
  title: string;
  value: string;
  detail: string;
  x?: number;
  y?: number;
  followY?: boolean;
}) {
  return (
    <div
      className="chart-tooltip"
      data-follow={followY ? "y" : undefined}
      role="status"
      style={tooltipAnchor(x, y)}
    >
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export function LineChart({ data }: { data: ChartPoint[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const gradientId = useId().replaceAll(":", "");
  if (!data.length) return null;
  // The SVG is stretched to the panel with preserveAspectRatio="none", so these
  // are relative units rather than pixels.
  const width = 720;
  const height = 210;
  const padding = 8;
  const max = Math.max(...data.map((point) => point.value), 1);
  const total = data.reduce((sum, point) => sum + point.value, 0);
  const coordinates = data.map((point, index) => ({
    x: padding + (index / Math.max(data.length - 1, 1)) * (width - padding * 2),
    y: height - padding - (point.value / max) * (height - padding * 2),
  }));
  const points = coordinates.map(({ x, y }) => `${x},${y}`).join(" ");
  const active = activeIndex === null ? null : data[activeIndex];
  const activeCoordinate = activeIndex === null ? null : coordinates[activeIndex];

  function selectFromPointer(clientX: number, bounds: DOMRect) {
    const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    setActiveIndex(Math.round(ratio * Math.max(data.length - 1, 0)));
  }

  return (
    <div
      aria-label={active ? `${active.label}, ${playLabel(active.value)}` : "Listening trend. Use arrow keys to inspect values."}
      className="line-chart interactive-chart"
      onBlur={() => setActiveIndex(null)}
      onFocus={() => setActiveIndex((current) => current ?? data.length - 1)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        setActiveIndex((current) => {
          if (event.key === "Home") return 0;
          if (event.key === "End") return data.length - 1;
          const next = current ?? data.length - 1;
          return event.key === "ArrowLeft" ? Math.max(0, next - 1) : Math.min(data.length - 1, next + 1);
        });
      }}
      onPointerLeave={() => setActiveIndex(null)}
      onPointerMove={(event) => selectFromPointer(event.clientX, event.currentTarget.getBoundingClientRect())}
      role="img"
      tabIndex={0}
    >
      {active && activeCoordinate ? (
        <ChartTooltip
          detail={`${percentage(active.value, total)} of this range`}
          title={active.label}
          value={playLabel(active.value)}
          x={(activeCoordinate.x / width) * 100}
        />
      ) : null}
      <div className="line-chart-plot">
        {/* preserveAspectRatio="none" lets the plot fill the panel in both
            directions. Uniform scaling letterboxed it: at any panel wider than
            ~820px the drawing shrank and floated in the middle of the surface.
            Strokes stay even thanks to vectorEffect. */}
        <svg aria-hidden="true" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.18" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`M ${padding} ${height - padding} L ${points.replaceAll(" ", " L ")} L ${width - padding} ${height - padding} Z`} fill={`url(#${gradientId})`} />
          <polyline
            fill="none"
            points={points}
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          {activeCoordinate ? (
            <line
              className="chart-crosshair"
              vectorEffect="non-scaling-stroke"
              x1={activeCoordinate.x}
              x2={activeCoordinate.x}
              y1={padding}
              y2={height - padding}
            />
          ) : null}
        </svg>
        {/* Drawn in the DOM rather than the SVG: non-uniform scaling would
            squash an SVG circle into an ellipse. */}
        {activeCoordinate ? (
          <span
            className="chart-active-dot"
            style={{
              left: `${(activeCoordinate.x / width) * 100}%`,
              top: `${(activeCoordinate.y / height) * 100}%`,
            }}
          />
        ) : null}
      </div>
      <div className="chart-axis">
        <span>{data[0]?.label}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
    </div>
  );
}

export function BarChart({ data }: { data: ChartPoint[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const max = Math.max(...data.map((point) => point.value), 1);
  const total = data.reduce((sum, point) => sum + point.value, 0);
  const active = activeIndex === null ? null : data[activeIndex];
  return (
    <div className="bar-chart interactive-chart">
      {active ? (
        <ChartTooltip
          detail={`${percentage(active.value, total)} of all plays`}
          followY
          title={active.label}
          value={playLabel(active.value)}
          y={((activeIndex! + 0.5) / data.length) * 100}
        />
      ) : null}
      {data.map((point, index) => (
        <div
          aria-label={`${point.label}, ${playLabel(point.value)}, ${percentage(point.value, total)} of all plays`}
          className="bar-item"
          key={point.label}
          onBlur={() => setActiveIndex(null)}
          onFocus={() => setActiveIndex(index)}
          onPointerEnter={() => setActiveIndex(index)}
          onPointerMove={() => setActiveIndex(index)}
          onPointerLeave={() => setActiveIndex(null)}
          tabIndex={0}
        >
          <span>{point.label}</span>
          <i><b style={{ width: `${(point.value / max) * 100}%` }} /></i>
          <strong>{point.value.toLocaleString("en-US")}</strong>
        </div>
      ))}
    </div>
  );
}

export function HourChart({ data }: { data: ChartPoint[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const max = Math.max(...data.map((point) => point.value), 1);
  const total = data.reduce((sum, point) => sum + point.value, 0);
  const peak = data.reduce((best, point) => point.value > best.value ? point : best, data[0]);
  const active = activeIndex === null ? null : data[activeIndex];
  return (
    <div className="hour-chart interactive-chart" aria-label="Listening by hour">
      {active ? (
        <ChartTooltip
          detail={`${percentage(active.value, total)} of all plays`}
          title={`${active.label}:00–${active.label}:59`}
          value={playLabel(active.value)}
          x={((activeIndex! + 0.5) / data.length) * 100}
        />
      ) : null}
      {data.map((point, index) => (
        <div
          aria-label={`${point.label}:00, ${playLabel(point.value)}`}
          className="hour-column"
          key={point.label}
          onBlur={() => setActiveIndex(null)}
          onFocus={() => setActiveIndex(index)}
          onPointerEnter={() => setActiveIndex(index)}
          onPointerMove={() => setActiveIndex(index)}
          onPointerLeave={() => setActiveIndex(null)}
          tabIndex={0}
        >
          <i
            data-peak={point.label === peak?.label || undefined}
            style={{ height: `${Math.max(3, (point.value / max) * 100)}%` }}
          />
          {Number(point.label) % 2 === 0 ? <span>{point.label}</span> : <span />}
        </div>
      ))}
    </div>
  );
}

export function ActivityHeatmap({ data }: { data: Array<{ date: string; value: number }> }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const max = Math.max(...data.map((day) => day.value), 1);
  const active = activeIndex === null ? null : data[activeIndex];
  const columns = Math.max(1, Math.ceil(data.length / HEATMAP_ROWS));
  return (
    <div className="heatmap-wrap interactive-chart">
      {active ? (
        <ChartTooltip
          detail={`${percentage(active.value, max)} of the peak day`}
          title={active.date}
          value={playLabel(active.value)}
          x={((Math.floor(activeIndex! / HEATMAP_ROWS) + 0.5) / columns) * 100}
        />
      ) : null}
      <div className="heatmap" aria-label="Recent listening activity">
        {data.map((day, index) => {
          const level = day.value === 0 ? 0 : Math.max(1, Math.ceil((day.value / max) * 4));
          return (
            <span
              aria-label={`${day.date}, ${playLabel(day.value)}`}
              data-level={level}
              key={day.date}
              onBlur={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(index)}
              onPointerEnter={() => setActiveIndex(index)}
              onPointerMove={() => setActiveIndex(index)}
              onPointerLeave={() => setActiveIndex(null)}
              role="img"
              tabIndex={0}
            />
          );
        })}
      </div>
    </div>
  );
}
