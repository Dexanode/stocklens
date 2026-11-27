import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import "@rainbow-me/rainbowkit/styles.css";
import {
  ConnectButton,
  getDefaultConfig,
  RainbowKitProvider,
} from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAccount, WagmiProvider } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import "./index.css";
import "./b20.css";
import "./market-layout.css";
import { resolveShareId } from "./thesis-share.js";
import { guardedWalletProvider, walletIsOnBaseSepolia } from "./wallet-network.js";
import { navFreshness } from "./market-freshness.js";
import { dataQualityScore, retainLoadedHistory } from "./data-quality.js";
import { legacyProofScore } from "./legacy-proof-score.js";
import { proofChangeBps, displayProofChange } from "./proof-change.js";
import { paperPosition, paperPlanIsValid } from "./paper-validation.js";

const walletConnectProjectId = String(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "").trim();
const wagmiConfig = getDefaultConfig({
  appName: "StockLens",
  appDescription: "Onchain research terminal for tokenized stock experiments.",
  appUrl: "https://stocklens-black-six.vercel.app",
  appIcon: "https://stocklens-black-six.vercel.app/favicon.svg",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "00000000000000000000000000000001",
  chains: [baseSepolia],
  ssr: false,
});
const queryClient = new QueryClient();

// Explicit mapping avoids presenting an unrelated company's logo for new B20 symbols.
const logoTickers = new Set(["AAPL", "AMZN", "GOOGL", "INTC", "META", "MSFT", "MSTR", "NVDA", "TSLA", "COIN", "HOOD"]);
function AssetIcon({ symbol }) {
  const [failed, setFailed] = useState(false);
  const ticker = symbol.endsWith("c") ? symbol.slice(0, -1) : "";
  useEffect(() => setFailed(false), [symbol]);
  const showLogo = logoTickers.has(ticker) && !failed;
  return <span className="asset-icon" aria-hidden="true">
    {showLogo ? <img src={`https://cdn.jsdelivr.net/gh/nvstly/icons@main/ticker_icons/${ticker}.png`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : symbol.slice(0, 1)}
  </span>;
}

const assets = {
  AAPLc: {
    name: "Apple",
    sector: "Tokenized equity / B20",
    price: "$184.20",
    change: "+2.84%",
    tone: "blue",
    risk: "Moderate",
    score: 74,
    volume: "$18.4M",
    time: "2 min ago",
    bull: "Clean momentum with strong liquidity.",
    bear: "Signal is concentrated in one trend.",
    color: "#2457ff",
    points:
      "4,55 52,42 100,49 148,28 196,39 244,25 292,34 340,18 388,30 436,22 484,35 532,13 580,22 628,8 676,17 724,4",
  },
  METAc: {
    name: "Meta",
    sector: "Tokenized equity / B20",
    price: "$212.64",
    change: "+5.12%",
    tone: "cyan",
    risk: "Elevated",
    score: 62,
    volume: "$12.8M",
    time: "4 min ago",
    bull: "Upside expands with crypto volume.",
    bear: "Highly sensitive to market beta.",
    color: "#00b8c8",
    points:
      "4,64 52,51 100,56 148,38 196,49 244,28 292,39 340,22 388,42 436,29 484,33 532,18 580,26 628,12 676,27 724,8",
  },
  TSLAc: {
    name: "Tesla",
    sector: "Tokenized equity / B20",
    price: "$248.71",
    change: "-1.08%",
    tone: "coral",
    risk: "High",
    score: 48,
    volume: "$9.7M",
    time: "7 min ago",
    bull: "A smaller position keeps the thesis measurable.",
    bear: "Choppy trend with elevated volatility.",
    color: "#ff6b52",
    points:
      "4,22 52,30 100,18 148,43 196,28 244,52 292,40 340,62 388,48 436,54 484,44 532,68 580,56 628,72 676,62 724,78",
  },
  NVDAc: {
    name: "NVIDIA",
    sector: "Tokenized equity / B20",
    price: "$138.91",
    change: "+3.41%",
    tone: "violet",
    risk: "Moderate",
    score: 81,
    volume: "$22.1M",
    time: "1 min ago",
    bull: "Momentum and score are aligned.",
    bear: "A strong score is not a return guarantee.",
    color: "#7959f5",
    points:
      "4,50 52,44 100,54 148,36 196,42 244,28 292,39 340,22 388,30 436,16 484,25 532,12 580,20 628,6 676,15 724,4",
  },
};

const safeDemoAssets = Object.fromEntries(Object.entries(assets).map(([symbol, item]) => [symbol, {
  ...item,
  price: "—",
  change: "N/A",
  risk: "Unknown",
  score: null,
  volume: "NAV unavailable",
  time: "Waiting for API",
  points: "",
  candles: [],
  navHistory: [],
  dataQuality: { nav: false, history: false, change: false },
}]));

const briefs = {
  AAPLc:
    "Momentum is positive, but the signal is concentrated in one clean trend. Watch liquidity before treating the move as conviction.",
  METAc:
    "B20 token identity is verified on Base mainnet. Treat the reference value as a market signal, not a guaranteed fill price.",
  TSLAc:
    "The trend is choppy and the risk lens is elevated. A smaller position keeps the experiment measurable while the thesis develops.",
  NVDAc:
    "The strongest demo signal in this watchlist: momentum and score are aligned. Still, a strong score is not a guarantee of future returns.",
};

const BASE_SEPOLIA = "0x14a34";
const BASE_SEPOLIA_PARAMS = {
  chainId: BASE_SEPOLIA,
  chainName: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia.base.org"],
  blockExplorerUrls: ["https://sepolia.basescan.org"],
};
const REGISTRY_ADDRESS = "0xA54A6c46Fc5c5D0f0Fca952f3445c35ad8e6dD1C";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_ABI = ["function balanceOf(address owner) view returns (uint256)", "function decimals() view returns (uint8)"];
const REGISTRY_ABI = [
  "function recordThesis(string symbol,uint256 priceCents,int256 changeBps,uint8 riskScore) returns (uint256)",
  "function thesisCount() view returns (uint256)",
  "function getThesis(uint256 thesisId) view returns (tuple(address researcher,string symbol,uint256 priceCents,int256 changeBps,uint8 riskScore,uint256 timestamp))",
  "event ThesisRecorded(uint256 indexed thesisId,address indexed researcher,string symbol,uint256 priceCents,int256 changeBps,uint8 riskScore)",
];

function chartPointsForRange(points, range) {
  if (!points) return "";
  const presets = {
    "1W": { scale: 0.72, offset: 13 },
    "1M": { scale: 1, offset: 0 },
    "3M": { scale: 0.9, offset: 5 },
    "1Y": { scale: 1.16, offset: -7 },
  };
  const preset = presets[range] || presets["1M"];
  return points
    .split(" ")
    .map((point, index) => {
      const [x, rawY] = point.split(",").map(Number);
      const wave =
        range === "3M"
          ? (index % 3) * 2
          : range === "1Y"
            ? ((index % 4) - 1) * 2
            : 0;
      const y = Math.max(
        5,
        Math.min(84, rawY * preset.scale + preset.offset + wave),
      );
      return `${x},${y.toFixed(1)}`;
    })
    .join(" ");
}

function numericPrice(value) {
  const parsed = Number(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function SharedThesisPage({ thesis, marketAssets, onExit }) {
  const [copyStatus, setCopyStatus] = useState("");
  const entry = numericPrice(thesis.entryPriceValue ?? thesis.entryPrice);
  const current = numericPrice(marketAssets[thesis.symbol]?.price);
  const change = entry && current ? ((current - entry) / entry) * 100 : null;
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyStatus("Link copied");
    } catch {
      setCopyStatus("Copy the link from your browser address bar.");
    }
  }
  return (
    <div className="shared-thesis-page">
      <header className="shared-thesis-topbar"><a className="shared-thesis-brand" href="/">STOCK<span>LENS</span></a><span>SHARED RESEARCH / PAPER ONLY</span></header>
      <main className="shared-thesis-main">
        <div className="kicker"><span>PUBLIC THESIS</span> / {thesis.symbol}</div>
        <div className="shared-thesis-heading"><div><h1>{thesis.title}</h1><p>{thesis.symbol} · {thesis.assetName || "Tokenized equity"} · Base B20</p></div><span className={`workspace-status ${(thesis.status || "OPEN").toLowerCase()}`}>{thesis.status || "OPEN"}</span></div>
        <div className="shared-thesis-grid">
          <section className="shared-thesis-card shared-thesis-note"><span>THESIS</span><p>{thesis.note}</p><div className="shared-thesis-meta"><span>CREATED <b>{new Date(thesis.createdAt).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })}</b></span><span>MODEL <b>{thesis.source || "StockLens baseline"}</b></span></div></section>
          <section className="shared-thesis-card"><span>OUTCOME SINCE ENTRY / LIVE NAV</span><strong className={change === null ? "" : change >= 0 ? "up" : "down"}>{change === null ? "NAV PENDING" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</strong><div className="shared-thesis-metrics"><span>ENTRY <b>{thesis.entryPrice || "—"}</b></span><span>CURRENT <b>{current ? formatUSD(current) : "—"}</b></span><span>RECORDED SCORE <b>{thesis.score ?? "—"}/100</b></span><span>CONVICTION <b>{thesis.conviction ?? "—"}/5</b></span><span>TARGET <b>{thesis.target === null || thesis.target === undefined ? "—" : `${thesis.target}%`}</b></span><span>REVIEWED <b>{(thesis.lastReviewedAt || thesis.reviewedAt) ? new Date(thesis.lastReviewedAt || thesis.reviewedAt).toLocaleDateString([], { day: "2-digit", month: "short" }) : "Not yet"}</b></span></div></section>
        </div>
        <div className="shared-thesis-proof"><span>DATA CONTEXT</span><b>B20 NAV / BASE MAINNET 8453</b><b>PAPER REGISTRY / BASE SEPOLIA 84532</b><small>Shared snapshot. Recorded scores may use older methods and are not an asset-risk rating. This page does not execute trades, custody funds, or provide financial advice.</small></div>
        <div className="shared-thesis-actions"><button type="button" onClick={copyLink}>COPY LINK ↗</button><button type="button" onClick={onExit}>OPEN STOCKLENS TERMINAL ↗</button><span role="status">{copyStatus}</span></div>
      </main>
    </div>
  );
}

function candlesForRange(candles = [], range) {
  const days = { "1W": 7, "1M": 30, "3M": 90, "1Y": 365 };
  const cutoff = Date.now() - days[range] * 864e5;
  return candles.filter(candle => candle.timestamp >= cutoff);
}

function candlesFromHistory(history = []) {
  const rows = history.filter((row) => Number.isFinite(Number(row?.price)) && Number.isFinite(Number(row?.timestamp))).sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  const buckets = new Map();
  for (const row of rows) {
    const price = Number(row.price);
    if (price <= 0) continue;
    const day = Math.floor(row.timestamp / 864e5);
    const candle = buckets.get(day);
    if (candle) {
      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price;
      candle.timestamp = Number(row.timestamp);
    } else {
      buckets.set(day, { timestamp: Number(row.timestamp), open: price, high: price, low: price, close: price });
    }
  }
  return [...buckets.values()];
}

function changeTone(value) {
  return String(value || "").trim().startsWith("+") ? "up" : String(value || "").trim().startsWith("-") ? "down" : "neutral-change";
}

function formatUSD(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number) : "—";
}

function formatUnits(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—";
}

