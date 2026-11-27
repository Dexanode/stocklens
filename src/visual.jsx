import { useId, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";

const easeInOut = [0.65, 0, 0.35, 1];

export function LensMark({ size = 28, thinking = false }) {
  return (
    <svg className={`mark${thinking ? " thinking" : ""}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="10" fill="#171717" />
      <circle cx="16" cy="16" r="9.2" fill="none" stroke="#e0d7fb" strokeWidth="2.4" />
      <g className="iris">
        <circle cx="16" cy="16" r="4.6" fill="#6652b3" />
      </g>
      <path d="M9.6 19.2 13 16.4l2.6 1.8 5.4-5.2" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <g className="glint">
        <circle cx="16" cy="6.8" r="1.7" fill="#ffe500" />
      </g>
    </svg>
  );
}

export function PaperGrain() {
  return <div className="grain" aria-hidden="true" />;
}

function ridgelinePaths() {
  const width = 1440;
  const height = 420;
  let seed = 11 * 9301 + 49297;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const paths = [];
  for (let index = 0; index < 26; index += 1) {
    const base = 120 + index * 11.5;
    let d = `M0 ${base}`;
    const phase = rand() * 6;
    const amp = 10 + index * 1.6;
    const freq = 0.004 + rand() * 0.002;
    for (let x = 0; x <= width; x += 24) {
      const y = base
        - amp * Math.sin(x * freq + phase)
        - Math.max(0, 60 - Math.abs(x - width * 0.66) / 7) * (index / 26) * 1.4
        - Math.max(0, 40 - Math.abs(x - width * 0.28) / 9) * (index / 30);
      d += ` L${x} ${y.toFixed(1)}`;
    }
    paths.push({
      d,
      opacity: (0.07 + index * 0.014).toFixed(3),
      accent: index % 5 === 0,
    });
  }
  return { width, height, paths };
}

export function Ridgeline() {
  const art = useMemo(ridgelinePaths, []);
  return (
    <div className="art" aria-hidden="true">
      <svg viewBox={`0 0 ${art.width} ${art.height}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="sl-sky" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#efe9ff" />
            <stop offset="0.55" stopColor="#f7f3ea" />
            <stop offset="1" stopColor="#fff6c2" />
          </linearGradient>
          <radialGradient id="sl-sun" cx="0.78" cy="0.22" r="0.2">
            <stop offset="0" stopColor="#ffe500" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffe500" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={art.width} height={art.height} fill="url(#sl-sky)" opacity="0.9" />
        <rect width={art.width} height={art.height} fill="url(#sl-sun)" />
        <circle cx={art.width * 0.78} cy={art.height * 0.24} r="46" fill="none" stroke="#6652b3" strokeOpacity="0.18" strokeWidth="1.2" />
        <circle cx={art.width * 0.78} cy={art.height * 0.24} r="30" fill="#fff" fillOpacity="0.35" />
        {art.paths.map((path) => (
          <path key={path.d.slice(0, 24)} d={path.d} fill="none" stroke={path.accent ? "#6652b3" : "#5b5340"} strokeOpacity={path.opacity} strokeWidth={path.accent ? 1.2 : 0.8} />
        ))}
      </svg>
    </div>
  );
}

export function Spark({ history, change }) {
  const rows = (Array.isArray(history) ? history : []).filter((row) => Number(row?.price) > 0);
  if (rows.length < 3) {
    return (
      <svg className="spark" viewBox="0 0 62 24" aria-hidden="true">
        <path d="M2 12h58" stroke="currentColor" strokeDasharray="2 3" strokeWidth="1.4" />
      </svg>
    );
  }
  const values = rows.map((row) => Number(row.price));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const step = Math.max(1, Math.floor(values.length / 16));
  const sampled = values.filter((_, index) => index % step === 0);
  if (sampled.at(-1) !== values.at(-1)) sampled.push(values.at(-1));
  const points = sampled.map((value, index) => {
    const x = (2 + index * (58 / Math.max(sampled.length - 1, 1))).toFixed(1);
    const y = (21 - ((value - low) / (high - low || 1)) * 18).toFixed(1);
    return `${x},${y}`;
  }).join(" ");
  const tone = String(change || "").trim().startsWith("+") ? "up" : String(change || "").trim().startsWith("-") ? "down" : "flat";
  return (
    <svg className={`spark ${tone}`} viewBox="0 0 62 24" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function chartTimeX(timestamp, range) {
  const days = { "1W": 7, "1M": 30, "3M": 90, "1Y": 365 };
  const duration = (days[range] || 30) * 864e5;
  return 4 + 720 * Math.max(0, Math.min(1, (Number(timestamp) - (Date.now() - duration)) / duration));
}

function lineGeometry(points) {
  const pairs = String(points || "")
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number))
    .filter((pair) => pair.length >= 2 && pair.every(Number.isFinite));
  if (pairs.length < 2) return null;
  const d = pairs.map((pair, index) => `${index ? "L" : "M"}${pair[0]},${pair[1]}`).join(" ");
  return {
    d,
    area: `${d} L${pairs.at(-1)[0]},90 L${pairs[0][0]},90 Z`,
    end: pairs.at(-1),
  };
}

function CandleLayer({ candles, range, reduce }) {
  const low = Math.min(...candles.map((candle) => candle.low));
  const high = Math.max(...candles.map((candle) => candle.high));
  const padding = Math.max((high - low) * 0.1, high * 0.001, 0.01);
  const bottom = low - padding;
  const scale = high + padding - bottom;
  const y = (value) => 90 - ((value - bottom) / scale) * 90;
  return (
    <g>
      {candles.map((candle, index) => {
        const x = Math.max(8, Math.min(720, chartTimeX(candle.timestamp, range)));
        const openY = y(candle.open);
        const closeY = y(candle.close);
        const top = Math.min(openY, closeY);
        const height = Math.max(1.5, Math.abs(openY - closeY));
        const positive = candle.close >= candle.open;
        const color = positive ? "var(--up)" : "var(--down)";
        return (
          <motion.g
            key={`${candle.timestamp}-${index}`}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.28, delay: reduce ? 0 : index * 0.012, ease: easeInOut }}
          >
            <line x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} stroke={color} strokeWidth="1.4" />
            <rect x={x - 3.2} y={top} width="6.4" height={height} rx="1.2" fill={positive ? color : "transparent"} stroke={color} strokeWidth="1.2" />
          </motion.g>
        );
      })}
    </g>
  );
}

