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

const wagmiConfig = getDefaultConfig({
  appName: "StockLens",
  appDescription: "Onchain research terminal for tokenized stock experiments.",
  appUrl: "https://stocklens-black-six.vercel.app",
  appIcon: "https://stocklens-black-six.vercel.app/favicon.svg",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "YOUR_PROJECT_ID",
  chains: [baseSepolia],
  ssr: false,
});
const queryClient = new QueryClient();

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
  "function getThesis(uint256 thesisId) view returns (address researcher,string symbol,uint256 priceCents,int256 changeBps,uint8 riskScore,uint256 timestamp)",
  "event ThesisRecorded(uint256 indexed thesisId,address indexed researcher,string symbol,uint256 priceCents,int256 changeBps,uint8 riskScore)",
];

function chartPointsForRange(points, range) {
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

function candlesForRange(candles = [], range) {
  const limits = { "1W": 7, "1M": 30, "3M": 90, "1Y": 260 };
  return candles.slice(-(limits[range] || 30));
}

function CandleChart({ candles, color }) {
  const low = Math.min(...candles.map((candle) => candle.low));
  const high = Math.max(...candles.map((candle) => candle.high));
  const scale = Math.max(high - low, 0.01);
  const y = (value) => 84 - ((value - low) / scale) * 74;
  const step = 720 / Math.max(candles.length - 1, 1);
  return (
    <g>
      {candles.map((candle, index) => {
        const x = 4 + index * step;
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

function StockLensLogo({ compact = false }) {
  return (
    <span
      className={`brand-lockup ${compact ? "compact" : ""}`}
      aria-label="StockLens"
    >
      <svg className="brand-logo" viewBox="0 0 34 34" aria-hidden="true">
        <circle
          cx="17"
          cy="17"
          r="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M8 20.5c3.2-6.8 8.2-10.2 15-10.2 1.5 0 2.8.2 4 .6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M10.2 24.3c3.8 1.8 8.3 1.9 12.3.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity=".55"
        />
        <circle cx="23.7" cy="10.7" r="2.2" fill="currentColor" />
      </svg>
      <span className="brand-wordmark">
        <b>STOCK</b>LENS
      </span>
    </span>
  );
}

function WalletConnectButton({ className = "wallet-button" }) {
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
  const [complianceAccepted, setComplianceAccepted] = useState(() => {
    try {
      return window.localStorage.getItem("stocklens-compliance-v1") === "accepted";
    } catch {
      return false;
    }
  });
  const [complianceCountry, setComplianceCountry] = useState("");
  const [complianceConfirmed, setComplianceConfirmed] = useState(false);
  const [complianceError, setComplianceError] = useState("");
  const [selected, setSelected] = useState("AAPLc");
  const [range, setRange] = useState("1M");
  const [chartType, setChartType] = useState("line");
  const [budget, setBudget] = useState(1000);
  const [budgetMode, setBudgetMode] = useState("manual");
  const [usdcBalance, setUsdcBalance] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [wallet, setWallet] = useState("");
  const [portfolio, setPortfolio] = useState([]);
  const [notice, setNotice] = useState("");
  const [txHash, setTxHash] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [marketAssets, setMarketAssets] = useState(assets);
  const [riskBriefs, setRiskBriefs] = useState(briefs);
  const [riskInsights, setRiskInsights] = useState({});
  const [dataMode, setDataMode] = useState("DEMO DATA");
  const [riskLoading, setRiskLoading] = useState(false);
  const [portfolioPlan, setPortfolioPlan] = useState(null);
  const [portfolioAgentLoading, setPortfolioAgentLoading] = useState(false);
  const [portfolioAgentError, setPortfolioAgentError] = useState("");
  const [thesisHistory, setThesisHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const { address } = useAccount();
  const asset = marketAssets[selected];
  const chartPoints = useMemo(
    () => chartPointsForRange(asset.points, range),
    [asset.points, range],
  );
  const chartCandles = useMemo(
    () => candlesForRange(asset.candles, range),
    [asset.candles, range],
  );
  const insight = riskInsights[selected] || {
    confidence: 68,
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
  const allocation = useMemo(
    () =>
      Math.round((budget / Number(asset.price.replace(/[$,]/g, ""))) * 100) /
      100,
    [asset, budget],
  );

  useEffect(() => {
    setWallet(address || "");
    if (address) {
      setNotice("Wallet connected on Base Sepolia. Ready for an onchain proof.");
    }
  }, [address]);

  useEffect(() => {
    fetch("/api/market")
      .then((result) =>
        result.ok
          ? result.json()
          : Promise.reject(new Error("market_unavailable")),
      )
      .then((payload) => {
        if (Object.keys(payload.data || {}).length) {
          setMarketAssets((current) => ({ ...current, ...payload.data }));
          setDataMode("B20 MAINNET");
        }
      })
      .catch(() => setDataMode("DEMO DATA"));
  }, []);

  useEffect(() => {
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
    };
    fetch("/api/risk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asset: aiAsset }),
    })
      .then((result) =>
        result.ok
          ? result.json()
          : Promise.reject(new Error("risk_unavailable")),
      )
      .then((result) => {
        if (result.summary) {
          const enrichedSummary = [
            result.summary,
            result.catalysts?.length
              ? `Catalysts: ${result.catalysts.join(" · ")}`
              : "",
            result.risks?.length ? `Risks: ${result.risks.join(" · ")}` : "",
          ]
            .filter(Boolean)
            .join(" ");
          setRiskBriefs((current) => ({
            ...current,
            [selected]: enrichedSummary,
          }));
          setRiskInsights((current) => ({ ...current, [selected]: result }));
        }
      })
      .catch(() => {})
      .finally(() => setRiskLoading(false));
  }, [selected, asset]);

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
        const provider = new JsonRpcProvider("https://sepolia.base.org");
        const registry = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
        const count = Number(await registry.thesisCount());
        const start = Math.max(0, count - 8);
        const rows = await Promise.all(
          Array.from({ length: count - start }, (_, index) =>
            registry.getThesis(start + index),
          ),
        );
        if (active)
          setThesisHistory(
            rows
              .map((row, index) => ({
                id: start + index,
                researcher: row.researcher,
                symbol: row.symbol,
                price: Number(row.priceCents) / 100,
                change: Number(row.changeBps) / 100,
                score: Number(row.riskScore),
                timestamp: Number(row.timestamp) * 1000,
              }))
              .reverse(),
          );
      } catch {
        if (active)
          setHistoryError("History belum bisa dimuat dari Base Sepolia.");
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
    if (!window.ethereum || !wallet || wallet === "preview") {
      setNotice("Connect a browser wallet first to write on Base Sepolia.");
      return;
    }
    setIsSending(true);
    setNotice("Confirm the Base Sepolia proof transaction in your wallet…");
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const registry = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, signer);
      const priceValue = Number(asset.price.replace(/[$,]/g, ""));
      if (!Number.isFinite(priceValue)) {
        setNotice("B20 NAV belum tersedia. Tunggu reference price sebelum merekam thesis.");
        return;
      }
      const priceCents = Math.round(priceValue * 100);
      const changeValue = Number.parseFloat(asset.change.replace("%", ""));
      const changeBps = Number.isFinite(changeValue) ? Math.round(changeValue * 100) : 0;
      const transaction = await registry.recordThesis(
        selected,
        priceCents,
        changeBps,
        asset.score,
      );
      setTxHash(transaction.hash);
      setNotice(
        "Contract call submitted. Waiting for Base Sepolia confirmation…",
      );
      await transaction.wait();
      setNotice("Thesis recorded in StockLensRegistry on Base Sepolia.");
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
    setIsSimulating(true);
    setPortfolio((items) => [
      { symbol: selected, units: allocation, notional: Number(budget) },
      ...items.filter((item) => item.symbol !== selected),
    ]);
    setNotice(
      `${selected} paper position added. ${insight.portfolioRationale}`,
    );
    window.setTimeout(() => setIsSimulating(false), 850);
  }

  async function runPortfolioAgent() {
    setPortfolioAgentLoading(true);
    setPortfolioAgentError("");
    try {
      const universe = Object.entries(marketAssets).map(([symbol, item]) => ({
        symbol,
        name: item.name,
        risk: item.risk,
        score: item.score,
        price: item.price,
        change: item.change,
        volume: item.volume,
        contractAddress: item.contractAddress,
      }));
      const result = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ universe, holdings: portfolio }),
      }).then((response) =>
        response.ok ? response.json() : response.json().then((body) => Promise.reject(new Error(body.error || "portfolio_agent_unavailable"))),
      );
      setPortfolioPlan(result);
      setNotice("Portfolio Agent selesai. Review target allocation sebelum paper trade.");
    } catch (error) {
      setPortfolioAgentError(error?.message || "Portfolio Agent belum tersedia.");
    } finally {
      setPortfolioAgentLoading(false);
    }
  }

  const pick = (symbol) => {
    setSelected(symbol);
    setNotice(`${symbol} selected. Review the thesis before simulating.`);
  };

  function acceptCompliance(event) {
    event.preventDefault();
    if (!complianceCountry) {
      setComplianceError("Pilih negara tempat kamu berada.");
      return;
    }
    if (complianceCountry === "US") {
      setComplianceError("StockLens belum tersedia untuk pengguna atau warga Amerika Serikat.");
      return;
    }
    if (!complianceConfirmed) {
      setComplianceError("Centang konfirmasi paper-only untuk masuk.");
      return;
    }
    try {
      window.localStorage.setItem("stocklens-compliance-v1", "accepted");
    } catch {
      // The gate still applies for this session when storage is unavailable.
    }
    setComplianceAccepted(true);
  }

  return (
    <div className="terminal-app">
      {!complianceAccepted && (
        <div className="compliance-backdrop" role="dialog" aria-modal="true" aria-labelledby="compliance-title">
          <form className="compliance-card" onSubmit={acceptCompliance}>
            <div className="compliance-kicker">STOCKLENS / ACCESS CHECK</div>
            <h2 id="compliance-title">Research mode only.</h2>
            <p>
              StockLens adalah terminal riset untuk tokenized-stock reference data di Base.
              Semua posisi di sini bersifat simulasi dan tidak mengeksekusi order atau custody aset.
            </p>
            <label className="compliance-label" htmlFor="compliance-country">YOUR LOCATION</label>
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
            <button className="compliance-submit" type="submit">ENTER RESEARCH TERMINAL <b>↗</b></button>
            <small className="compliance-note">Access is blocked for US users/persons. Do not connect funds or place live trades.</small>
          </form>
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
            <span className="nav-emoji" aria-hidden="true">
              📈
            </span>
            Markets
          </a>
          <a href="#lens">
            <span className="nav-emoji" aria-hidden="true">
              🧠
            </span>
            Risk lens
          </a>
          <a href="#simulate">Paper lab</a>
        </nav>
        <div className="side-bottom">
          <div className="base-chip">
            <i /> BASE <span>8453</span>
          </div>
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
            RESEARCH / <b>MARKET OVERVIEW</b>
          </div>
          <div className="top-actions">
            <span className="paper-badge">PAPER ONLY</span>
            <span className="status">
              <i /> {wallet ? "Wallet ready" : dataMode}
            </span>
            <WalletConnectButton />
          </div>
        </header>
        <main>
          <section id="overview" className="overview-section">
            <div className="overview-heading">
              <div>
                <div className="kicker">
                  <span>01</span> DAILY BRIEFING / 24 NOV 2026
                </div>
                <h1>
                  Research the
                  <br />
                  <em>signal.</em>
                </h1>
                <p>
                  A focused terminal for understanding tokenized stock activity
                  on Base. Read the thesis before you make the move.
                </p>
              </div>
              <div className="market-state">
                <span>MARKET STATE</span>
                <strong>Constructive</strong>
                <small>Risk appetite is holding</small>
                <div className="state-line">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
            <div className="tape">
              <span>MARKET TAPE</span>
              {Object.entries(marketAssets).map(([symbol, item]) => (
                <button key={symbol} onClick={() => pick(symbol)}>
                  <b>{symbol}</b>
                  <strong>{item.price}</strong>
                  <small
                    className={item.change.startsWith("+") ? "up" : "down"}
                  >
                    {item.change}
                  </small>
                </button>
              ))}
              <span className="tape-end">ILLUSTRATIVE DATA ↗</span>
            </div>
          </section>
          <section id="watchlist" className="research-grid">
            <div className="watchlist-panel panel">
              <div className="panel-head">
                <div>
                  <span className="kicker">
                    <span>02</span> WATCHLIST
                  </span>
                  <h2>
                    Market <em>map</em>
                  </h2>
                </div>
                <span className="count">4 ASSETS</span>
              </div>
              <div className="asset-list">
                {Object.entries(marketAssets).map(([symbol, item]) => (
                  <button
                    key={symbol}
                    className={`asset-row ${symbol === selected ? "active" : ""}`}
                    onClick={() => pick(symbol)}
                  >
                    <span className={`asset-icon ${item.tone}`}>
                      {symbol.slice(0, 1)}
                    </span>
                    <span className="asset-name">
                      <b>{symbol}</b>
                      <small>
                        {item.name} / {item.sector}
                      </small>
                    </span>
                    <span className="asset-price">
                      <b>{item.price}</b>
                      <small
                        className={item.change.startsWith("+") ? "up" : "down"}
                      >
                        {item.change}
                      </small>
                    </span>
                    <span className="row-arrow">↗</span>
                  </button>
                ))}
              </div>
              <div className="panel-foot">
                <span>Curated universe</span>
                <span>Updated {asset.time}</span>
              </div>
            </div>
            <div className="chart-panel panel">
              <div className="panel-head chart-head">
                <div>
                  <span className="kicker">
                    <span>SELECTED ASSET</span> / {asset.sector.toUpperCase()}
                  </span>
                  <h2>
                    {selected} <small>{asset.name}</small>
                  </h2>
                </div>
                <div className="asset-quote">
                  <strong>{asset.price}</strong>
                  <span
                    className={asset.change.startsWith("+") ? "up" : "down"}
                  >
                    {asset.change}
                  </span>
                </div>
              </div>
              <div className="chart-toolbar">
                <span>NAV / BASE MAINNET</span>
                <div className="chart-controls">
                  <div className="chart-modes">
                    {[
                      ["line", "LINE"],
                      ["area", "AREA"],
                      ["candles", "CANDLE"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
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
                  <span>200</span>
                  <span>150</span>
                  <span>100</span>
                  <span>50</span>
                </div>
                <svg
                  viewBox="0 0 728 90"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={`${chartType} chart for ${selected} over ${range}`}
                >
                  <defs>
                    <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
                      <stop
                        offset="0"
                        stopColor={asset.color}
                        stopOpacity=".22"
                      />
                      <stop
                        offset="1"
                        stopColor={asset.color}
                        stopOpacity="0"
                      />
                    </linearGradient>
                  </defs>
                  {chartType === "candles" && chartCandles.length ? (
                    <CandleChart candles={chartCandles} color={asset.color} />
                  ) : (
                    <>
                      <polyline
                        points={`4,90 ${chartPoints} 724,90`}
                        fill={chartType === "area" ? "url(#fill)" : "none"}
                      />
                      <polyline
                        points={chartPoints}
                        fill="none"
                        stroke={asset.color}
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                      />
                    </>
                  )}
                </svg>
                <div className="chart-x">
                  <span>01 {range}</span>
                  <span>15 {range}</span>
                  <span>30 {range}</span>
                </div>
              </div>
              <div className="chart-foot">
                <span>
                  <i
                    className="legend-dot"
                    style={{ background: asset.color }}
                  />{" "}
                  {chartType === "candles"
                    ? "OHLC / live candles"
                    : "B20 NAV reference"}
                </span>
                <span>
                  Volume {asset.volume} · {asset.time}
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
                <span>METHOD NOTE</span>
                <b>Momentum + liquidity + volatility</b>
                <small>
                  Model output is illustrative and not financial advice.
                </small>
              </div>
            </div>
            <div className="lens-panel panel">
              <div className="panel-head">
                <span className="kicker">
                  <span>AI BRIEF</span> / {selected}
                </span>
                <span className="model-tag">
                  {riskLoading ? "MODEL / THINKING…" : "MODEL / V I K E Y"}
                </span>
              </div>
              <div className="score-row">
                <div
                  className="score-ring"
                  style={{
                    "--score": `${asset.score * 3.6}deg`,
                    "--ring": asset.color,
                  }}
                >
                  <strong>{asset.score}</strong>
                  <small>/100</small>
                </div>
                <div>
                  <span className="muted-label">SIGNAL QUALITY</span>
                  <h3>
                    {asset.risk} <span>risk</span>
                  </h3>
                  <p>{riskBriefs[selected]}</p>
                </div>
              </div>
              <div className="case-grid">
                <div>
                  <span>BULL CASE</span>
                  <b>{asset.bull}</b>
                </div>
                <div>
                  <span>BEAR CASE</span>
                  <b>{asset.bear}</b>
                </div>
              </div>
              <div className="lens-metrics">
                <div>
                  <span>Momentum</span>
                  <b className={asset.change.startsWith("+") ? "up" : "down"}>
                    {asset.change.startsWith("+") ? "Positive" : "Cooling"}
                  </b>
                </div>
                <div>
                  <span>Liquidity</span>
                  <b>{asset.volume}</b>
                </div>
                <div>
                  <span>Network</span>
                  <b>Base Sepolia</b>
                </div>
              </div>
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
                  <span>LOCAL PAPER PORTFOLIO</span>
                  {portfolio.map((item) => (
                    <div key={item.symbol}>
                      <b>{item.symbol}</b>
                      <small>
                        {item.units} units · ${item.notional.toLocaleString()}{" "}
                        notional
                      </small>
                      <strong className="up">
                        +{marketAssets[item.symbol].change}
                      </strong>
                    </div>
                  ))}
                </div>
              )}
              <div className="agent-card">
                <div className="agent-card-head">
                  <span>PORTFOLIO AGENT</span>
                  <b>{portfolioPlan ? portfolioPlan.regime : "READY"}</b>
                </div>
                <p>
                  Baca seluruh B20 watchlist dan paper holdings untuk menyusun target allocation serta langkah rebalance.
                </p>
                <button className="agent-button" onClick={runPortfolioAgent} disabled={portfolioAgentLoading}>
                  {portfolioAgentLoading ? "AGENT THINKING…" : "RUN PORTFOLIO AGENT"} <b>↗</b>
                </button>
                {portfolioAgentError && <small className="agent-error">{portfolioAgentError}</small>}
                {portfolioPlan && (
                  <div className="agent-plan">
                    <strong>{portfolioPlan.summary}</strong>
                    <div className="allocation-list">
                      {portfolioPlan.allocations.map((item) => (
                        <div key={item.symbol}>
                          <span><b>{item.symbol}</b><small>{item.reason}</small></span>
                          <strong>{item.targetPercent}%</strong>
                        </div>
                      ))}
                    </div>
                    <span className="agent-label">REBALANCE ACTIONS</span>
                    <ul>
                      {portfolioPlan.actions.map((action) => <li key={action}>{action}</li>)}
                    </ul>
                    <small className="agent-note">{portfolioPlan.rebalanceNote} · {portfolioPlan.paperOnly ? "PAPER ONLY" : "REVIEW BEFORE USE"}</small>
                  </div>
                )}
              </div>
            </div>
            <div className="simulator panel">
              <div className="lab-title">
                <span>POSITION BUILDER</span>
                <b>{wallet ? "BASE SEPOLIA / READY" : "NO WALLET REQUIRED"}</b>
              </div>
              <div className="selected-token">
                <span className={`asset-icon ${asset.tone}`}>
                  {selected.slice(0, 1)}
                </span>
                <div>
                  <b>{selected}</b>
                  <small>
                    {asset.name} / {asset.price}
                  </small>
                </div>
                <span className="token-network">BASE</span>
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
                <span>PAPER BUDGET / USDC</span>
                <output>${Number(budget).toLocaleString()}</output>
              </div>
              <div className="balance-line">
                <span>AVAILABLE BALANCE</span>
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
                  <span>EST. UNITS</span>
                  <strong>{allocation}</strong>
                </div>
                <div>
                  <span>NOTIONAL</span>
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
                Records the thesis in StockLensRegistry on Base Sepolia.
                Requires testnet gas.
              </p>
            </div>
          </section>
          <section id="history" className="history-section">
            <div className="history-heading">
              <div>
                <div className="kicker">
                  <span>05</span> ONCHAIN RECORD
                </div>
                <h2>
                  Thesis <em>history.</em>
                </h2>
                <p>
                  Research proofs read directly from StockLensRegistry on Base
                  Sepolia.
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
                        <b className={item.change >= 0 ? "up" : "down"}>
                          {item.change >= 0 ? "+" : ""}
                          {item.change.toFixed(2)}%
                        </b>
                      </span>
                      <span>
                        <small>RISK</small>
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