function hasNav(item) {
  const price = Number(String(item?.price || "").replace(/[$,]/g, ""));
  return item?.dataQuality?.nav === true || (Number.isFinite(price) && price > 0);
}

function hasHistory(item) {
  return Array.isArray(item?.navHistory) && item.navHistory.length >= 3;
}

function isTrending(item) {
  const change = Number.parseFloat(String(item?.change || "").replace("%", ""));
  return (Number.isFinite(change) && Math.abs(change) >= 1) || Number(item?.score || 0) >= 75;
}

function chartRangeLabels(range) {
  return {
    "1W": ["7D AGO", "3D AGO", "NOW"],
    "1M": ["30D AGO", "15D AGO", "NOW"],
    "3M": ["90D AGO", "45D AGO", "NOW"],
    "1Y": ["1Y AGO", "6M AGO", "NOW"],
  }[range] || ["START", "MID", "NOW"];
}

function chartTimeX(timestamp, range) {
  const days = { "1W": 7, "1M": 30, "3M": 90, "1Y": 365 };
  const duration = (days[range] || 30) * 864e5;
  return 4 + 720 * Math.max(0, Math.min(1, (Number(timestamp) - (Date.now() - duration)) / duration));
}

function pointsFromSnapshots(history = [], range) {
  const days = { "1W": 7, "1M": 30, "3M": 90, "1Y": 365 };
  const cutoff = Date.now() - (days[range] || 30) * 864e5;
  const rows = history.filter((row) => Number(row.timestamp) >= cutoff && Number.isFinite(Number(row.price)) && Number(row.price) > 0).sort((a, b) => Number(a.timestamp) - Number(b.timestamp)).slice(-260);
  // Two observations only create a misleading straight-line/V-shape.
  // Wait for a third point before presenting a trend as a chart.
  if (rows.length < 3) return "";
  const values = rows.map((row) => Number(row.price)).filter(Number.isFinite);
  if (values.length < 2) return "";
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max((high - low) * 0.1, high * 0.001, 0.01);
  const bottom = low - padding;
  const scale = high + padding - bottom;
  return rows.map((row) => `${chartTimeX(row.timestamp, range)},${90 - ((Number(row.price) - bottom) / scale) * 90}`).join(" ");
}

function CandleChart({ candles, color, range }) {
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
        const candleColor = positive ? color : "#ff6b52";
        return (
          <g key={`${candle.timestamp}-${index}`}>
            <line
              x1={x}
              x2={x}
              y1={y(candle.high)}
              y2={y(candle.low)}
              stroke={candleColor}
              strokeWidth="1.4"
            />
            <rect
              x={x - 3.2}
              y={top}
              width="6.4"
              height={height}
              fill={positive ? candleColor : "transparent"}
              stroke={candleColor}
              strokeWidth="1.2"
            />
          </g>
        );
      })}
    </g>
  );
}

function SnapshotChart({ color }) {
  return (
    <g>
      <line x1="4" x2="724" y1="46" y2="46" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx="724" cy="46" r="4" fill={color} />
    </g>
  );
}

function StockLensLogo({ compact = false }) {
  return (
    <span
      className={`brand-lockup ${compact ? "compact" : ""}`}
      aria-label="StockLens"
    >
      <img className="brand-logo brand-logo-light" src="/brand-icon-light.svg" alt="" />
      <img className="brand-logo brand-logo-dark" src="/brand-icon-dark.svg" alt="" />
      <span className="brand-wordmark">
        <b>STOCK</b>LENS
      </span>
    </span>
  );
}