export function NavChart({ points, candles = [], mode = "area", tone = "flat", range = "1M", intro = false, yLabels = [], xLabels = [], priceLabel = "", empty = null }) {
  const reduce = useReducedMotion();
  const geo = lineGeometry(points);
  const reactId = useId().replace(/:/g, "");
  const color = tone === "down" ? "var(--down)" : tone === "up" ? "var(--up)" : "var(--lav)";
  const showLine = mode !== "candles" && geo;
  const showCandles = mode === "candles" && candles.length >= 2;
  const draw = { duration: reduce ? 0 : intro ? 1.1 : 0.8, ease: easeInOut };
  return (
    <div className="chart-block">
      <div className="chart-y">
        {yLabels.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="chart-stage" style={{ "--stroke": color }}>
        <svg viewBox="0 0 728 90" preserveAspectRatio="none" role="img" aria-label={`${mode} chart`}>
          {showLine && (
            <>
              <defs>
                <linearGradient id={`nav-fade-${reactId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={color} stopOpacity="0.18" />
                  <stop offset="1" stopColor={color} stopOpacity="0" />
                </linearGradient>
              </defs>
              {mode === "area" && (
                <motion.path
                  d={geo.area}
                  fill={`url(#nav-fade-${reactId})`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: reduce ? 0 : 0.5, delay: reduce ? 0 : intro ? 0.7 : 0.45 }}
                />
              )}
              <motion.path
                d={geo.d}
                fill="none"
                stroke={color}
                strokeWidth="2.2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                initial={{ pathLength: reduce ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={draw}
              />
              <line x1="0" x2="700" y1={geo.end[1]} y2={geo.end[1]} stroke={color} strokeOpacity="0.35" strokeDasharray="3 3" />
            </>
          )}
          {showCandles && <CandleLayer candles={candles} range={range} reduce={reduce} />}
        </svg>
        {showLine && (
          <motion.span
            className="end-dot"
            style={{ left: `${(geo.end[0] / 728) * 100}%`, top: `${(geo.end[1] / 90) * 100}%` }}
            initial={{ opacity: reduce ? 1 : 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduce ? 0 : 0.25, delay: reduce ? 0 : intro ? 1.05 : 0.76 }}
          />
        )}
        {showLine && priceLabel && (
          <span className="value-badge num" style={{ top: `${(geo.end[1] / 90) * 100}%` }}>{priceLabel}</span>
        )}
        {!showLine && !showCandles && empty}
      </div>
      <div className="chart-x">
        {xLabels.map((label) => <span key={label}>{label}</span>)}
      </div>
    </div>
  );
}