function WalletConnectButton({ className = "wallet-button" }) {
  if (!/^[a-z0-9]{32}$/i.test(walletConnectProjectId)) {
    return <button className={className} type="button" disabled title="WalletConnect project ID is not configured">Wallet modal unavailable</button>;
  }
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        if (!ready) return <button className={className} aria-hidden="true" />;
        if (!connected) {
          return (
            <button className={className} onClick={openConnectModal}>
              Connect wallet <b>↗</b>
            </button>
          );
        }
        return (
          <button
            className={className}
            onClick={chain.unsupported ? openChainModal : openAccountModal}
          >
            {chain.unsupported ? "Wrong network" : account.displayName} <b>↗</b>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

function App() {
  const [theme, setTheme] = useState(() => {
    try { return window.localStorage.getItem("stocklens-theme") || "light"; } catch { return "light"; }
  });
  const [complianceAccepted, setComplianceAccepted] = useState(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("stocklens-compliance-v2") || "null");
      return stored?.accepted === true && stored?.country && stored.country !== "US";
    } catch {
      return false;
    }
  });
  const [complianceCountry, setComplianceCountry] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem("stocklens-compliance-v2") || "null")?.country || ""; } catch { return ""; }
  });
  const [complianceConfirmed, setComplianceConfirmed] = useState(false);
  const [complianceError, setComplianceError] = useState("");
  const [selected, setSelected] = useState("AAPLc");
  const [marketSearch, setMarketSearch] = useState("");
  const [marketFilter, setMarketFilter] = useState("all");
  const [marketSort, setMarketSort] = useState("score");
  const [range, setRange] = useState("1M");
  const [chartType, setChartType] = useState("line");
  const [budget, setBudget] = useState(1000);
  const [budgetMode, setBudgetMode] = useState("manual");
  const [usdcBalance, setUsdcBalance] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [wallet, setWallet] = useState("");
  const [portfolio, setPortfolio] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("stocklens-paper-portfolio-v1") || "[]");
      return Array.isArray(saved) ? saved.filter((item) => item && typeof item.symbol === "string" && Number.isFinite(Number(item.units)) && Number.isFinite(Number(item.notional))) : [];
    } catch { return []; }
  });
  const [notice, setNotice] = useState("");
  const [txHash, setTxHash] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [marketAssets, setMarketAssets] = useState(safeDemoAssets);
  const [riskBriefs, setRiskBriefs] = useState(briefs);
  const [riskInsights, setRiskInsights] = useState({});
  const [dataMode, setDataMode] = useState("DEMO DATA");
  const [marketClock, setMarketClock] = useState(Date.now());
  const [riskLoading, setRiskLoading] = useState(false);
  const [aiDetailsOpen, setAiDetailsOpen] = useState(false);
  const [portfolioPlan, setPortfolioPlan] = useState(null);
  const [portfolioPreview, setPortfolioPreview] = useState(false);
  const [portfolioAgentLoading, setPortfolioAgentLoading] = useState(false);
  const [portfolioAgentError, setPortfolioAgentError] = useState("");
  const [expandedRebalance, setExpandedRebalance] = useState(null);
  const [shareLink, setShareLink] = useState(null);
  const [thesisHistory, setThesisHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [judgeStep, setJudgeStep] = useState(0);
  const [judgeRunning, setJudgeRunning] = useState(false);
  const [sharedThesis, setSharedThesis] = useState(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get("thesis");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  const [sharedThesisId] = useState(() => new URLSearchParams(window.location.search).get("thesisId"));
  const [sharedThesisLoading, setSharedThesisLoading] = useState(() => Boolean(new URLSearchParams(window.location.search).get("thesisId")));
  const [thesisWorkspace, setThesisWorkspace] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem("stocklens-thesis-workspace-v1") || "[]"); } catch { return []; }
  });
  const [thesisTitle, setThesisTitle] = useState("");
  const [thesisNote, setThesisNote] = useState("");
  const [thesisConviction, setThesisConviction] = useState(3);
  const [followUps, setFollowUps] = useState({});
  const [followUpLoading, setFollowUpLoading] = useState({});
  const [thesisEvents, setThesisEvents] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem("stocklens-thesis-events-v1") || "[]"); } catch { return []; }
  });
  const [dismissedAlerts, setDismissedAlerts] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem("stocklens-thesis-alerts-v1") || "{}"); } catch { return {}; }
  });
  const { address, connector, chainId } = useAccount();
  const asset = marketAssets[selected];
  const assetNavStatus = navFreshness(asset, marketClock);
  const assetHistoryAvailable = Array.isArray(asset.navHistory) && asset.navHistory.filter(row => Number.isFinite(Number(row?.price)) && Number(row.price) > 0).length >= 3;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { window.localStorage.setItem("stocklens-theme", theme); } catch { /* theme persistence is optional */ }
  }, [theme]);
  const filteredMarketAssets = useMemo(() => {
    const query = marketSearch.trim().toLowerCase();
    return Object.entries(marketAssets).filter(([symbol, item]) => {
      const matchesQuery = !query || `${symbol} ${item.name} ${item.sector}`.toLowerCase().includes(query);
      const change = Number.parseFloat(String(item.change).replace("%", ""));
      const matchesFilter = marketFilter === "all" || (marketFilter === "nav" && hasNav(item)) || (marketFilter === "trending" && isTrending(item));
      return matchesQuery && matchesFilter;
    }).sort(([, left], [, right]) => {
      if (marketSort === "price") return Number(String(right.price).replace(/[$,]/g, "")) - Number(String(left.price).replace(/[$,]/g, ""));
      if (marketSort === "supply") return Number(right.totalSupply || 0) - Number(left.totalSupply || 0);
      if (marketSort === "risk") return ({ High: 4, Elevated: 3, Moderate: 2, Lower: 1 }[right.risk] || 0) - ({ High: 4, Elevated: 3, Moderate: 2, Lower: 1 }[left.risk] || 0);
      if (marketSort === "updated") return String(right.navUpdatedAt || "").localeCompare(String(left.navUpdatedAt || ""));
      return Number(right.score || 0) - Number(left.score || 0);
    });
  }, [marketAssets, marketSearch, marketFilter, marketSort]);
  const chartPoints = useMemo(
    () => chartPointsForRange(asset.points, range) || pointsFromSnapshots(asset.navHistory, range),
    [asset.points, asset.navHistory, range],
  );
  const chartCandles = useMemo(
    () => candlesForRange(asset.candles.length ? asset.candles : candlesFromHistory(asset.navHistory), range),
    [asset.candles, asset.navHistory, range],
  );
  const chartHistoryMeta = useMemo(() => {
    const days = { "1W": 7, "1M": 30, "3M": 90, "1Y": 365 };
    const cutoff = Date.now() - (days[range] || 30) * 864e5;
    const snapshots = (Array.isArray(asset.navHistory) ? asset.navHistory : [])
      .filter((row) => Number(row.timestamp) >= cutoff && Number.isFinite(Number(row.price)))
      .sort((left, right) => Number(left.timestamp) - Number(right.timestamp));
    const latest = snapshots.at(-1);
    const first = snapshots[0];
    const coverageDays = first && latest ? Math.max(0, Math.round((Number(latest.timestamp) - Number(first.timestamp)) / 864e5)) : 0;
    return {
      count: snapshots.length,
      period: [first, latest].filter(Boolean).map(row => new Date(Number(row.timestamp)).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })).filter((date, index, dates) => dates.indexOf(date) === index).join(" – "),
      coverageDays,
      latest: latest?.timestamp ? new Date(Number(latest.timestamp)).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Awaiting first observation",
    };
  }, [asset.navHistory, range]);
  const chartLabels = chartRangeLabels(range);
  const chartYLabels = useMemo(() => {
    const days = { "1W": 7, "1M": 30, "3M": 90, "1Y": 365 };
    const cutoff = Date.now() - (days[range] || 30) * 864e5;
    const values = (Array.isArray(asset.navHistory) ? asset.navHistory : []).filter((row) => Number(row.timestamp) >= cutoff).map((row) => Number(row.price)).filter((value) => Number.isFinite(value) && value > 0);
    if (!values.length) return [];
    const source = values;
    const low = Math.min(...source);
    const high = Math.max(...source);
    const padding = Math.max((high - low) * 0.1, high * 0.001, 0.01);
    const top = high + padding;
    const bottom = low - padding;
    return [0, 1, 2, 3].map((index) => formatUSD(top - ((top - bottom) * index) / 3));
  }, [asset.navHistory, asset.price, range]);
  const matchingInsight = riskInsights[selected]?.navStatus === assetNavStatus ? riskInsights[selected] : null;
  const insight = matchingInsight || {
    confidence: 35,
    score: asset.score,
    risk: asset.risk,
    source: "Local baseline",
    fallback: true,
    bull: asset.bull,
    bear: asset.bear,
    catalysts: [
      "Momentum is the primary signal.",
      "Liquidity supports a measured paper position.",
    ],
    risks: [asset.bear, "Model output can lag sudden market changes."],
    portfolioRationale:
      "Keep the position sized to the quality of the signal and review it against the rest of the portfolio.",
  };
  const displayedScore = dataQualityScore(asset, marketClock);
  const displayedRisk = "Not assessed";
  const modelLabel = riskLoading ? "MODEL / THINKING…" : matchingInsight ? (insight.fallback ? "MODEL / FALLBACK" : "MODEL / V I K E Y") : "MODEL / BASELINE";
  const scoreBasis = "NAV availability · recent timestamp · history observations · comparison change / 25 points each";
  const allocation = useMemo(() => {
    const price = Number(String(asset.price).replace(/[$,]/g, ""));
    return Number.isFinite(price) && price > 0 ? budget / price : 0;
  }, [asset, budget]);
  const portfolioMetrics = useMemo(() => {
    const rows = portfolio.map((item) => {
      const current = Number(String(marketAssets[item.symbol]?.price || "").replace(/[$,]/g, ""));
      const value = Number.isFinite(current) ? item.units * current : item.notional;
      const pnl = value - Number(item.notional || 0);
      return { ...item, currentValue: value, pnl };
    });
    return { rows, total: rows.reduce((sum, item) => sum + item.currentValue, 0), pnl: rows.reduce((sum, item) => sum + item.pnl, 0) };
  }, [portfolio, marketAssets]);
  const rebalanceRows = useMemo(() => {
    if (!portfolioPlan?.allocations) return [];
    const current = new Map(portfolioMetrics.rows.map((item) => [item.symbol, item.currentValue]));
    return portfolioPlan.allocations.map((target) => {
      const currentPercent = portfolioMetrics.total > 0 ? (Number(current.get(target.symbol) || 0) / portfolioMetrics.total) * 100 : 0;
      const targetValue = Number(budget) * Number(target.targetPercent || 0) / 100;
      const currentValue = Number(current.get(target.symbol) || 0);
      const delta = Number(target.targetPercent || 0) - currentPercent;
      const deltaValue = targetValue - currentValue;
      return { ...target, currentPercent, targetValue, currentValue, delta, deltaValue, action: delta > 0.5 ? "ADD" : delta < -0.5 ? "REDUCE" : "HOLD" };
    });
  }, [portfolioPlan, portfolioMetrics, budget]);
  const targetPortfolio = useMemo(() => {
    if (!portfolioPlan?.allocations?.length) return [];
    return portfolioPlan.allocations.filter((item) => Number(item.targetPercent) > 0).map((item) => {
      const market = marketAssets[item.symbol];
      const price = Number(String(market?.price || "").replace(/[$,]/g, ""));
      const notional = Math.round(Number(budget) * Number(item.targetPercent) / 100 * 100) / 100;
      const validPrice = market?.dataQuality?.nav !== false && Number.isFinite(price) && price > 0;
      return { symbol: item.symbol, units: validPrice ? Number((notional / price).toFixed(8)) : 0, notional, entryPrice: validPrice ? price : null };
    });
  }, [portfolioPlan, marketAssets, budget]);
  const previewRows = useMemo(() => {
    if (!portfolioPlan?.allocations?.length) return [];
    const current = new Map(portfolioMetrics.rows.map((item) => [item.symbol, item.currentValue]));
    const targets = new Map(targetPortfolio.map((item) => [item.symbol, item.notional]));
    return rebalanceRows.map((item) => {
      const currentValue = Number(current.get(item.symbol) || 0);
      const targetValue = Number(targets.get(item.symbol) || 0);
      const deltaValue = targetValue - currentValue;
      return { ...item, currentValue, targetValue, deltaValue, action: deltaValue > 0.5 ? "ADD" : deltaValue < -0.5 ? "REDUCE" : "HOLD" };
    });
  }, [portfolioPlan, portfolioMetrics, rebalanceRows, targetPortfolio]);
  const largestMove = previewRows.reduce((best, row) => !best || Math.abs(row.deltaValue) > Math.abs(best.deltaValue) ? row : best, null);

  useEffect(() => {
    try { window.localStorage.setItem("stocklens-paper-portfolio-v1", JSON.stringify(portfolio)); } catch { setNotice("Paper portfolio could not be saved in this browser."); }
  }, [portfolio]);

  useEffect(() => {
    setWallet(address || "");
    if (address) {
      setNotice("Wallet connected on Base Sepolia. Ready for an onchain proof.");
    }
  }, [address]);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let lastHistoryRequest = 0;
    function refreshMarket() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      setMarketClock(Date.now());
      fetch("/api/market", { cache: "no-store" })
      .then((result) =>
        result.ok
          ? result.json()
          : Promise.reject(new Error("market_unavailable")),
      )
      .then((payload) => {
        if (!active) return;
        if (Object.keys(payload.data || {}).length) {
          const now = Date.now();
          let stored = {};
          try { stored = JSON.parse(window.localStorage.getItem("stocklens-nav-history-v1") || "{}"); } catch { stored = {}; }
          const nextData = Object.fromEntries(Object.entries(payload.data).map(([symbol, item]) => {
            const price = Number(String(item.price).replace(/[$,]/g, ""));
            const history = Array.isArray(stored[symbol]) ? stored[symbol].filter((row) => now - Number(row.timestamp) <= 366 * 864e5) : [];
            if (Number.isFinite(price) && price > 0 && (history.length === 0 || now - Number(history.at(-1).timestamp) > 15 * 60e3)) history.push({ timestamp: now, price });
            stored[symbol] = history.slice(-260);
            return [symbol, { ...item, navHistory: history }];
          }));
          try { window.localStorage.setItem("stocklens-nav-history-v1", JSON.stringify(stored)); } catch { /* snapshot storage is optional */ }
          setMarketAssets((current) => ({ ...current, ...Object.fromEntries(Object.entries(nextData).map(([symbol, item]) => [symbol, { ...item, navHistory: retainLoadedHistory(current[symbol]?.navHistory, item.navHistory) }])) }));
          if (now - lastHistoryRequest >= 15 * 60e3 && payload.source !== "Base B20 registry fallback") {
            lastHistoryRequest = now;
            fetch("/api/nav-history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snapshots: Object.fromEntries(Object.entries(nextData).map(([symbol, item]) => [symbol, { price: Number(String(item.price).replace(/[$,]/g, "")) }])) }) })
            .then((result) => result.json())
            .then((historyPayload) => {
              if (!active || !historyPayload.persistent || !historyPayload.history) return;
              setMarketAssets((current) => Object.fromEntries(Object.entries(current).map(([symbol, item]) => [symbol, { ...item, navHistory: historyPayload.history[symbol] || item.navHistory || [] }] )));
            })
            .catch(() => {});
          }
          setDataMode(payload.source === "Base B20 registry fallback" ? "NAV UNAVAILABLE" : "B20 MAINNET");
        }
      })
      .catch(() => { if (active) setDataMode("MARKET UPDATE FAILED"); })
      .finally(() => { inFlight = false; });
    }
    refreshMarket();
    const timer = window.setInterval(refreshMarket, 60e3);
    const onVisibility = () => { if (!document.hidden) refreshMarket(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setRiskLoading(true);
    const aiAsset = {
      symbol: selected,
      name: asset.name,
      sector: asset.sector,
      price: asset.price,
      change: asset.change,
      risk: asset.risk,
      score: asset.score,
      volume: asset.volume,
      navUpdatedAt: asset.navUpdatedAt,
      totalSupply: asset.totalSupply,
      multiplier: asset.multiplier,
      pausedFeatures: asset.pausedFeatures,
      dataQuality: { ...asset.dataQuality, history: assetHistoryAvailable },
    };
    fetch("/api/risk", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-stocklens-country": complianceCountry || "UNKNOWN" },
      body: JSON.stringify({ asset: aiAsset }),
      signal: controller.signal,
    })
      .then((result) =>
        result.ok
          ? result.json()
          : Promise.reject(new Error("risk_unavailable")),
      )
      .then((result) => {
        if (!active) return;
        if (result.summary) {
          setRiskBriefs((current) => ({
            ...current,
            [selected]: result.summary,
          }));
          setRiskInsights((current) => ({ ...current, [selected]: result }));
          setMarketAssets((current) => ({
            ...current,
            [selected]: {
              ...current[selected],
              score: Number.isFinite(Number(result.score)) ? Number(result.score) : current[selected]?.score,
              risk: result.risk || current[selected]?.risk,
            },
          }));
        }
      })
      .catch((error) => {
        if (active && error?.name !== "AbortError") setRiskBriefs((current) => ({ ...current, [selected]: "Risk service unavailable; showing the local baseline until live data returns." }));
      })
      .finally(() => { if (active) setRiskLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [selected, asset.navUpdatedAt, asset.price, assetNavStatus, assetHistoryAvailable]);

  useEffect(() => {
    setAiDetailsOpen(false);
  }, [selected]);

  useEffect(() => {
    try { window.localStorage.setItem("stocklens-thesis-workspace-v1", JSON.stringify(thesisWorkspace)); } catch { /* workspace persistence is optional */ }
  }, [thesisWorkspace]);

  useEffect(() => {
    try { window.localStorage.setItem("stocklens-thesis-events-v1", JSON.stringify(thesisEvents.slice(0, 120))); } catch { /* event persistence is optional */ }
  }, [thesisEvents]);

  useEffect(() => {
    try { window.localStorage.setItem("stocklens-thesis-alerts-v1", JSON.stringify(dismissedAlerts)); } catch { /* alert persistence is optional */ }
  }, [dismissedAlerts]);

  useEffect(() => {
    if (!sharedThesisId) return;
    fetch(`/api/thesis?id=${encodeURIComponent(sharedThesisId)}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("shared_thesis_unavailable")))
      .then((payload) => setSharedThesis(payload.thesis || null))
      .catch(() => setSharedThesis(null))
      .finally(() => setSharedThesisLoading(false));
  }, [sharedThesisId]);

  useEffect(() => {
    thesisWorkspace.slice(0, 5).forEach((item) => {
      if (!followUps[item.id] && !followUpLoading[item.id]) runFollowUp(item);
    });
  }, [thesisWorkspace.length, marketAssets]);

  useEffect(() => {
    let active = true;
    async function readUsdcBalance() {
      if (!wallet || wallet === "preview" || !window.ethereum) {
        setUsdcBalance(null);
        return;
      }
      try {
        const provider = new BrowserProvider(window.ethereum);
        const token = new Contract(USDC_ADDRESS, USDC_ABI, provider);
        const [raw, decimals] = await Promise.all([
          token.balanceOf(wallet),
          token.decimals(),
        ]);
        if (active) {
          const balance = Number(raw) / 10 ** Number(decimals);
          setUsdcBalance(balance);
          setBudget((current) => Math.min(Number(current), balance));
        }
      } catch {
        if (active) setUsdcBalance(null);
      }
    }
    readUsdcBalance();
    return () => {
      active = false;
    };
  }, [wallet]);

  useEffect(() => {
    let active = true;
    async function loadThesisHistory() {
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const result = await fetch("/api/history");
        const payload = await result.json();
        if (!result.ok) throw new Error(payload.error || "history_unavailable");
        if (active) setThesisHistory(payload.data || []);
      } catch {
        if (active)
          setHistoryError("Unable to load history from Base Sepolia.");
      } finally {
        if (active) setHistoryLoading(false);
      }
    }
    loadThesisHistory();
    return () => {
      active = false;
    };
  }, [txHash]);

  async function connectWallet() {
    try {
      if (window.ethereum) {
        const accounts = await window.ethereum.request({
          method: "eth_requestAccounts",
        });
        if (accounts?.[0]) {
          try {
            await window.ethereum.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: BASE_SEPOLIA }],
            });
          } catch (switchError) {
            if (switchError?.code === 4902)
              await window.ethereum.request({
                method: "wallet_addEthereumChain",
                params: [BASE_SEPOLIA_PARAMS],
              });
            else throw switchError;
          }
          setWallet(accounts[0]);
          setNotice(
            "Wallet connected on Base Sepolia. Ready for an onchain proof.",
          );
        }
      } else {
        setWallet("preview");
        setNotice("Preview wallet enabled. No browser wallet was detected.");
      }
    } catch {
      setNotice("Wallet connection cancelled.");
    }
  }

  async function proveOnchain() {
    if ((!connector && !window.ethereum) || !wallet || wallet === "preview") {
      setNotice("Connect a browser wallet first to write on Base Sepolia.");
      return;
    }
    setIsSending(true);
    setNotice("Checking the connected wallet network…");
    try {
      const walletProvider = connector ? await connector.getProvider() : window.ethereum;
      if (!await walletIsOnBaseSepolia(connector, walletProvider, chainId)) {
        setNotice("Switch your connected wallet to Base Sepolia before recording.");
        return;
      }
      const provider = new BrowserProvider(guardedWalletProvider(connector, walletProvider, chainId, wallet));
      const signer = await provider.getSigner();
      if ((await signer.getAddress()).toLowerCase() !== wallet.toLowerCase()) {
        setNotice("Connected wallet account changed. Reconnect before recording.");
        return;
      }
      if (await provider.getCode(REGISTRY_ADDRESS) === "0x") {
        setNotice("StockLens registry is unavailable on this network.");
        return;
      }
      if (!await walletIsOnBaseSepolia(connector, walletProvider, chainId)) {
        setNotice("Switch your connected wallet to Base Sepolia before recording.");
        return;
      }
      const registry = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, signer);
      const priceValue = Number(asset.price.replace(/[$,]/g, ""));
      if (!Number.isFinite(priceValue)) {
        setNotice("B20 NAV is unavailable. Wait for a reference price before recording a thesis.");
        return;
      }
      const priceCents = Math.round(priceValue * 100);
      const changeBps = proofChangeBps(asset.change);
      const transaction = await registry.recordThesis(
        selected,
        priceCents,
        changeBps,
        legacyProofScore({ ...asset, dataQuality: { ...asset.dataQuality, history: assetHistoryAvailable } }),
        { chainId: 84532 },
      );
      setTxHash(transaction.hash);
      setNotice(
        "Contract call submitted. Waiting for Base Sepolia confirmation…",
      );
      const receipt = await transaction.wait();
      const recorded = receipt?.logs.some((log) => {
        if (log.address.toLowerCase() !== REGISTRY_ADDRESS.toLowerCase()) return false;
        try { return registry.interface.parseLog(log)?.name === "ThesisRecorded"; } catch { return false; }
      });
      setNotice(recorded ? "Thesis recorded in StockLensRegistry on Base Sepolia." : "Transaction confirmed, but the thesis record could not be verified.");
    } catch (error) {
      setNotice(
        error?.shortMessage || "Contract transaction cancelled or rejected.",
      );
    } finally {
      setIsSending(false);
    }
  }

  function chooseBudget(percent) {
    if (!usdcBalance) return;
    setBudgetMode(`${percent}%`);
    setBudget(Math.round((usdcBalance * percent) * 100 / 100) / 100);
  }

  function runSimulation() {
    const position = paperPosition(selected, asset, budget);
    if (!position) {
      setNotice("Enter a positive paper budget and wait for an available NAV before simulating.");
      return;
    }
    setIsSimulating(true);
    setPortfolio((items) => [
      position,
      ...items.filter((item) => item.symbol !== selected),
    ]);
    setNotice(
      `${selected} paper position added. ${insight.portfolioRationale}`,
    );
    window.setTimeout(() => setIsSimulating(false), 850);
  }

  function applyPortfolioPlan() {
    if (!paperPlanIsValid(targetPortfolio, budget)) {
      setNotice("A positive budget and available NAV for every target are required before applying the plan.");
      return;
    }
    setPortfolio(targetPortfolio);
    setPortfolioPreview(false);
    setNotice(`Portfolio target applied to the local paper book: ${targetPortfolio.length} positions. No order was sent.`);
  }

  function removePosition(symbol) {
    setPortfolio((items) => items.filter((item) => item.symbol !== symbol));
  }

  async function runPortfolioAgent() {
    setPortfolioAgentLoading(true);
    setPortfolioAgentError("");
    try {
      const universe = Object.entries(marketAssets).map(([symbol, item]) => ({
        symbol,
        name: item.name,
        risk: "Unknown",
        score: dataQualityScore(item, Date.now()),
        price: item.price,
        change: item.change,
        volume: item.volume,
        contractAddress: item.contractAddress,
        navUpdatedAt: item.navUpdatedAt,
        totalSupply: item.totalSupply,
        multiplier: item.multiplier,
        pausedFeatures: item.pausedFeatures,
        dataQuality: { ...item.dataQuality, history: Array.isArray(item.navHistory) && item.navHistory.length >= 3 },
        navHistory: Array.isArray(item.navHistory) ? item.navHistory.slice(-260) : [],
        volatility: item.volatility ?? null,
      }));
      const result = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-stocklens-country": complianceCountry || "UNKNOWN" },
        body: JSON.stringify({ universe, holdings: portfolio }),
      }).then((response) =>
        response.ok ? response.json() : response.json().then((body) => Promise.reject(new Error(body.error || "portfolio_agent_unavailable"))),
      );
      setPortfolioPlan(result);
      setNotice("Portfolio Agent finished. Review the target allocation before paper trading.");
      return true;
    } catch (error) {
      setPortfolioAgentError(error?.message || "Portfolio Agent is unavailable.");
      return false;
    } finally {
      setPortfolioAgentLoading(false);
    }
  }

  function startJudgeDemo() {
    const firstLive = Object.entries(marketAssets).find(([, item]) => hasNav(item))?.[0] || Object.keys(marketAssets)[0];
    if (firstLive) {
      setSelected(firstLive);
      setJudgeStep(1);
    }
    setJudgeRunning(true);
    setNotice("Judge Mode started: reading B20 NAV and preparing a paper-only thesis.");
    window.setTimeout(() => setJudgeStep(2), 650);
    window.setTimeout(async () => {
      setJudgeStep(3);
      const ready = await runPortfolioAgent();
      setJudgeRunning(false);
      if (!ready) {
        setNotice("Portfolio Agent failed. Run the walkthrough again.");
        return;
      }
      setJudgeStep(4);
      setNotice("Judge Mode is ready. Review the rebalance, apply it to your paper portfolio, or optionally record a thesis.");
    }, 1350);
  }

  // Edit-token ownership (PR #1 rev 3): the server returns one editToken
  // per thesis, only in the POST response that creates it. It is kept
  // here, in a localStorage map keyed by thesis id — never in the thesis
  // object itself, never in a share link, and never sent to the server
  // except as the x-edit-token header on PUT. A thesis whose token this
  // browser does not hold cannot be edited from here (server: 401, or
  // 410 for legacy theses created before tokens existed).
  const EDIT_TOKENS_KEY = "stocklens-thesis-edit-tokens-v1";
  function loadEditTokens() {
    try { return JSON.parse(window.localStorage.getItem(EDIT_TOKENS_KEY) || "{}") || {}; } catch { return {}; }
  }
  function storeEditToken(id, token) {
    if (!id || !token) return;
    try {
      const tokens = loadEditTokens();
      tokens[id] = token;
      window.localStorage.setItem(EDIT_TOKENS_KEY, JSON.stringify(tokens));
    } catch { /* without the token the thesis becomes read-only on this device */ }
  }
  function editTokenFor(id) {
    return loadEditTokens()[id] || "";
  }

  async function saveThesis() {
    const next = {
      id: `${selected}-${Date.now()}`,
      symbol: selected,
      title: thesisTitle.trim() || `${selected} / ${asset.name}`,
      note: thesisNote.trim() || "Review the signal against NAV freshness, momentum, and portfolio context.",
      conviction: Number(thesisConviction),
      status: "OPEN",
      createdAt: new Date().toISOString(),
      entryPrice: asset.price,
      score: displayedScore,
      risk: displayedRisk,
      change: asset.change,
      target: portfolioPlan?.allocations?.find((item) => item.symbol === selected)?.targetPercent ?? null,
      source: modelLabel,
      entryPriceValue: numericPrice(asset.price),
      lastReviewedAt: null,
      reviewCount: 0,
    };
    let saved = next;
    let savedPayload = null;
    try {
      const response = await fetch("/api/thesis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const payload = response.ok ? await response.json() : null;
      savedPayload = payload;
      if (payload?.thesis) {
        saved = payload.thesis;
        if (payload.editToken) storeEditToken(saved.id, payload.editToken);
      }
    } catch { /* local cache remains available when persistence is offline */ }
    setThesisWorkspace((items) => [saved, ...items.filter((item) => item.id !== saved.id)].slice(0, 30));
    recordThesisEvent(saved.id, saved.symbol, "THESIS CREATED", saved.title);
    setThesisTitle("");
    setThesisNote("");
    runFollowUp(saved);
    // Rev 7: a 200 means put() succeeded — the record IS stored — but
    // `pendingPropagation` means a fresh re-read had not seen it yet
    // (Blob reads lag writes ~10–25 s). Say so instead of implying it
    // is already visible server-side.
    const savedNote = `${selected} thesis saved ${saved.id?.startsWith("th_") ? "on the server" : "locally"}. It is paper-only and can be reviewed at any time.`;
    setNotice(savedPayload?.pendingPropagation ? `${savedNote} The server saved this change, but it may take time to appear on refresh.` : savedNote);
  }

  function updateThesisStatus(id, status) {
    const current = thesisWorkspace.find((item) => item.id === id);
    const next = current ? { ...current, status, updatedAt: new Date().toISOString() } : null;
    if (!next) return;
    setThesisWorkspace((items) => items.map((item) => item.id === id ? next : item));
    persistThesis(next).then((result) => {
      if (result?.status === 410) setNotice(`This ${next.symbol} thesis was created before edit tokens and is read-only on the server. Changes are saved locally. Duplicate it as a new thesis to edit it.`);
      else if (result?.status === 503) setNotice(`Could not save ${next.symbol} status on the server (${result?.code || "store_unavailable"}). Changes are saved locally; try again shortly.`);
      else if (result?.thesis) {
        setThesisWorkspace((items) => items.map((entry) => entry.id === result.thesis.id ? { ...entry, ...result.thesis } : entry));
        if (result?.pendingPropagation) setNotice(`${next.symbol} status was saved on the server but may take time to appear on refresh.`);
      }
    });
    recordThesisEvent(next.id, next.symbol, `STATUS → ${status}`, `Thesis status changed from the workspace.`);
  }

  async function persistThesis(item) {
    if (!item?.id?.startsWith("th_")) return { status: 0 };
    try {
      const response = await fetch("/api/thesis", { method: "PUT", headers: { "Content-Type": "application/json", "x-edit-token": editTokenFor(item.id) }, body: JSON.stringify(item) });
      // Rev 7: return the whole result. On success (200) the body
      // carries the record as written — a successful put() IS the write
      // — plus `verified` / `pendingPropagation`: whether a fresh
      // re-read has already seen it. `pendingPropagation` is a normal
      // outcome under Blob read lag, not a failure; callers adopt the
      // record and say it will confirm on refresh. A 503 now means a
      // real failure (put() threw, or the pre-write read failed).
      const payload = await response.json().catch(() => null);
      return { status: response.status, thesis: payload?.thesis || null, code: payload?.code || null, error: payload?.error || null, verified: payload?.verified ?? null, pendingPropagation: payload?.pendingPropagation || false };
    } catch { /* local state remains available */ return { status: 0 }; }
  }

  async function runFollowUp(item) {
    if (!item?.id) return;
    setFollowUpLoading((current) => ({ ...current, [item.id]: true }));
    try {
      const response = await fetch("/api/follow-up", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thesis: item, market: marketAssets[item.symbol] || {} }) });
      if (!response.ok) throw new Error("follow_up_unavailable");
      const result = await response.json();
      setFollowUps((current) => ({ ...current, [item.id]: result }));
    } catch { /* follow-up remains unavailable without hiding the thesis */ }
    finally { setFollowUpLoading((current) => ({ ...current, [item.id]: false })); }
  }

  function reviewThesis(id) {
    const item = thesisWorkspace.find((entry) => entry.id === id);
    if (!item) return;
    const currentPrice = numericPrice(marketAssets[item.symbol]?.price);
    const next = {
      ...item,
      lastReviewedAt: new Date().toISOString(),
      lastReviewedPrice: currentPrice,
      reviewCount: Number(item.reviewCount || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    setThesisWorkspace((items) => items.map((entry) => entry.id === id ? next : entry));
    persistThesis(next).then((result) => {
      if (result?.status === 410) setNotice(`This ${item.symbol} thesis was created before edit tokens and is read-only on the server. Changes are saved locally. Duplicate it as a new thesis to edit it.`);
      else if (result?.status === 503) setNotice(`Could not save the ${item.symbol} review on the server (${result?.code || "store_unavailable"}). Changes are saved locally; try again shortly.`);
      else if (result?.thesis) {
        setThesisWorkspace((items) => items.map((entry) => entry.id === result.thesis.id ? { ...entry, ...result.thesis } : entry));
        if (result?.pendingPropagation) setNotice(`The ${item.symbol} review was saved on the server but may take time to appear on refresh.`);
      }
    });
    runFollowUp(next);
    recordThesisEvent(next.id, next.symbol, "OUTCOME REVIEWED", "NAV snapshot and agent follow-up refreshed.");
    setNotice(`${item.symbol} outcome reviewed using the latest available NAV.`);
  }

  async function duplicateThesis(item) {
    const copy = { ...item };
    delete copy.id;
    delete copy.editable;
    copy.title = `${item.title} (copy)`;
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = new Date().toISOString();
    copy.status = "OPEN";
    try {
      const response = await fetch("/api/thesis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(copy) });
      const payload = response.ok ? await response.json() : null;
      if (payload?.thesis) {
        if (payload.editToken) storeEditToken(payload.thesis.id, payload.editToken);
        setThesisWorkspace((items) => [payload.thesis, ...items].slice(0, 30));
        recordThesisEvent(payload.thesis.id, payload.thesis.symbol, "THESIS DUPLICATED", `Duplicated from legacy thesis ${item.id}.`);
        setNotice(`${item.symbol} thesis duplicated as a new editable thesis.`);
        return;
      }
    } catch { /* fall through to a local-only duplicate below */ }
    const local = { ...copy, id: `${item.symbol}-${Date.now()}` };
    setThesisWorkspace((items) => [local, ...items].slice(0, 30));
    setNotice(`${item.symbol} thesis duplicated locally (the server is unreachable).`);
  }

  function recordThesisEvent(thesisId, symbol, type, detail) {
    setThesisEvents((items) => [{ id: `${thesisId}-${Date.now()}`, thesisId, symbol, type, detail, createdAt: new Date().toISOString() }, ...items].slice(0, 120));
  }

  function dismissAlert(id) {
    setDismissedAlerts((items) => ({ ...items, [id]: new Date().toISOString() }));
  }

  async function shareThesis(item) {
    // Rev 7: never put an unverified id in a share link. resolveShareId
    // (src/thesis-share.js) GET-verifies the id with retries first — a
    // single 404 proves nothing while Blob reads lag writes ~10–25 s —
    // then checks the list for a content match before re-creating, so a
    // stale verify can no longer mint a duplicate. When the server is
    // unreachable it returns "" and we fall back to the ?thesis= JSON
    // link, which always works. saveThesis already adopts the server id
    // from the POST response, so a freshly saved thesis links correctly;
    // this covers the local-only and orphan-id paths.
    const resolved = await resolveShareId(item, fetch);
    const serverId = resolved.serverId;
    if (resolved.thesis) {
      if (resolved.editToken) storeEditToken(resolved.thesis.id, resolved.editToken);
      setThesisWorkspace((items) => items.map((entry) => entry.id === item.id ? resolved.thesis : entry));
    }
    const outcome = thesisOutcome(item);
    const payload = {
      ...item,
      assetName: marketAssets[item.symbol]?.name || item.symbol,
      currentPrice: outcome.current ? `$${outcome.current.toFixed(2)}` : "—",
      changeSinceEntry: outcome.change,
      reviewedAt: item.lastReviewedAt || null,
      sharedAt: new Date().toISOString(),
    };
    const url = serverId
      ? `${window.location.origin}${window.location.pathname}?thesisId=${encodeURIComponent(serverId)}`
      : `${window.location.origin}${window.location.pathname}?thesis=${encodeURIComponent(JSON.stringify(payload))}`;
    setShareLink({ id: serverId || item.id, url });
    const copied = navigator.clipboard?.writeText(url);
    if (copied) copied.then(() => setNotice(`${item.symbol} shareable thesis link copied.`)).catch(() => setNotice("The link is ready, but the browser denied clipboard access."));
    else setNotice("The link is ready, but the browser does not provide clipboard access.");
  }

  function thesisOutcome(item) {
    const entry = numericPrice(item.entryPriceValue ?? item.entryPrice);
    const current = numericPrice(marketAssets[item.symbol]?.price);
    const change = entry && current ? ((current - entry) / entry) * 100 : null;
    return { entry, current, change };
  }

  const thesisAlerts = thesisWorkspace.flatMap((item) => {
    const outcome = thesisOutcome(item);
    const followUp = followUps[item.id];
    const alerts = [];
    if (outcome.change !== null && outcome.change <= -5) alerts.push({ id: `${item.id}-drawdown`, symbol: item.symbol, severity: "HIGH", title: "Return below thesis threshold", detail: `${outcome.change.toFixed(2)}% since entry. Reassess invalidation before adding risk.` });
    if (followUp?.reviewWindow?.toLowerCase().includes("today") || followUp?.reviewWindow?.toLowerCase().includes("24 hours")) alerts.push({ id: `${item.id}-review`, symbol: item.symbol, severity: "REVIEW", title: "Thesis needs review", detail: followUp.nextAction });
    if (item.status === "OPEN" && !item.lastReviewedAt && !followUp) alerts.push({ id: `${item.id}-first-review`, symbol: item.symbol, severity: "NEW", title: "First review pending", detail: "Run the follow-up agent after the first NAV observation." });
    return alerts;
  }).filter((alert) => !dismissedAlerts[alert.id]);
  const timelineItems = [...thesisEvents].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))).slice(0, 30);

  if (sharedThesisLoading) {
    return <div className="shared-thesis-loading">READING SERVER-SIDE THESIS…</div>;
  }
  if (sharedThesis) {
    return <SharedThesisPage thesis={sharedThesis} marketAssets={marketAssets} onExit={() => { window.history.replaceState({}, "", window.location.pathname); setSelected(sharedThesis.symbol); setSharedThesis(null); window.setTimeout(() => document.getElementById("watchlist")?.scrollIntoView({ behavior: "smooth" }), 0); }} />;
  }

  const pick = (symbol) => {
    setSelected(symbol);
    setNotice(`${symbol} selected. Review the thesis before simulating.`);
  };

  function acceptCompliance(event) {
    event.preventDefault();
    if (!complianceCountry) {
      setComplianceError("Select the country or region where you are located.");
      return;
    }
    if (complianceCountry === "US") {
      setComplianceError("StockLens is not available to US users or US persons.");
      return;
    }
    if (!complianceConfirmed) {
      setComplianceError("Confirm the paper-only statement to enter.");
      return;
    }
    try {
      window.localStorage.setItem("stocklens-compliance-v2", JSON.stringify({ accepted: true, country: complianceCountry, acceptedAt: new Date().toISOString() }));
    } catch {
      // The gate still applies for this session when storage is unavailable.
    }
    setComplianceAccepted(true);
  }

  return (
    <div className="terminal-app">
      {!complianceAccepted && (
        <div className="compliance-backdrop" role="dialog" aria-modal="true" aria-labelledby="compliance-title">
          <div className="welcome-layout">
            <section className="welcome-intro" aria-labelledby="welcome-title">
              <div className="welcome-brand">STOCK<span>LENS</span> <small> / RESEARCH TERMINAL</small></div>
              <div className="welcome-eyebrow">TOKENIZED STOCK RESEARCH / BASE</div>
              <h1 id="welcome-title">From market data<br />to a testable thesis.</h1>
              <p>Explore B20 reference NAVs, challenge an AI research brief, and build a paper portfolio. Record a thesis on Base Sepolia if you choose.</p>
              <div className="welcome-steps" aria-label="How StockLens works">
                <div><b>01</b><span><strong>RESEARCH</strong><small>Explore NAV &amp; AI context</small></span></div>
                <div><b>02</b><span><strong>SIMULATE</strong><small>Test a paper allocation</small></span></div>
                <div><b>03</b><span><strong>VERIFY</strong><small>Optionally record a thesis</small></span></div>
              </div>
              <div className="welcome-context"><span>BASE MAINNET / NAV DATA</span><span>BASE SEPOLIA / OPTIONAL PROOF</span></div>
            </section>
          <form className="compliance-card" onSubmit={acceptCompliance}>
            <div className="compliance-kicker">01 / BEFORE YOU ENTER</div>
            <h2 id="compliance-title">Research mode only.</h2>
            <p>
              StockLens is a research terminal for tokenized stock reference data on Base.
              All positions are simulated; the app does not execute orders or custody assets.
            </p>
            <label className="compliance-label" htmlFor="compliance-country">Your location</label>
            <select
              id="compliance-country"
              value={complianceCountry}
              onChange={(event) => {
                setComplianceCountry(event.target.value);
                setComplianceError("");
              }}
            >
              <option value="">Select country / region</option>
              <option value="ID">Indonesia</option>
              <option value="SG">Singapore</option>
              <option value="AU">Australia</option>
              <option value="GB">United Kingdom</option>
              <option value="EU">European Union</option>
              <option value="US">United States</option>
              <option value="OTHER">Other</option>
            </select>
            <label className="compliance-check">
              <input
                type="checkbox"
                checked={complianceConfirmed}
                onChange={(event) => {
                  setComplianceConfirmed(event.target.checked);
                  setComplianceError("");
                }}
              />
              <span>I understand this is paper-only research, not financial advice, and I will not use it where restricted.</span>
            </label>
            {complianceError && <p className="compliance-error">{complianceError}</p>}
            <button className="compliance-submit" type="submit">Enter research terminal <b>↗</b></button>
            <small className="compliance-note">Access is blocked for US users/persons. Do not connect funds or place live trades.</small>
          </form>
          </div>
        </div>
      )}
      <aside className="sidebar">
        <a className="brand" href="#top">
          <StockLensLogo />
        </a>
        <div className="workspace-label">
          WORKSPACE <b>01</b>
        </div>
        <nav className="side-nav">
          <a className="active" href="#overview">
            Overview
          </a>
          <a href="#watchlist">
            Markets
          </a>
          <a href="#lens">
            Risk lens
          </a>
          <a href="#simulate">Paper lab</a>
          <a href="#thesis-workspace">Thesis workspace</a>
          <a href="#thesis-activity">Activity center</a>
        </nav>
        <div className="side-bottom">
          <div className="base-chip">
            <i /> B20 BASE <span>8453</span>
          </div>
          <p className="chain-note">Paper registry / wallet: Base Sepolia <b>84532</b></p>
          <p>Research surface for tokenized stock experiments.</p>
          <a href="#simulate" className="side-link">
            Open paper lab <b>↗</b>
          </a>
        </div>
      </aside>
      <div className="main-column" id="top">
        <header className="topbar">
          <div className="mobile-brand">
            <StockLensLogo compact />
            <span>/ TERMINAL</span>
          </div>
          <div className="breadcrumb">
                Research / <b>Market overview</b>
          </div>
          <div className="top-actions">
            <button className="theme-toggle demo-launch" onClick={startJudgeDemo} disabled={judgeRunning || portfolioAgentLoading}>{judgeRunning ? "Running demo…" : "Start demo"}</button>
            {judgeStep === 4 && <a href="#simulate">View plan</a>}
                <span className="paper-badge">Paper only</span>
            <button className="theme-toggle" type="button" onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
              {theme === "dark" ? "Light" : "Dark"}
            </button>
            <span className="status">
              <i /> {wallet ? "Wallet ready" : dataMode}
            </span>
            <WalletConnectButton />
          </div>
        </header>
        <main>
          {judgeStep > 0 && (
            <section className="judge-demo" aria-label="Demo progress" aria-live="polite">
              <div className="judge-demo-head"><div><span className="kicker">Paper-only walkthrough</span><strong>Explore StockLens</strong></div></div>
              <div className="judge-steps">
                {["Select asset", "Read NAV", "Build allocation", "Review plan"].map((label, index) => (
                  <div key={label} className={judgeStep === index + 1 ? "active" : ""} style={{ padding: "12px", fontSize: "12px" }}>
                    {label} {judgeStep > index + 1 ? "✓" : ""}
                  </div>
                ))}
              </div>
              <div className="judge-demo-body"><p>{judgeRunning ? "Preparing the portfolio plan…" : judgeStep === 4 ? "Review the proposed allocation in Paper lab." : "The plan could not be prepared. Start the demo again."}</p></div>
              {judgeStep === 4 && <div className="judge-demo-actions"><a className="judge-primary" href="#simulate">View portfolio plan ↗</a></div>}
            </section>
          )}
          <div id="overview" />
          <section id="watchlist" className="research-grid">
            <div className="watchlist-panel panel">
              <div className="panel-head">
                <div>
                  <h2>Watchlist</h2>
                </div>
                  <div className="watchlist-tools">
                    <label className="market-search" id="asset-search">
                      <span>Search</span>
                      <input value={marketSearch} onChange={(event) => setMarketSearch(event.target.value)} placeholder="Ticker or name" aria-label="Search markets" />
                    </label>
                    <select className="market-select" value={marketFilter} onChange={(event) => setMarketFilter(event.target.value)} aria-label="Market filter"><option value="all">All</option><option value="nav">NAV available</option><option value="trending">Trending</option></select>
                    <select className="market-select" value={marketSort} onChange={(event) => setMarketSort(event.target.value)} aria-label="Market sort"><option value="score">Score</option><option value="price">Price</option><option value="supply">Supply</option><option value="risk">Risk</option><option value="updated">Updated</option></select>
                    <span className="count">{filteredMarketAssets.length}/{Object.keys(marketAssets).length} ASSETS</span>
                  </div>
              </div>
              <div className="asset-list">
                {filteredMarketAssets.map(([symbol, item]) => (
                  <button
                    key={symbol}
                    className={`asset-row ${symbol === selected ? "active" : ""}`}
                    onClick={() => pick(symbol)}
                  >
                    <AssetIcon symbol={symbol} />
                    <span className="asset-name">
                      <b>{symbol}</b>
                      <small>
                        {item.name} / {item.sector}
                      </small>
                      <span className={`market-badge ${navFreshness(item, marketClock) === "current" ? "live" : "pending"}`}>{({ current: "NAV CURRENT", delayed: "NAV DELAYED", unknown: "NAV TIME UNKNOWN", unavailable: "NAV UNAVAILABLE" })[navFreshness(item, marketClock)]}</span>
                      {hasNav(item) && <span className={`market-badge ${hasHistory(item) ? "live" : "pending"}`}>{hasHistory(item) ? "HISTORY AVAILABLE" : "HISTORY PENDING"}</span>}
                    </span>
                    <span className="asset-price">
                      <b>{item.price}</b>
                      <small
                        className={changeTone(item.change)}
                      >
                        {item.change === "N/A" ? "—" : item.change}
                      </small>
                    </span>
                    <span className="row-arrow">↗</span>
                  </button>
                ))}
              </div>
              <div className="panel-foot">
                <span>Curated universe</span>
                <span>NAV time {asset.navUpdatedAt ? new Date(asset.navUpdatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "unavailable"}</span>
              </div>
              <div className="panel-foot"><span>{dataMode === "MARKET UPDATE FAILED" || dataMode === "NAV UNAVAILABLE" ? "Market refresh unavailable" : "Refreshes every minute while open"}</span><span>NAV delayed after 1 hour</span></div>
            </div>
            <div className="chart-panel panel">
              <a className="switch-asset" href="#asset-search" onClick={() => document.querySelector(".market-search input")?.focus()}>Search assets ↓</a>
              <div className="panel-head chart-head">
                <div>
                  <span className="kicker">
                    <span>Selected asset</span> / {asset.sector}
                  </span>
                  <h2>
                    {selected} <small>{asset.name}</small>
                  </h2>
                </div>
                <div className="asset-quote">
                  <strong>{asset.price}</strong>
                  <small>Latest NAV · {asset.time}</small>
                  <span
                    className={changeTone(asset.change)}
                  >
                    {asset.change === "N/A" ? "— No comparison price" : asset.change}
                  </span>
                </div>
              </div>
              <div className="chart-toolbar">
                <span>NAV / Base mainnet</span>
                <div className="chart-controls">
                  <div className="chart-modes">
                    {[
                      ["line", "LINE"],
                      ["area", "AREA"],
                      ["candles", "CANDLE"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        disabled={value === "candles" && !chartCandles.length}
                        className={chartType === value ? "active" : ""}
                        onClick={() => setChartType(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="ranges">
                    {["1W", "1M", "3M", "1Y"].map((item) => (
                      <button
                        key={item}
                        className={range === item ? "active" : ""}
                        onClick={() => setRange(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="chart">
                <div className="chart-y">
                  {(chartType === "candles" ? chartCandles.length >= 2 : Boolean(chartPoints)) && chartYLabels.map((label, index) => <span key={index}>{label}</span>)}
                </div>
                <svg
                  viewBox="0 0 728 90"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={`${chartType} chart for ${selected} over ${range}`}
                >
                  {chartType === "candles" && chartCandles.length >= 2 ? (
                    <CandleChart candles={chartCandles} color={asset.color} range={range} />
                  ) : chartType !== "candles" && chartPoints ? (
                    <>
                      <polyline
                        points={`${chartPoints.split(" ")[0].split(",")[0]},90 ${chartPoints} ${chartPoints.split(" ").at(-1).split(",")[0]},90`}
                        fill={chartType === "area" ? "#edf2ff" : "none"}
                      />
                      <polyline
                        points={chartPoints}
                        fill="none"
                        stroke={asset.color}
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                      />
                    </>
                  ) : null}
                </svg>
                {chartType === "candles" && chartCandles.length < 2 && (
                  <div className="chart-empty" role="status" aria-live="polite">
                    <strong>Collecting daily NAV history</strong>
                    <span>{chartCandles.length} daily candle available</span>
                    <small>At least 2 days of NAV observations are needed to display a candle chart.</small>
                    <small>Switch to Line to view the available snapshots.</small>
                  </div>
                )}
                {chartType !== "candles" && !chartPoints && (
                  <div className="chart-empty" role="status" aria-live="polite">
                    <div className="chart-empty-mark" aria-hidden="true"><i /><i /><i /><i /><i /></div>
                    <strong>{chartHistoryMeta.count < 3 ? "COLLECTING NAV HISTORY" : "HISTORY RANGE UNAVAILABLE"}</strong>
                    <span>{chartHistoryMeta.count} snapshot{chartHistoryMeta.count === 1 ? "" : "s"} in {range}</span>
                    <small>{chartHistoryMeta.count < 3 ? "Need 3 observations before showing a trend" : "No observations in this timeframe"}</small>
                    <small>Last observation · {chartHistoryMeta.latest}</small>
                    <b>Current reference · {asset.price}</b>
                  </div>
                )}
                <div className="chart-x">
                  {chartLabels.map((label) => <span key={label}>{label}</span>)}
                </div>
              </div>
              <div className="chart-foot">
                <span>
                  <i
                    className="legend-dot"
                    style={{ background: asset.color }}
                  />{" "}
                  {chartType === "candles"
                    ? chartCandles.length === 1 ? "1 daily candle / more days needed" : chartCandles.length ? "Daily OHLC / NAV snapshots" : "OHLC / awaiting NAV history"
                    : "B20 NAV reference"}
                </span>
                <span>
                  {chartHistoryMeta.period || "Awaiting NAV history"} · {chartHistoryMeta.count} snapshots · UTC
                </span>
              </div>
            </div>
          </section>
          <section id="lens" className="lens-grid">
            <div className="thesis-copy">
              <div className="kicker">
                <span>03</span> INTELLIGENCE LAYER
              </div>
              <h2>
                What is the
                <br />
                <em>thesis?</em>
              </h2>
              <p>
                Numbers become useful when they are placed in context. This
                brief compresses the signal into something you can challenge.
              </p>
              <div className="method-note">
                <span>Method note</span>
                <b>Data availability · not asset risk</b>
                <small>
                  Model output is illustrative and not financial advice.
                </small>
              </div>
            </div>
            <div className="lens-panel panel">
              <div className="panel-head">
                <span className="kicker">
                  <span>AI brief</span> / {selected}
                </span>
                <span className="model-tag">
                  {`${modelLabel}${matchingInsight?.confidence != null ? ` · CONF ${matchingInsight.confidence}/100` : ""}`}
                </span>
              </div>
              <div className="score-row">
                <div
                  className="score-ring"
                  style={{
                    "--score": `${displayedScore * 3.6}deg`,
                    "--ring": asset.color,
                  }}
                >
                  <strong>{displayedScore}</strong>
                  <small>/100</small>
                </div>
                <div>
                  <span className="muted-label">DATA AVAILABILITY / NOT ASSET RISK</span>
                  <h3>
                    Asset risk <span>not assessed</span>
                  </h3>
                  <p>{riskLoading || !matchingInsight ? (assetNavStatus === "delayed" ? "NAV is delayed; refreshing research context." : assetNavStatus === "unknown" ? "NAV timestamp is unavailable; refreshing research context." : assetNavStatus === "unavailable" ? "NAV is unavailable; refreshing research context." : "Updating research context…") : riskBriefs[selected]}</p>
                </div>
              </div>
              <button
                className="ai-details-toggle"
                type="button"
                aria-expanded={aiDetailsOpen}
                onClick={() => setAiDetailsOpen((open) => !open)}
              >
                <span>{aiDetailsOpen ? "HIDE RESEARCH DETAILS" : "VIEW RESEARCH DETAILS"}</span>
                <b>{aiDetailsOpen ? "−" : "+"}</b>
              </button>
              {aiDetailsOpen && (
                <div className="ai-details">
                  <div className="ai-signals">
                    <div><span>Catalysts</span><b>{(insight.catalysts || []).join(" · ") || "No catalyst data"}</b></div>
                    <div><span>Risks</span><b>{(insight.risks || []).join(" · ") || "No risk data"}</b></div>
                  </div>
                  <small className="ai-source">SOURCE / {insight.source || "Unknown"} · BASIS / {scoreBasis}</small>
                  <div className="case-grid">
                    <div>
                      <span>Bull case</span>
                      <b>{asset.bull}</b>
                    </div>
                    <div>
                      <span>Bear case</span>
                      <b>{asset.bear}</b>
                    </div>
                  </div>
                  <div className="lens-metrics">
                    <div>
                      <span>Momentum</span>
                      <b className={changeTone(asset.change)}>
                        {asset.change === "N/A" ? "Unavailable" : asset.change.startsWith("+") ? "Positive" : "Cooling"}
                      </b>
                    </div>
                    <div>
                      <span>Liquidity</span>
                      <b>{asset.volume}</b>
                    </div>
                    <div>
                      <span>Network</span>
                      <b>8453 NAV / 84532 PAPER</b>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
          <section id="simulate" className="lab-grid">
            <div>
              <div className="kicker">
                <span>04</span> PAPER LAB
              </div>
              <h2>
                Test the
                <br />
                <em>conviction.</em>
              </h2>
              <p>
                Model a position without connecting a wallet or placing an
                order. A safe surface for exploring the thesis.
              </p>
              {portfolio.length > 0 && (
                <div className="portfolio-mini">
                  <span>Local paper portfolio</span>
                  <div className="portfolio-totals"><b>{formatUSD(portfolioMetrics.total)}</b><strong className={Math.abs(portfolioMetrics.pnl) < 0.005 ? "neutral-change" : portfolioMetrics.pnl >= 0 ? "up" : "down"}>{portfolioMetrics.pnl >= 0 ? "+" : ""}{formatUSD(portfolioMetrics.pnl)} P/L</strong></div>
                  {portfolioMetrics.rows.map((item) => (
                    <div key={item.symbol}>
                      <b>{item.symbol}</b>
                      <small>
                        {formatUnits(item.units)} units · {formatUSD(item.currentValue)} value
                      </small>
                      <strong className={item.pnl >= 0 ? "up" : "down"}>
                        {Math.abs(item.pnl) < 0.005 ? "—" : `${item.pnl >= 0 ? "+" : "-"}${formatUSD(Math.abs(item.pnl))}`}
                      </strong>
                      <button className="remove-position" onClick={() => removePosition(item.symbol)} aria-label={`Remove ${item.symbol}`}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="agent-card">
                <div className="agent-card-head">
                  <span>Portfolio agent</span>
                  <b>{portfolioPlan ? portfolioPlan.regime : "READY"}</b>
                </div>
                {portfolioPlan && <div className="agent-meta"><span>Confidence <b>{portfolioPlan.confidence ?? "—"}/100</b></span><span>Universe <b>{Object.keys(marketAssets).length} B20</b></span></div>}
                {portfolioPlan && <p>Allocation uses available data; data availability is not an assessment of asset risk.</p>}
                {portfolioPlan && <p role="status">Source: {portfolioPlan.source || "Unknown"}{portfolioPlan.fallback ? ` · Fallback reason: ${portfolioPlan.fallbackReason || "Unavailable"}` : ""}</p>}
                <p>
                  Analyze the full B20 watchlist and paper holdings to propose target allocations and rebalancing steps.
                </p>
                <button className="agent-button" onClick={runPortfolioAgent} disabled={portfolioAgentLoading}>
                  {portfolioAgentLoading ? "AGENT THINKING…" : "RUN PORTFOLIO AGENT"} <b>↗</b>
                </button>
                {portfolioAgentError && <small className="agent-error">{portfolioAgentError}</small>}
                {portfolioPlan && (
                  <div className="agent-plan">
                    <strong>{portfolioPlan.summary}</strong>
                    {largestMove && <div className="largest-move"><small>Largest change by value</small><strong>{largestMove.symbol} · {largestMove.currentPercent.toFixed(1)}% → {largestMove.targetPercent}%</strong><span>{largestMove.deltaValue < 0 ? "Reduce" : largestMove.deltaValue > 0 ? "Add" : "Hold"} {formatUSD(Math.abs(largestMove.deltaValue))}</span><p>{largestMove.reason}</p></div>}
                    <button className="apply-agent-button" onClick={() => setPortfolioPreview(true)}>Preview target changes ↗</button>
                    <details><summary>All {rebalanceRows.length} allocations</summary>
                    <div className="rebalance-table" aria-label="Paper portfolio rebalance diff">
                      <div className="rebalance-head"><span>Asset</span><span>Current</span><span>Target</span><span>Delta</span><span>Action</span></div>
                      {rebalanceRows.map((item) => (
                        <div key={item.symbol} className={`rebalance-row ${expandedRebalance === item.symbol ? "expanded" : ""}`}>
                          <button className="rebalance-summary" type="button" onClick={() => setExpandedRebalance((current) => current === item.symbol ? null : item.symbol)} aria-expanded={expandedRebalance === item.symbol}>
                            <span><b>{item.symbol}</b><small>{item.reason}</small></span>
                            <strong>{item.currentPercent.toFixed(1)}%</strong>
                            <strong>{item.targetPercent}%</strong>
                            <strong className={item.delta >= 0 ? "up" : "down"}>{item.delta >= 0 ? "+" : ""}{item.delta.toFixed(1)}%</strong>
                            <em className={`rebalance-action ${item.action.toLowerCase()}`}>{item.action}</em>
                          </button>
                          <div className="rebalance-detail">
                            <div><span>Current value</span><strong>{formatUSD(item.currentValue)}</strong></div>
                            <div><span>Target value</span><strong>{formatUSD(item.targetValue)}</strong></div>
                            <div><span>Delta value</span><strong className={Math.abs(item.deltaValue) < 0.005 ? "neutral-change" : item.deltaValue >= 0 ? "up" : "down"}>{Math.abs(item.deltaValue) < 0.005 ? "—" : `${item.deltaValue >= 0 ? "+" : "-"}${formatUSD(Math.abs(item.deltaValue))}`}</strong></div>
                            <div><span>Action</span><strong className={`rebalance-action ${item.action.toLowerCase()}`}>{item.action}</strong></div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <span className="agent-label">Rebalance actions</span>
                    <ul>
                      {portfolioPlan.actions.map((action) => <li key={action}>{action}</li>)}
                    </ul>
                    <small className="agent-note">{portfolioPlan.rebalanceNote} · {portfolioPlan.paperOnly ? "PAPER ONLY" : "REVIEW BEFORE USE"}</small>
                    </details>
                    {portfolioPreview && (
                      <div className="portfolio-preview" aria-label="Paper portfolio target preview">
                        <div className="portfolio-preview-head"><span>Apply target preview</span><b>${Number(budget).toLocaleString()} paper budget</b></div>
                        <p>Review the notional changes below. Your paper book stays unchanged until confirmation.</p>
                        <div className="preview-table">
                          <div className="preview-head"><span>Asset</span><span>Current</span><span>Target</span><span>Delta</span><span>Action</span></div>
                          {previewRows.filter((item) => item.action !== "HOLD" || item.currentValue > 0).map((item) => (
                            <div key={item.symbol}>
                              <b>{item.symbol}</b>
                              <strong>{formatUSD(item.currentValue)}</strong>
                              <strong>{formatUSD(item.targetValue)}</strong>
                              <strong className={Math.abs(item.deltaValue) < 0.005 ? "neutral-change" : item.deltaValue >= 0 ? "up" : "down"}>{Math.abs(item.deltaValue) < 0.005 ? "—" : `${item.deltaValue >= 0 ? "+" : "-"}${formatUSD(Math.abs(item.deltaValue))}`}</strong>
                              <em className={`rebalance-action ${item.action.toLowerCase()}`}>{item.action}</em>
                            </div>
                          ))}
                        </div>
                        <div className="preview-actions"><button className="preview-cancel" onClick={() => setPortfolioPreview(false)}>Cancel</button><button className="preview-confirm" onClick={applyPortfolioPlan}>Confirm apply ↗</button></div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="simulator panel">
              <div className="lab-title">
                <span>Position builder</span>
                <b>{wallet ? "PAPER BASE SEPOLIA / 84532" : "PAPER ONLY / NO WALLET REQUIRED"}</b>
              </div>
              <div className="selected-token">
                <AssetIcon symbol={selected} />
                <div>
                  <b>{selected}</b>
                  <small>
                    {asset.name} / {asset.price}
                  </small>
                </div>
                <span className="token-network">B20 / 8453</span>
                {asset.contractAddress && (
                  <a
                    className="token-contract"
                    href={`https://basescan.org/token/${asset.contractAddress}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    B20 {asset.contractAddress.slice(0, 6)}…{asset.contractAddress.slice(-4)} ↗
                  </a>
                )}
              </div>
              <div className="budget-header">
                <span>Paper budget / USDC</span>
                <output>${Number(budget).toLocaleString()}</output>
              </div>
              <div className="balance-line">
                <span>Available balance</span>
                <b>{usdcBalance === null ? "Connect wallet to read USDC" : `${usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`}</b>
              </div>
              <div className="budget-presets">
                {[25, 50, 100].map((percent) => (
                  <button key={percent} className={budgetMode === `${percent}%` ? "active" : ""} disabled={!usdcBalance} onClick={() => chooseBudget(percent)}>{percent}%</button>
                ))}
                <button className={budgetMode === "manual" ? "active" : ""} onClick={() => setBudgetMode("manual")}>MANUAL</button>
              </div>
              {budgetMode === "manual" ? (
                <label className="manual-budget">
                  ENTER USDC
                  <input type="number" min="0" max={usdcBalance || 10000} step="0.01" value={budget} onChange={(e) => setBudget(Math.min(usdcBalance ?? 10000, Math.max(0, Number(e.target.value) || 0)))} />
                </label>
              ) : null}
              <div className="sim-result">
                <div>
                  <span>Est. units</span>
                  <strong>{formatUnits(allocation)}</strong>
                </div>
                <div>
                  <span>Notional</span>
                  <strong>${Number(budget).toLocaleString()}</strong>
                </div>
              </div>
              <button className="run-button" onClick={runSimulation}>
                {isSimulating ? "CALCULATING…" : "RUN PAPER TRADE"} <b>↗</b>
              </button>
              <WalletConnectButton className="wallet-inline" />
              <button className="chain-button" onClick={proveOnchain}>
                {isSending ? "WAITING FOR WALLET…" : "RECORD THESIS ONCHAIN"}{" "}
                <b>↗</b>
              </button>
              {txHash && (
                <a
                  className="tx-link"
                  href={`https://sepolia.basescan.org/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  VIEW CONTRACT TX / {txHash.slice(0, 10)}…{txHash.slice(-8)}
                </a>
              )}
              {notice && <p className="trade-notice">{notice}</p>}
              <p className="sim-note">
                Records a thesis on Base Sepolia (84532). The contract retains its legacy heuristic score; it is not a validated asset-risk rating. Requires testnet gas.
              </p>
            </div>
          </section>
          <section id="thesis-workspace" className="thesis-workspace-section">
            <div className="history-heading">
              <div>
                <div className="kicker"><span>05</span> RESEARCH MEMORY</div>
                <h2>Thesis <em>workspace.</em></h2>
                <p>Turn a one-off signal into a trackable paper thesis. Save the context, conviction, target, and status before the market moves.</p>
              </div>
              <span className="workspace-count">{thesisWorkspace.length} SAVED THESIS</span>
            </div>
            <div className="thesis-workspace-grid">
              <div className="thesis-composer panel">
                <div className="workspace-panel-head"><span>New thesis</span><b>{selected} / {asset.price}</b></div>
                <label>THESIS TITLE
                  <input value={thesisTitle} onChange={(event) => setThesisTitle(event.target.value)} placeholder={`${selected} setup / e.g. momentum continuation`} />
                </label>
                <label>WHAT ARE YOU WATCHING?
                  <textarea value={thesisNote} onChange={(event) => setThesisNote(event.target.value)} placeholder="Write the reason, catalyst, invalidation, or what would change your mind." rows="4" />
                </label>
                <div className="thesis-form-row">
                  <label>CONVICTION
                    <select value={thesisConviction} onChange={(event) => setThesisConviction(event.target.value)}>
                      <option value="1">01 / exploratory</option><option value="2">02 / forming</option><option value="3">03 / measured</option><option value="4">04 / strong</option><option value="5">05 / highest</option>
                    </select>
                  </label>
                  <div className="thesis-context"><span>DATA AVAILABILITY</span><b>{displayedScore}/100 · Risk not assessed</b><small>{modelLabel}</small></div>
                </div>
                <button className="workspace-save" type="button" onClick={saveThesis}>SAVE THESIS TO WORKSPACE <b>↗</b></button>
                <small className="workspace-note">Saved locally in this browser. No order, custody, or financial advice.</small>
              </div>
              <div className="thesis-list-panel panel">
              <div className="workspace-panel-head"><span>Active research</span><b>OUTCOME / STATUS</b></div>
                {thesisWorkspace.length === 0 ? (
                  <div className="workspace-empty"><strong>NO THESIS SAVED</strong><span>Select an asset, write what you believe, and keep the decision auditable.</span></div>
                ) : (
                  <div className="workspace-list">
                    {thesisWorkspace.map((item) => {
                      const outcome = thesisOutcome(item);
                      return <article key={item.id} className="workspace-item">
                        <div className="workspace-item-top"><b>{item.symbol}</b><span className={`workspace-status ${item.status.toLowerCase()}`}>{item.status}</span><time>{new Date(item.createdAt).toLocaleDateString([], { day: "2-digit", month: "short" })}</time></div>
                        <h3>{item.title}</h3>
                        <p>{item.note}</p>
                        <div className="workspace-outcome"><span>OUTCOME SINCE ENTRY</span><strong className={outcome.change === null ? "" : outcome.change >= 0 ? "up" : "down"}>{outcome.change === null ? "NAV PENDING" : `${outcome.change >= 0 ? "+" : ""}${outcome.change.toFixed(2)}%`}</strong><small>{outcome.current === null ? "Awaiting current NAV" : `Entry ${outcome.entry.toFixed(2)} → Now ${outcome.current.toFixed(2)}`}</small></div>
                        <div className="workspace-metrics"><span>RECORDED SCORE <b>{item.score}/100</b></span><span>CONVICTION <b>{item.conviction}/5</b></span><span>TARGET <b>{item.target === null ? "—" : `${item.target}%`}</b></span><span>REVIEWS <b>{item.reviewCount || 0}</b></span></div>
                        <div className="workspace-followup"><div><span>AGENT FOLLOW-UP</span><b>{followUpLoading[item.id] ? "CHECKING MARKET CONTEXT…" : followUps[item.id]?.nextAction || "Waiting for market context"}</b></div>{followUps[item.id] && <><small>{followUps[item.id].reviewWindow} · Confidence {followUps[item.id].confidence}/100</small><div className="followup-triggers">{followUps[item.id].triggers.map((trigger) => <em key={trigger}>{trigger}</em>)}</div></>}<button type="button" onClick={() => runFollowUp(item)}>{followUpLoading[item.id] ? "RUNNING…" : "RUN FOLLOW-UP ↗"}</button></div>
                        <div className="workspace-actions"><button type="button" onClick={() => { pick(item.symbol); document.getElementById("watchlist")?.scrollIntoView({ behavior: "smooth" }); }}>OPEN ASSET ↗</button><button type="button" onClick={() => reviewThesis(item.id)}>REVIEW OUTCOME</button><button type="button" onClick={() => shareThesis(item)}>SHARE ↗</button>{item.id?.startsWith("th_") && !editTokenFor(item.id) ? <button type="button" onClick={() => duplicateThesis(item)}>DUPLICATE AS NEW ↗</button> : null}<select value={item.status} onChange={(event) => updateThesisStatus(item.id, event.target.value)} aria-label={`Update ${item.symbol} thesis status`}><option value="OPEN">Open</option><option value="MONITORING">Monitoring</option><option value="INVALIDATED">Invalidated</option><option value="CLOSED">Closed</option></select></div>
                        {shareLink?.id === item.id && <p role="status">Share link ready: <a href={shareLink.url} target="_blank" rel="noreferrer">Open shared thesis ↗</a> <input aria-label="Shareable thesis link" value={shareLink.url} readOnly onFocus={(event) => event.target.select()} /></p>}
                      </article>;
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>
          <section id="thesis-activity" className="thesis-activity-section">
            <div className="history-heading">
              <div>
                <div className="kicker"><span>06</span> DECISION CONTROL</div>
                <h2>Thesis <em>activity.</em></h2>
                <p>See what changed, what needs attention, and why the agent is asking for a review.</p>
              </div>
              <span className="workspace-count">{thesisAlerts.length} ACTIVE ALERTS</span>
            </div>
            <div className="thesis-activity-grid">
              <div className="alert-center panel">
                <div className="workspace-panel-head"><span>Alert center</span><b>{thesisAlerts.length ? "ACTION REQUIRED" : "ALL CLEAR"}</b></div>
                {thesisAlerts.length === 0 ? <div className="workspace-empty"><strong>NO ACTIVE ALERTS</strong><span>Follow-ups and outcome reviews will appear here when a thesis needs attention.</span></div> : <div className="alert-list">{thesisAlerts.map((alert) => <div key={alert.id} className={`alert-row ${alert.severity.toLowerCase()}`}><div><span>{alert.severity} / {alert.symbol}</span><b>{alert.title}</b><small>{alert.detail}</small></div><button type="button" onClick={() => dismissAlert(alert.id)}>ACKNOWLEDGE</button></div>)}</div>}
              </div>
              <div className="timeline-panel panel">
                <div className="workspace-panel-head"><span>Thesis timeline</span><b>{timelineItems.length} EVENTS</b></div>
                {timelineItems.length === 0 ? <div className="workspace-empty"><strong>NO EVENTS YET</strong><span>Save a thesis to start an auditable decision timeline.</span></div> : <div className="timeline-list">{timelineItems.map((event) => <div key={event.id} className="timeline-row"><i /><div><span>{event.symbol} · {event.type}</span><b>{event.detail}</b><small>{new Date(event.createdAt).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div></div>)}</div>}
              </div>
            </div>
          </section>
          <section id="history" className="history-section">
            <div className="history-heading">
              <div>
                <div className="kicker">
                  <span>07</span> ONCHAIN RECORD
                </div>
                <h2>
                  Thesis <em>history.</em>
                </h2>
                <p>
                  Research proofs read through the StockLens history proxy on
                  Base Sepolia (84532). Recorded contract scores use a legacy heuristic and are not validated asset-risk ratings. B20 NAV remains on Base mainnet (8453).
                </p>
              </div>
              <a
                className="explorer-link"
                href={`https://sepolia.basescan.org/address/${REGISTRY_ADDRESS}#readContract`}
                target="_blank"
                rel="noreferrer"
              >
                OPEN CONTRACT ↗
              </a>
            </div>
            <div className="history-panel panel">
              {historyLoading ? (
                <p className="history-empty">READING BASE SEPOLIA…</p>
              ) : historyError ? (
                <p className="history-empty">{historyError}</p>
              ) : thesisHistory.length === 0 ? (
                <p className="history-empty">No thesis recorded yet.</p>
              ) : (
                <div className="history-list">
                  {thesisHistory.map((item) => (
                    <a
                      key={item.id}
                      className="history-row"
                      href={`https://sepolia.basescan.org/address/${REGISTRY_ADDRESS}#events`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="history-id">#{item.id}</span>
                      <span className="history-symbol">
                        <b>{item.symbol}</b>
                        <small>
                          {new Date(item.timestamp).toLocaleString("en-US", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </small>
                      </span>
                      <span>
                        <small>PRICE</small>
                        <b>${item.price.toFixed(2)}</b>
                      </span>
                      <span>
                        <small>CHANGE</small>
                        <b className={item.change === null || item.change === 0 ? "neutral-change" : item.change > 0 ? "up" : "down"}>
                          {displayProofChange(item.change)}
                        </b>
                      </span>
                      <span>
                        <small>RECORDED SCORE</small>
                        <b>{item.score}/100</b>
                      </span>
                      <span className="history-wallet">
                        <small>RESEARCHER</small>
                        <b>
                          {item.researcher.slice(0, 6)}…
                          {item.researcher.slice(-4)}
                        </b>
                      </span>
                      <span className="verified-badge">✓ VERIFIED ONCHAIN</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>
        <nav className="mobile-nav" aria-label="Mobile sections">
          <a href="#watchlist"><b>Markets</b><small>Watchlist</small></a>
          <a href="#lens"><b>AI</b><small>Research brief</small></a>
          <a href="#simulate"><b>Portfolio</b><small>Paper lab</small></a>
        </nav>
        <footer>
          <span>STOCKLENS / ONCHAIN RESEARCH TERMINAL</span>
          <span>BASE BUILD SPRINT / V0.2</span>
        </footer>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
