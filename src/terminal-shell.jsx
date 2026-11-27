import { useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { NavChart, PaperGrain, Ridgeline, Spark } from "./visual.jsx";

const easeOut = [0.22, 1, 0.36, 1];
const list = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const flowTiming = { duration: 750, easing: "cubic-bezier(.22,1,.36,1)" };
const PAL = ["#6652b3", "#8b7ad0", "#b3a7e6", "#d3cbf3", "#e9e4fa", "#c8c8bf", "#a9a9a0"];

function rise(distance) {
  return {
    hidden: { opacity: 0, y: distance },
    show: (index = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.55, ease: easeOut, delay: Number(index) * 0.06 } }),
  };
}

function shortAddr(value) {
  const text = String(value || "");
  return text.length < 12 ? text || "—" : `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function clampNoise(value, epsilon) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) < epsilon) return 0;
  return number;
}

function toneOf(change) {
  const text = String(change || "").trim();
  if (text.startsWith("+")) return "up";
  if (text.startsWith("-")) return "down";
  return "flat";
}

function highlightLead(text) {
  const source = String(text || "");
  const match = source.match(/[+-]?\d+(?:\.\d+)?%/);
  if (!match) return source;
  const index = source.indexOf(match[0]);
  return <>{source.slice(0, index)}<mark>{match[0]}</mark>{source.slice(index + match[0].length)}</>;
}

function axisDates(history, range) {
  const days = { "1W": 7, "1M": 30, "3M": 90, "1Y": 365 };
  const cutoff = Date.now() - (days[range] || 30) * 864e5;
  const rows = (Array.isArray(history) ? history : [])
    .filter((row) => Number(row.timestamp) >= cutoff && Number(row.price) > 0)
    .sort((left, right) => Number(left.timestamp) - Number(right.timestamp));
  if (rows.length < 2) return ["Start", "Mid", "Now"];
  return [rows[0], rows[Math.floor(rows.length / 2)], rows.at(-1)].map((row) =>
    new Date(Number(row.timestamp)).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  );
}

function freshCopy(status) {
  return { current: "NAV fresh", delayed: "NAV delayed", unknown: "NAV time unknown", unavailable: "NAV unavailable" }[status] || "NAV";
}

export function TerminalShell({ ui }) {
  return (
    <MotionConfig reducedMotion="user">
      <ShellInner ui={ui} />
    </MotionConfig>
  );
}

function BrandMark({ size }) {
  return <span className="sl-brand-icon" style={{ width: size, height: size }} aria-hidden="true">
    <img className="brand-logo brand-logo-light" src="/brand-icon-light.svg?v=animated1" alt="" />
    <img className="brand-logo brand-logo-dark" src="/brand-icon-dark.svg?v=animated1" alt="" />
  </span>;
}

function SidebarIcon({ name }) {
  const paths = {
    markets: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    brief: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5M7 10h6M10 7v6" /></>,
    agent: <><rect x="4" y="7" width="16" height="13" rx="3" /><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8" /></>,
    paper: <><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /></>,
    theses: <><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h4" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Sidebar({ active, go }) {
  const links = [["markets", "Markets"], ["brief", "Research"], ["agent", "Portfolio Agent"], ["paper", "Paper lab"], ["theses", "Theses"]];
  return <aside className="sl-sidebar" aria-label="StockLens navigation">
    <button className="sl-sidebar-brand" type="button" onClick={() => go("markets")} aria-label="StockLens home">
      <img src="/brand-icon-dark.svg?v=animated1" alt="" /><span>StockLens</span>
    </button>
    <div className="sl-sidebar-caption">RESEARCH WORKSPACE</div>
    <nav className="sl-sidebar-nav" aria-label="Sections">
      {links.map(([key, label]) => <button key={key} type="button" className={active === key ? "on" : ""} aria-label={label} aria-current={active === key ? "page" : undefined} title={label} onClick={() => go(key, key === "brief" ? "lens" : undefined)}><SidebarIcon name={key} /><span>{label}</span></button>)}
    </nav>
    <div className="sl-sidebar-footer"><span>BASE MAINNET · NAV</span><span>BASE SEPOLIA · PROOFS</span><small>Paper research only</small></div>
  </aside>;
}

function ShellInner({ ui }) {
  const reduce = useReducedMotion();
  const [distance, setDistance] = useState(10);
  const [section, setSection] = useState("markets");
  const [chartIntro, setChartIntro] = useState(true);
  const [navFlash, setNavFlash] = useState(false);
  const item = rise(distance);
  const active = ui.screen === "markets" ? (section === "brief" ? "brief" : "markets") : ui.screen;
  const Icon = ui.AssetIcon;
  const Wallet = ui.WalletButton;

  useEffect(() => {
    const timer = window.setTimeout(() => setChartIntro(false), 1300);
    return () => window.clearTimeout(timer);
  }, []);

  const skipFlash = useRef(true);
  useEffect(() => {
    if (skipFlash.current) {
      skipFlash.current = false;
      return undefined;
    }
    setNavFlash(true);
    const timer = window.setTimeout(() => setNavFlash(false), 1200);
    return () => window.clearTimeout(timer);
  }, [ui.asset?.price, ui.asset?.navUpdatedAt]);

  function go(next, anchor) {
    setDistance(6);
    setSection(next);
    ui.setScreen(next === "brief" ? "markets" : next);
    const behavior = reduce ? "auto" : "smooth";
    window.setTimeout(() => {
      if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior, block: "start" });
      else window.scrollTo({ top: 0, behavior });
    }, 40);
  }

  return (
    <div className="terminal-app sl-app">
      <Ridgeline />
      <PaperGrain />
      {!ui.complianceAccepted && <Gate ui={ui} item={item} />}
      {ui.complianceAccepted && <>
        <Sidebar active={active} go={go} />
        <div className="main-column" id="top">
          <header className="topbar">
            <a className="sl-brand" href="#top" onClick={(event) => { event.preventDefault(); go("markets"); }}>
              <BrandMark size={30} />
              StockLens
            </a>
            <div className="top-actions">
              <span className="paper-badge">Paper only</span>
              <span className="base-chip d-only"><i /> Base Sepolia · 84532</span>
              <button className="theme-toggle" type="button" onClick={() => ui.setTheme(ui.theme === "dark" ? "light" : "dark")} aria-label={`Switch to ${ui.theme === "dark" ? "light" : "dark"} mode`}>
                {ui.theme === "dark" ? "Light" : "Dark"}
              </button>
              <Wallet className="wallet-button" />
            </div>
          </header>
          <main>
            <motion.div key={ui.screen} initial="hidden" animate="show" variants={list}>
              {ui.screen === "markets" && <Dashboard ui={ui} item={item} go={go} chartIntro={chartIntro} navFlash={navFlash} Icon={Icon} />}
              {ui.screen === "agent" && <AgentScreen ui={ui} item={item} go={go} Icon={Icon} />}
              {ui.screen === "paper" && <PaperScreen ui={ui} item={item} Icon={Icon} Wallet={Wallet} />}
              {ui.screen === "theses" && <ThesisScreen ui={ui} item={item} Icon={Icon} />}
            </motion.div>
          </main>
          <BottomNav active={active} go={go} />
        </div>
      </>}
    </div>
  );
}

function Gate({ ui, item }) {
  return (
    <div className="compliance-backdrop sl-gate" role="dialog" aria-modal="true" aria-labelledby="compliance-title">
      <div className="welcome-layout gate">
        <section className="gate-l">
          <div>
            <motion.div className="sl-brand" initial="hidden" animate="show" variants={item}><BrandMark size={32} /> StockLens <small>/ research terminal</small></motion.div>
            <motion.h1 initial="hidden" animate="show" variants={item} id="welcome-title">From market data<br /><span>to a testable thesis.</span></motion.h1>
            <motion.p className="promise" initial="hidden" animate="show" variants={item}>Explore B20 reference NAVs, challenge an AI research brief, and build a paper portfolio. Record a thesis on Base Sepolia if you choose.</motion.p>
            <motion.div className="steps" initial="hidden" animate="show" variants={item} aria-label="How StockLens works">
              <div className="step"><em>01</em><b>Research</b><span>Explore NAV and AI context</span></div>
              <div className="step"><em>02</em><b>Simulate</b><span>Test a paper allocation</span></div>
              <div className="step"><em>03</em><b>Verify</b><span>Optionally record a thesis</span></div>
            </motion.div>
          </div>
          <motion.div className="gate-pills" initial="hidden" animate="show" variants={item}>
            <span className="base-chip">Base mainnet · NAV data</span>
            <span className="base-chip">Base Sepolia · optional proof</span>
          </motion.div>
        </section>
        <div className="gate-r">
          <motion.form className="card gcard" initial="hidden" animate="show" variants={item} onSubmit={ui.acceptCompliance}>
            <span className="paper-badge">Before you enter</span>
            <h2 id="compliance-title">Research mode only.</h2>
            <p>StockLens is a research terminal for tokenized stock reference data on Base. All positions are simulated; the app does not execute orders or custody assets.</p>
            <label className="compliance-label" htmlFor="compliance-country">Your location</label>
            <select id="compliance-country" value={ui.complianceCountry} onChange={(event) => { ui.setComplianceCountry(event.target.value); ui.setComplianceError(""); }}>
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
              <input type="checkbox" checked={ui.complianceConfirmed} onChange={(event) => { ui.setComplianceConfirmed(event.target.checked); ui.setComplianceError(""); }} />
              <span>I understand this is paper-only research, not financial advice, and I will not use it where restricted.</span>
            </label>
            {ui.complianceError && <p className="compliance-error">{ui.complianceError}</p>}
            <button className="btn base lg" type="submit" style={{ width: "100%", marginTop: 22 }}>Enter research terminal <span>→</span></button>
            <div className="gnote">Access is blocked for US users/persons. Do not connect funds or place live trades.</div>
          </motion.form>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ ui, item, go, chartIntro, navFlash, Icon }) {
  const asset = ui.asset;
  const count = Object.keys(ui.marketAssets).length;
  const nav = ui.numericPrice(asset?.price);
  const tone = toneOf(asset?.change);
  const status = ui.navFreshness(asset, ui.marketClock);
  const rows = rangeRows(asset?.navHistory, ui.range);
  const low = rows.length ? Math.min(...rows.map((row) => Number(row.price))) : null;
  const high = rows.length ? Math.max(...rows.map((row) => Number(row.price))) : null;
  const volatility = Number(asset?.volatility);
  const lead = ui.riskLoading || !ui.matchingInsight
    ? (status === "delayed" ? "NAV is delayed; refreshing research context." : status === "unknown" ? "NAV timestamp is unavailable; refreshing research context." : status === "unavailable" ? "NAV is unavailable; refreshing research context." : "Updating research context…")
    : ui.riskBriefs[ui.selected];
  return (
    <>
      <motion.div className="phead" initial="hidden" animate="show" variants={item}>
        <div>
          <h1 className="page-title">Market overview<span className="muted">{count ? `, ${count} B20 stocks on Base.` : ""}</span></h1>
          <p className="lede">{ui.dataMode === "B20 MAINNET" ? "NAV reference from the Coinbase Tokenized Stocks API · Base mainnet 8453" : "Waiting for a live NAV reference · Base mainnet 8453. Nothing is shown until it arrives."}</p>
          <p className="journey-hint">Choose an asset → review the brief → simulate a position → save a thesis</p>
          <div className="phead-actions">
            <button className="btn ghost demo-launch" type="button" onClick={ui.startJudgeDemo} disabled={ui.judgeRunning || ui.portfolioAgentLoading}>
              <i className="pulse-dot" aria-hidden="true" />{ui.judgeRunning ? "Running demo…" : "Start demo"}
            </button>
          </div>
        </div>
        <div className="bookchip">
          <div><div className="k">Paper book</div><NumberFlow className="v num" value={ui.portfolioMetrics.total || 0} format={{ style: "currency", currency: "USD" }} transformTiming={flowTiming} spinTiming={flowTiming} /></div>
          <div className="sep" />
          <div><div className="k">Unrealized P/L</div><div className={`v num ${clampNoise(ui.portfolioMetrics.pnl, 0.005) > 0 ? "up" : clampNoise(ui.portfolioMetrics.pnl, 0.005) < 0 ? "down" : "flat"}`}><NumberFlow value={clampNoise(ui.portfolioMetrics.pnl, 0.005)} format={{ style: "currency", currency: "USD", signDisplay: "exceptZero" }} transformTiming={flowTiming} spinTiming={flowTiming} /></div></div>
          <div className="sep d-only" />
          <div className="d-only"><div className="k">Positions</div><div className="v num">{ui.portfolioMetrics.rows.length}</div></div>
        </div>
      </motion.div>
      {ui.judgeStep > 0 && (
        <section className="card judge-demo" aria-live="polite">
          <div className="card-h"><h2>Explore StockLens</h2><span className="tag">Paper only</span></div>
          <div className="wl-filter">{["Select asset", "Read NAV", "Build allocation", "Review plan"].map((label, index) => <span key={label} className="tag">{ui.judgeStep > index + 1 ? "Done · " : ui.judgeStep === index + 1 ? "Now · " : ""}{label}</span>)}</div>
          <p className="lede" style={{ padding: "0 20px 16px" }}>{ui.judgeRunning ? "Preparing the portfolio plan…" : ui.judgeStep === 4 ? "Review the proposed allocation on the Portfolio Agent screen." : "The plan could not be prepared. Start the demo again."}</p>
        </section>
      )}
      {ui.notice && <p className="trade-notice" role="status">{ui.notice}</p>}
      <div className="chips m-only" aria-label="Markets">
        {ui.filteredMarketAssets.map(([symbol, row]) => (
          <button key={symbol} type="button" className={`chip ${symbol === ui.selected ? "on" : ""}`} onClick={() => ui.pick(symbol)}>
            <Icon symbol={symbol} />
            {symbol}
            <small className="num">{ui.hasNav(row) ? row.price : "—"}</small>
          </button>
        ))}
      </div>
      <div className="dash" id="overview">
        <div className="col a-wl d-only">
          <motion.section id="watchlist" className="card" initial="hidden" animate="show" variants={item}>
            <Watchlist ui={ui} Icon={Icon} />
          </motion.section>
        </div>
        <div className="col a-hero">
          <motion.section className="card hero" initial="hidden" animate="show" variants={item}>
            <Hero ui={ui} asset={asset} nav={nav} tone={tone} status={status} navFlash={navFlash} chartIntro={chartIntro} low={low} high={high} volatility={volatility} Icon={Icon} />
          </motion.section>
        </div>
        <div className="lower a-low d-only">
          <motion.section className="card" initial="hidden" animate="show" variants={item}>
            <div className="card-h"><h2>Paper book</h2><button className="btn ghost" type="button" style={{ height: 36 }} onClick={() => go("agent")}>Open agent</button></div>
            {ui.portfolioMetrics.rows.length === 0 ? <div className="empty-book"><p className="lede">No paper positions yet. Try a simulated position to start your book.</p><button className="btn ghost" type="button" onClick={() => go("paper")}>Open Paper Lab</button></div> : ui.portfolioMetrics.rows.map((row) => (
              <div key={row.symbol} className="book-row">
                <Icon symbol={row.symbol} />
                <span><b>{row.symbol}</b> <span className="muted">· {ui.portfolioMetrics.total ? `${((row.currentValue / ui.portfolioMetrics.total) * 100).toFixed(0)}%` : "—"}</span></span>
                <span className="r num">{ui.formatUSD(row.currentValue)}</span>
                <span className={`r num ${clampNoise(row.pnl, 0.005) > 0 ? "up" : clampNoise(row.pnl, 0.005) < 0 ? "down" : "flat"}`}>{ui.formatUSD(clampNoise(row.pnl, 0.005))}</span>
              </div>
            ))}
          </motion.section>
          <motion.section className="card" initial="hidden" animate="show" variants={item}>
            <div className="card-h"><h2>Theses & proofs</h2><button className="btn ghost" type="button" style={{ height: 36 }} onClick={() => go("theses")}>Open</button></div>
            {ui.thesisWorkspace.slice(0, 2).map((thesis) => (
              <div key={thesis.id} className="proof"><span className="seal">✓</span><div><b>{thesis.symbol} · {thesis.title}</b><small>{thesis.status} · {new Date(thesis.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</small></div></div>
            ))}
            {ui.thesisHistory[0] && (
              <div className="proof"><span className="seal">✓</span><div><b>{ui.thesisHistory[0].symbol} · onchain thesis</b><small>{new Date(ui.thesisHistory[0].timestamp).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div><span className="mono">{shortAddr(ui.thesisHistory[0].researcher)}</span></div>
            )}
            <div className="proof"><span className="seal">✓</span><div><b>Registry on Base Sepolia</b><small>StockLensRegistry · read-only history</small></div><a className="mono" href={`https://sepolia.basescan.org/address/${ui.registry}`} target="_blank" rel="noreferrer">{shortAddr(ui.registry)}</a></div>
          </motion.section>
        </div>
        <div className="col a-side">
          <motion.section id="lens" className="card brief" initial="hidden" animate="show" variants={item}>
            <div className="brief-h"><h2 className="h2">Research brief</h2><span className="tag">AI brief · {ui.selected}</span></div>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={ui.selected} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.22, ease: easeOut }}>
                <p className="lead">{highlightLead(lead)}</p>
                <div className="case"><i style={{ background: "var(--up-soft)", color: "var(--up)" }}>↑</i><div>Bull case<div className="b">{asset?.bull || "—"}</div></div></div>
                <div className="case"><i style={{ background: "var(--down-soft)", color: "var(--down)" }}>↓</i><div>Bear case<div className="b">{asset?.bear || "—"}</div></div></div>
                <div className="case"><i style={{ background: "var(--lav-wash)", color: "var(--lav)" }}>◎</i><div>What to watch<div className="b">{ui.insight?.portfolioRationale || "Watch NAV freshness."}</div></div></div>
                <div className="score"><span>Data availability</span><div className="meter"><i style={{ width: `${Math.max(0, Math.min(100, Number(ui.displayedScore) || 0))}%` }} /></div><b className="num">{ui.displayedScore}</b></div>
                <div className="brief-actions">
                  <button className="btn ghost" type="button" onClick={() => go("theses")}>Save as thesis</button>
                  <button className="btn ghost" type="button" aria-expanded={ui.aiDetailsOpen} onClick={() => ui.setAiDetailsOpen((open) => !open)}>{ui.aiDetailsOpen ? "Hide details" : "Challenge brief"}</button>
                </div>
                <p className="model-line">{String(ui.modelLabel || "").replace("MODEL / ", "Model · ").replace("V I K E Y", "Vikey")}{ui.insight?.confidence != null ? ` · confidence ${ui.insight.confidence}/100` : ""}</p>
                {ui.matchingInsight && ui.insight?.fallback && <p className="fallback-note">Using a rules-based brief while AI research is unavailable or data is insufficient.</p>}
                {ui.aiDetailsOpen && (
                  <div className="ai-details">
                    <div className="case"><i /><div>Catalysts<div className="b">{(ui.insight?.catalysts || []).join(" · ") || "No catalyst data"}</div></div></div>
                    <div className="case"><i /><div>Risks<div className="b">{(ui.insight?.risks || []).join(" · ") || "No risk data"}</div></div></div>
                    <p className="model-line">Source {ui.insight?.source || "Unknown"} · {ui.scoreBasis}</p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </motion.section>
          <motion.section className="card agent-entry" initial="hidden" animate="show" variants={item}>
            <AgentEntry ui={ui} go={go} />
          </motion.section>
        </div>
        <motion.section className="card m-only m-markets" initial="hidden" animate="show" variants={item}>
          <div className="card-h"><h2>All markets</h2><span className="sub num">{ui.filteredMarketAssets.length} B20</span></div>
          <div className="asset-list">
            {ui.filteredMarketAssets.map(([symbol, row]) => <AssetButton key={symbol} symbol={symbol} item={row} ui={ui} Icon={Icon} />)}
          </div>
        </motion.section>
      </div>
    </>
  );
}

function rangeRows(history, range) {
  const days = { "1W": 7, "1M": 30, "3M": 90, "1Y": 365 };
  const cutoff = Date.now() - (days[range] || 30) * 864e5;
  return (Array.isArray(history) ? history : []).filter((row) => Number(row.timestamp) >= cutoff && Number(row.price) > 0);
}

function Watchlist({ ui, Icon }) {
  const filters = [["all", "All"], ["nav", "NAV fresh"], ["trending", "Moving"]];
  useEffect(() => {
    const row = document.querySelector("#watchlist .asset-row.active");
    const list = row?.closest(".asset-list");
    if (!row || !list) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [ui.selected]);
  return (
    <>
      <div className="card-h"><h2>Watchlist</h2><span className="sub num">{ui.filteredMarketAssets.length} assets</span></div>
      <label className="market-search" id="asset-search">
        <span aria-hidden="true">⌕</span>
        <input value={ui.marketSearch} onChange={(event) => ui.setMarketSearch(event.target.value)} placeholder="Ticker or name" aria-label="Search markets" />
      </label>
      <div className="wl-filter">
        <div className="seg" role="group" aria-label="Market filter">
          {filters.map(([value, label]) => <button key={value} type="button" className={ui.marketFilter === value ? "on" : ""} onClick={() => ui.setMarketFilter(value)}>{label}</button>)}
        </div>
        <select className="market-select" value={ui.marketSort} onChange={(event) => ui.setMarketSort(event.target.value)} aria-label="Market sort">
          <option value="score">Sort by score</option>
          <option value="price">Sort by price</option>
          <option value="supply">Sort by supply</option>
          <option value="risk">Sort by risk</option>
          <option value="updated">Sort by updated</option>
        </select>
      </div>
      <div className="asset-list">
        {ui.filteredMarketAssets.map(([symbol, row]) => <AssetButton key={symbol} symbol={symbol} item={row} ui={ui} Icon={Icon} layout />)}
      </div>
      <div className="wl-foot">
        <span>{ui.dataMode === "MARKET UPDATE FAILED" || ui.dataMode === "NAV UNAVAILABLE" ? "Market refresh unavailable" : "Refreshes every minute while open"}</span>
        <span>NAV delayed after 1 hour</span>
      </div>
    </>
  );
}

function AssetButton({ symbol, item, ui, Icon, layout = false }) {
  const active = symbol === ui.selected;
  const status = ui.navFreshness(item, ui.marketClock);
  const pending = !ui.hasNav(item) || item.change === "N/A";
  return (
    <button type="button" className={`asset-row ${active ? "active" : ""}`} onClick={() => ui.pick(symbol)}>
      {active && layout && <motion.span layoutId="wl-active" className="wl-active" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
      <Icon symbol={symbol} />
      <span className="asset-name">
        <b>{symbol}</b>
        <small>{item.name}{status === "delayed" ? " · Delayed" : status === "current" ? "" : " · Pending"}</small>
      </span>
      <Spark history={item.navHistory} change={item.change} />
      <span className="asset-price">
        <b className="num">{ui.hasNav(item) ? item.price : "—"}</b>
        <small className={`num ${pending ? "flat" : toneOf(item.change)}`}>{pending ? "Pending" : item.change}</small>
      </span>
    </button>
  );
}

function Hero({ ui, asset, nav, tone, status, navFlash, chartIntro, low, high, volatility, Icon }) {
  const time = asset?.navUpdatedAt ? new Date(asset.navUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  const supply = Number(asset?.totalSupply);
  const xLabels = axisDates(asset?.navHistory, ui.range);
  const empty = (
    <div className="chart-empty" role="status">
      <strong>Collecting NAV history</strong>
      <span>{ui.chartHistoryMeta.count} snapshot{ui.chartHistoryMeta.count === 1 ? "" : "s"} in {ui.range}</span>
      <small>{ui.chartType === "candles" ? "At least 2 days of NAV observations are needed for candles." : "A trend is shown after 3 observations. Switch range or wait for the next snapshot."}</small>
    </div>
  );
  return (
    <>
      <div className="hero-top">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={ui.selected} className="asset-id" initial={{ opacity: 0, filter: "blur(3px)", y: 3 }} animate={{ opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.22, ease: easeOut } }} exit={{ opacity: 0, filter: "blur(3px)", y: -3, transition: { duration: 0.14 } }}>
            <Icon symbol={ui.selected} />
            <div>
              <h2>{asset?.name || ui.selected}</h2>
              <div className="meta"><span className="tag">{ui.selected}</span><span>B20 · Base mainnet</span></div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="price-row">
        {nav == null ? <div className="price num">—</div> : (
          <NumberFlow className="price num" value={nav} format={{ style: "currency", currency: "USD", minimumFractionDigits: 2 }} transformTiming={flowTiming} spinTiming={flowTiming} opacityTiming={{ duration: 350, easing: "ease-out" }} />
        )}
        <div className={`chg num ${tone}`}>{asset?.change === "N/A" || nav == null ? "Pending" : <>{tone === "up" ? "↗" : tone === "down" ? "↘" : ""} {asset.change} <span>{ui.range}</span></>}</div>
      </div>
      <div className="navline">
        <span className="live"><span className={`pulse ${status === "current" ? "" : "stale"}`} />{freshCopy(status)}{time ? <> · <span className={`num navtick ${navFlash ? "flash" : ""}`}>{time}</span></> : null}</span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={`${ui.selected}-meta`} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.22 }}>
            {Number.isFinite(supply) ? <>Supply <span className="num">{supply.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span></> : "Supply unavailable"}
            {asset?.contractAddress ? <> · <a className="mono" href={`https://basescan.org/token/${asset.contractAddress}`} target="_blank" rel="noreferrer">{shortAddr(asset.contractAddress)}</a></> : null}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="chartbar">
        <span className="legendline"><i style={{ background: tone === "down" ? "var(--down)" : tone === "up" ? "var(--up)" : "var(--lav)" }} />B20 NAV reference</span>
        <div className="ctrls">
          <div className="seg chart-modes" role="group" aria-label="Chart type">
            {[["area", "Area"], ["line", "Line"], ["candles", "Candle"]].map(([value, label]) => (
              <button key={value} type="button" className={ui.chartType === value ? "active" : ""} disabled={value === "candles" && !ui.chartCandles.length} onClick={() => ui.setChartType(value)}>{label}</button>
            ))}
          </div>
          <div className="seg ranges" role="group" aria-label="Chart range">
            {["1W", "1M", "3M", "1Y"].map((value) => <button key={value} type="button" className={ui.range === value ? "active" : ""} onClick={() => ui.setRange(value)}>{value}</button>)}
          </div>
        </div>
      </div>
      <div className="chart-slot">
        <AnimatePresence initial={false}>
          <motion.div key={`${ui.selected}-${ui.chartType}-${ui.range}-${ui.chartPoints || ui.chartCandles.length}`} className="chart-layer" initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.28 } }}>
            <NavChart points={ui.chartPoints} candles={ui.chartCandles} mode={ui.chartType} tone={tone === "flat" ? "flat" : tone} range={ui.range} intro={chartIntro} yLabels={ui.chartYLabels} xLabels={xLabels} priceLabel={nav == null ? "" : ui.formatUSD(nav)} empty={empty} />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="statstrip">
        <div className="stat"><div className="k">{ui.range} range</div><div className="v num">{rangeRows(asset?.navHistory, ui.range).length < 2 || low == null ? "—" : `${ui.formatUSD(low)}–${ui.formatUSD(high)}`}</div></div>
        <div className="stat"><div className="k">Volatility</div><div className="v num">{Number.isFinite(volatility) ? `${volatility.toFixed(1)}%` : "—"}</div></div>
        <div className="stat"><div className="k">NAV snapshots</div><div className="v num">{ui.chartHistoryMeta.count} <small>in {ui.range}</small></div></div>
        <div className="stat"><div className="k">Data availability</div><div className="v num">{ui.displayedScore} <small>/100</small></div></div>
      </div>
    </>
  );
}

function AgentEntry({ ui, go }) {
  const current = ui.portfolioMetrics.rows.map((row) => ({ symbol: row.symbol, value: row.currentValue }));
  const target = ui.rebalanceRows.map((row) => ({ symbol: row.symbol, value: Number(row.targetPercent) || 0 }));
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <BrandMark size={40} />
        <span className="tag">{ui.portfolioPlan ? `${ui.portfolioPlan.regime || "Plan"} · confidence ${ui.portfolioPlan.confidence ?? "—"}` : "Not run yet"}</span>
      </div>
      <h3>Portfolio Agent</h3>
      <p>{ui.portfolioPlan?.summary || "Reads NAV history, volatility, freshness and your paper book, then proposes a target across the B20 watchlist."}</p>
      <div className="mini">
        <div className="lbl"><span>Current book</span><span className="num">{current.length} assets</span></div>
        <div className="stack">{current.filter((row) => row.value > 0).map((row, index) => <i key={row.symbol} style={{ width: `${(row.value / (ui.portfolioMetrics.total || 1)) * 100}%`, background: PAL[index % PAL.length] }} />)}</div>
        <div className="lbl"><span>Proposed target</span><span className="num">{ui.portfolioPlan ? `${target.length} assets` : "—"}</span></div>
        <div className="stack">{target.filter((row) => row.value > 0).map((row, index) => <i key={row.symbol} style={{ width: `${row.value}%`, background: PAL[index % PAL.length] }} />)}</div>
      </div>
      {ui.largestMove && (
        <div className="largest">
          <div className="k">Largest change by value</div>
          <div className="v"><b>{ui.largestMove.symbol}</b> <span className="num">{ui.largestMove.currentPercent.toFixed(0)}% → {ui.largestMove.targetPercent}%</span></div>
          <div className={`num ${ui.largestMove.deltaValue >= 0 ? "up" : "down"}`}>{ui.largestMove.deltaValue >= 0 ? "Add" : "Reduce"} {ui.formatUSD(Math.abs(ui.largestMove.deltaValue))} (paper)</div>
        </div>
      )}
      <button className="btn base lg" type="button" style={{ width: "100%" }} onClick={() => go("agent")}>Review rebalance plan <span>→</span></button>
    </>
  );
}

function AgentScreen({ ui, item, go, Icon }) {
  const rows = [...ui.rebalanceRows].sort((left, right) => Math.max(right.currentPercent, right.targetPercent) - Math.max(left.currentPercent, left.targetPercent));
  const trades = [...ui.rebalanceRows].filter((row) => row.action !== "HOLD").sort((left, right) => Math.abs(right.deltaValue) - Math.abs(left.deltaValue));
  const adds = trades.filter((row) => row.action === "ADD").length;
  const reduces = trades.filter((row) => row.action === "REDUCE").length;
  const moved = trades.reduce((sum, row) => sum + Math.abs(row.deltaValue), 0);
  const showTarget = ui.agentMorphing || ui.agentApplied;
  const previous = new Map((ui.portfolioUndo || []).map((row) => [row.symbol, Number(row.notional)]));
  return (
    <div className={`screen-block ${ui.agentApplied ? "is-after" : ""}`}>
      <motion.div className="phead" initial="hidden" animate="show" variants={item}>
        <div>
          <h1 className="page-title">Portfolio Agent <span className="muted">{ui.agentApplied ? "· applied to paper book" : "· rebalance preview"}</span></h1>
          <p className="lede">Target weighted by data availability, not asset risk. Paper-only: no orders are placed. The onchain proof is optional.</p>
        </div>
        <div className="bookchip">
          <div className="agent-sum">
            <div><div className="k">Regime</div><div className="v">{ui.portfolioPlan?.regime || "—"}</div></div>
            <div><div className="k">Confidence</div><div className="v num">{ui.portfolioPlan?.confidence ?? "—"}<span className="muted">/100</span></div></div>
            <div><div className="k">Universe</div><div className="v num">{Object.keys(ui.marketAssets).length} B20</div></div>
            <div><div className="k">Paper budget</div><div className="v num">{ui.formatUSD(ui.budget)}</div></div>
          </div>
        </div>
      </motion.div>
      {ui.notice && <p className="trade-notice" role="status">{ui.notice}</p>}
      <div className="ag-grid">
        <div className="col">
          <motion.section className="card" initial="hidden" animate="show" variants={item}>
            <div className="card-h">
              <div><h2>Allocation</h2><div className="sub">{ui.agentApplied ? "At target · applied to the paper book" : "Current book vs agent target"}</div></div>
              <div className="legend"><span><i style={{ background: "#cfcfc8" }} />Current</span><span><i style={{ background: "var(--lav)" }} />Target</span><span><i style={{ width: 2, height: 14, background: "var(--ink)" }} />Target mark</span></div>
            </div>
            {rows.length === 0 ? <p className="lede" style={{ padding: "0 22px 18px" }}>Run the agent to propose a target. No allocation is invented before that.</p> : (
              <div className="alloc">
                <div className="alloc-h"><span>Asset</span><span /><span style={{ textAlign: "right" }}>Now</span><span style={{ textAlign: "right" }}>Target</span><span style={{ textAlign: "right" }}>Change</span></div>
                {rows.map((row, index) => (
                  <div key={row.symbol} className="arow">
                    <span className="a"><Icon symbol={row.symbol} />{row.symbol}</span>
                    <div className="track" aria-hidden="true">
                      <span className="cur" style={{ width: `${Math.min(100, row.currentPercent)}%` }} />
                      <motion.span className="rebalance-bar bar" initial={false} animate={{ width: `${Math.min(100, showTarget ? Number(row.targetPercent) : row.currentPercent)}%` }} transition={{ duration: 0.9, ease: easeOut, delay: showTarget ? index * 0.04 : 0 }} />
                      <span className="ghost" style={{ left: `calc(${Math.min(100, Number(row.targetPercent) || 0)}% - 1px)` }} />
                    </div>
                    <span className="n num muted">{row.currentPercent.toFixed(0)}%</span>
                    <span className="n num">{row.targetPercent}%</span>
                    <span className={`delta num ${clampNoise(row.delta, 0.5) > 0 ? "up" : clampNoise(row.delta, 0.5) < 0 ? "down" : "flat"}`}>{clampNoise(row.delta, 0.5) > 0 ? "+" : ""}{clampNoise(row.delta, 0.5).toFixed(0)} pt</span>
                  </div>
                ))}
              </div>
            )}
          </motion.section>
          <motion.section className="card" initial="hidden" animate="show" variants={item}>
            <div className="card-h">
              <div><h2>Paper book</h2><div className="sub">{ui.agentApplied ? `${ui.portfolioMetrics.rows.length} positions · updated` : `${ui.portfolioMetrics.rows.length} positions · before apply`}</div></div>
              <div style={{ textAlign: "right" }}><div className="sub">Book value</div><NumberFlow className="num" value={ui.portfolioMetrics.total || 0} format={{ style: "currency", currency: "USD" }} style={{ fontSize: 22, fontWeight: 500 }} transformTiming={flowTiming} spinTiming={flowTiming} /></div>
            </div>
            {ui.txHash && (
              <motion.div className="proof-new" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: easeOut }}>
                <span className="seal">✓</span>
                <div><b>Thesis proof · Base Sepolia 84532</b><small>StockLensRegistry.recordThesis · wallet confirmed</small></div>
                <a className="mono" href={`https://sepolia.basescan.org/tx/${ui.txHash}`} target="_blank" rel="noreferrer">{shortAddr(ui.txHash)}</a>
              </motion.div>
            )}
            {ui.portfolioMetrics.rows.length === 0 ? <p className="lede" style={{ padding: "0 20px 18px" }}>The paper book is empty.</p> : (
              <div className="book-scroll"><table className="book-table">
                <thead><tr><th>Asset</th><th>Units</th><th>NAV</th><th>Value</th><th>Weight</th><th>P/L since entry</th></tr></thead>
                <tbody>
                  {ui.portfolioMetrics.rows.map((row) => {
                    const changed = ui.bookFlash && (!previous.size || !previous.has(row.symbol) || previous.get(row.symbol) !== Number(row.notional));
                    const isNew = ui.bookFlash && previous.size > 0 && !previous.has(row.symbol);
                    return (
                      <tr key={row.symbol} className={changed ? "flash" : ""}>
                        <td><span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}><Icon symbol={row.symbol} />{row.symbol}{isNew ? <span className="tag-new">new</span> : null}</span></td>
                        <td className="num">{ui.formatUnits(row.units)}</td>
                        <td className="num">{ui.marketAssets[row.symbol]?.price || "—"}</td>
                        <td className="num">{ui.formatUSD(row.currentValue)}</td>
                        <td className="num">{ui.portfolioMetrics.total ? `${((row.currentValue / ui.portfolioMetrics.total) * 100).toFixed(0)}%` : "—"}</td>
                        <td className={`num ${clampNoise(row.pnl, 0.005) > 0 ? "up" : clampNoise(row.pnl, 0.005) < 0 ? "down" : "flat"}`}>{ui.formatUSD(clampNoise(row.pnl, 0.005))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
          </motion.section>
        </div>
        <div className="col">
          <motion.section className="card rebalance-card" initial="hidden" animate="show" variants={item}>
            <div className="card-h"><div><h2>Rebalance preview</h2><div className="sub">{ui.portfolioPlan ? `${adds} adds · ${reduces} reduces · ${ui.formatUSD(moved)} moved` : "No plan yet"}</div></div></div>
            <p className="lede" style={{ padding: "0 20px" }}>{ui.portfolioPlan?.summary || "The agent proposes weights from the assets that have a usable NAV. It does not place orders."}</p>
            {ui.portfolioPlan?.source && <p className="model-line" style={{ padding: "0 20px" }}>Source {ui.portfolioPlan.source}{ui.portfolioPlan.fallback ? ` · fallback ${ui.portfolioPlan.fallbackReason || "unavailable"}` : ""}</p>}
            <div className="apply-box">
              {!ui.portfolioPlan && <button className="btn base lg" type="button" style={{ width: "100%" }} onClick={ui.runPortfolioAgent} disabled={ui.portfolioAgentLoading}>{ui.portfolioAgentLoading ? "Thinking…" : "Run portfolio agent"} <span>→</span></button>}
              {ui.portfolioPlan && !ui.agentApplied && <button className="btn base lg" type="button" style={{ width: "100%" }} onClick={ui.applyPortfolioPlan} disabled={ui.applyingPlan}>{ui.applyingPlan ? "Applying…" : "Apply to paper book"} <span>→</span></button>}
              {ui.agentApplied && (
                <div className="toast"><span className="seal" style={{ background: "#2f8a57", color: "#fff" }}>✓</span><div>Applied to paper book<small>No orders placed, paper only</small></div></div>
              )}
              {ui.portfolioAgentError && <p className="compliance-error">{ui.portfolioAgentError}</p>}
              <p>{ui.agentApplied ? "The paper book now matches the target." : "Your paper book stays unchanged until you apply. NAV is a reference value, not a guaranteed fill price."}</p>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                {ui.portfolioPlan && <button className="btn ghost" type="button" style={{ flex: 1 }} onClick={ui.runPortfolioAgent} disabled={ui.portfolioAgentLoading}>Run again</button>}
                {ui.portfolioUndo && <button className="btn ghost" type="button" style={{ flex: 1 }} onClick={ui.undoPortfolioApply}>Undo apply</button>}
                <button className="btn ghost" type="button" style={{ flex: 1 }} onClick={() => go("theses")}>Save as thesis</button>
              </div>
            </div>
            <div>
              {trades.map((row) => {
                const price = ui.numericPrice(ui.marketAssets[row.symbol]?.price);
                const units = price ? Math.abs(row.deltaValue) / price : null;
                return (
                  <div key={row.symbol} className="trade">
                    <span className={`act ${row.action === "ADD" ? "add" : "reduce"}`}>{row.action === "ADD" ? "Add" : "Reduce"}</span>
                    <div><b>{row.symbol}</b><small className="num">{row.currentPercent.toFixed(0)}% → {row.targetPercent}%{units != null ? ` · ≈ ${units.toFixed(3)} units` : ""}{row.reason ? ` · ${row.reason}` : ""}</small></div>
                    <span className={`num ${row.deltaValue >= 0 ? "up" : "down"}`}>{row.deltaValue >= 0 ? "+" : "−"}{ui.formatUSD(Math.abs(row.deltaValue))}</span>
                  </div>
                );
              })}
            </div>
          </motion.section>
        </div>
      </div>
    </div>
  );
}

function PaperScreen({ ui, item, Icon, Wallet }) {
  const asset = ui.asset || {};
  return (
    <div className="screen-block" id="simulate">
      <motion.div className="phead" initial="hidden" animate="show" variants={item}>
        <div>
          <h1 className="page-title">Paper lab</h1>
          <p className="lede">Test a position without placing an order. Optional proofs are recorded on Base Sepolia, not as trades.</p>
        </div>
      </motion.div>
      {ui.notice && <p className="trade-notice" role="status">{ui.notice}</p>}
      <motion.section className="card simulator" initial="hidden" animate="show" variants={item}>
        <div className="card-h"><h2>Position builder</h2><span className="tag">{ui.wallet ? "Base Sepolia · 84532" : "No wallet required"}</span></div>
        <div className="selected-token">
          <Icon symbol={ui.selected} />
          <div><b>{ui.selected}</b><small>{asset.name} / {asset.price}</small></div>
          {asset.contractAddress && <a className="token-contract mono" href={`https://basescan.org/token/${asset.contractAddress}`} target="_blank" rel="noreferrer">{shortAddr(asset.contractAddress)}</a>}
        </div>
        <div className="budget-header"><span>Paper budget</span><output className="num">{ui.formatUSD(ui.budget)}</output></div>
        <div className="balance-line"><span>Available balance</span><b>{ui.usdcBalance === null ? "Connect a wallet to read USDC" : `${ui.usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`}</b></div>
        <div className="budget-presets">
          {[25, 50, 100].map((percent) => <button key={percent} type="button" className={ui.budgetMode === `${percent}%` ? "active" : ""} disabled={!ui.usdcBalance} onClick={() => ui.chooseBudget(percent)}>{percent}%</button>)}
          <button type="button" className={ui.budgetMode === "manual" ? "active" : ""} onClick={() => ui.setBudgetMode("manual")}>Manual</button>
        </div>
        {ui.budgetMode === "manual" && (
          <label className="manual-budget">Amount
            <input type="number" min="0" max={ui.usdcBalance || 10000} step="0.01" value={ui.budget} onChange={(event) => ui.setBudget(Math.min(ui.usdcBalance ?? 10000, Math.max(0, Number(event.target.value) || 0)))} />
          </label>
        )}
        <div className="sim-result">
          <div><span>Estimated units</span><strong className="num">{ui.formatUnits(ui.allocation)}</strong></div>
          <div><span>Notional</span><strong className="num">{ui.formatUSD(ui.budget)}</strong></div>
        </div>
        <button className="run-button" type="button" onClick={ui.runSimulation}>{ui.isSimulating ? "Calculating…" : "Run paper trade"}</button>
        <Wallet className="wallet-inline" />
        <button className="chain-button" type="button" onClick={ui.proveOnchain}>{ui.isSending ? "Waiting for wallet…" : "Record thesis onchain"}</button>
        {ui.txHash && <a className="tx-link mono" href={`https://sepolia.basescan.org/tx/${ui.txHash}`} target="_blank" rel="noreferrer">View contract transaction {shortAddr(ui.txHash)}</a>}
        <p className="sim-note">Records a thesis on Base Sepolia (84532). The contract keeps its legacy heuristic score. It is not a validated asset-risk rating and needs testnet gas.</p>
        {ui.portfolioMetrics.rows.length > 0 && (
          <div className="portfolio-mini">
            <span>Local paper portfolio</span>
            {ui.portfolioMetrics.rows.map((row) => (
              <div key={row.symbol}>
                <b>{row.symbol}</b>
                <small>{ui.formatUnits(row.units)} units · {ui.formatUSD(row.currentValue)}</small>
                <strong className={clampNoise(row.pnl, 0.005) > 0 ? "up" : clampNoise(row.pnl, 0.005) < 0 ? "down" : "flat"}>{ui.formatUSD(clampNoise(row.pnl, 0.005))}</strong>
                <button className="remove-position" type="button" onClick={() => ui.removePosition(row.symbol)} aria-label={`Remove ${row.symbol}`}>×</button>
              </div>
            ))}
          </div>
        )}
      </motion.section>
    </div>
  );
}

function ThesisScreen({ ui, item }) {
  const [showAllHistory, setShowAllHistory] = useState(false);
  const asset = ui.asset || {};
  return (
    <div className="screen-block theses-screen">
      <motion.div className="phead" initial="hidden" animate="show" variants={item}>
        <div>
          <h1 className="page-title">Theses</h1>
          <p className="lede">Save a paper thesis, review the outcome, and read the optional Base Sepolia record.</p>
        </div>
        <span className="workspace-count">{ui.thesisWorkspace.length} saved</span>
      </motion.div>
      {ui.notice && <p className="trade-notice" role="status">{ui.notice}</p>}
      <nav className="theses-jumps" aria-label="Theses sections">
        {[ ["thesis-workspace", "New thesis"], ["active-research", "Active research"], ["thesis-activity", "Activity"], ["history", "Onchain record"] ].map(([id, label]) => <button key={id} type="button" onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{label}</button>)}
      </nav>
      <div className="lower">
        <motion.section id="thesis-workspace" className="card thesis-composer" initial="hidden" animate="show" variants={item}>
          <div className="card-h"><h2>New thesis</h2><b>{ui.selected} · {asset.price}</b></div>
          <label>Title
            <input value={ui.thesisTitle} onChange={(event) => ui.setThesisTitle(event.target.value)} placeholder={`${ui.selected} setup`} />
          </label>
          <label>What are you watching?
            <textarea value={ui.thesisNote} onChange={(event) => ui.setThesisNote(event.target.value)} rows="4" placeholder="Reason, catalyst, or what would change your mind." />
          </label>
          <label>Conviction
            <select value={ui.thesisConviction} onChange={(event) => ui.setThesisConviction(event.target.value)}>
              <option value="1">1 · exploratory</option>
              <option value="2">2 · forming</option>
              <option value="3">3 · measured</option>
              <option value="4">4 · strong</option>
              <option value="5">5 · highest</option>
            </select>
          </label>
          <p className="model-line">Data availability {ui.displayedScore}/100 · risk not assessed · {ui.modelLabel}</p>
          <button className="workspace-save" type="button" onClick={ui.saveThesis}>Save thesis</button>
          <small className="workspace-note">Saved in this browser and, when the server accepts it, on the thesis store. No order or custody.</small>
        </motion.section>
        <motion.section id="active-research" className="card thesis-list-panel" initial="hidden" animate="show" variants={item}>
          <div className="card-h"><h2>Active research</h2></div>
          {ui.thesisWorkspace.length === 0 ? <p className="lede" style={{ padding: "0 20px 16px" }}>No thesis saved yet.</p> : ui.thesisWorkspace.map((row) => {
            const outcome = ui.thesisOutcome(row);
            return (
              <article key={row.id} className="workspace-item">
                <div className="workspace-item-top"><b>{row.symbol}</b><span className={`workspace-status ${String(row.status || "").toLowerCase()}`}>{row.status}</span><time>{new Date(row.createdAt).toLocaleDateString([], { day: "2-digit", month: "short" })}</time></div>
                <h3>{row.title}</h3>
                <p>{row.note}</p>
                <div className="workspace-outcome"><span>Outcome since entry</span><strong className={outcome.change === null ? "" : outcome.change >= 0 ? "up" : "down"}>{outcome.change === null ? "NAV pending" : `${outcome.change >= 0 ? "+" : ""}${outcome.change.toFixed(2)}%`}</strong><small>{outcome.current === null ? "Awaiting current NAV" : `Entry ${outcome.entry.toFixed(2)} → now ${outcome.current.toFixed(2)}`}</small></div>
                <div className="workspace-followup">
                  <div><span>Agent follow-up</span><b>{ui.followUpLoading[row.id] ? "Checking market context…" : ui.followUps[row.id]?.nextAction || "Waiting for market context"}</b></div>
                  {ui.followUps[row.id] && <small>{ui.followUps[row.id].reviewWindow} · confidence {ui.followUps[row.id].confidence}/100</small>}
                  <button type="button" onClick={() => ui.runFollowUp(row)}>{ui.followUpLoading[row.id] ? "Running…" : "Run follow-up"}</button>
                </div>
                <div className="workspace-actions">
                  <button type="button" onClick={() => { ui.pick(row.symbol); ui.setScreen("markets"); }}>Open asset</button>
                  <button type="button" onClick={() => ui.reviewThesis(row.id)}>Review outcome</button>
                  <button type="button" onClick={() => ui.shareThesis(row)}>Share</button>
                  {row.id?.startsWith("th_") && !ui.editTokenFor(row.id) ? <button type="button" onClick={() => ui.duplicateThesis(row)}>Duplicate</button> : null}
                  <select value={row.status} onChange={(event) => ui.updateThesisStatus(row.id, event.target.value)} aria-label={`Update ${row.symbol} thesis status`}>
                    <option value="OPEN">Open</option>
                    <option value="MONITORING">Monitoring</option>
                    <option value="INVALIDATED">Invalidated</option>
                    <option value="CLOSED">Closed</option>
                  </select>
                </div>
                {ui.shareLink?.id === row.id && <p role="status">Share link ready: <a href={ui.shareLink.url}>{ui.shareLink.url}</a></p>}
              </article>
            );
          })}
        </motion.section>
      </div>
      <div className="lower" id="thesis-activity">
        <motion.section className="card alert-center" initial="hidden" animate="show" variants={item}>
          <div className="card-h"><h2>Alerts</h2><span className="tag">{ui.thesisAlerts.length ? "Needs attention" : "Clear"}</span></div>
          {ui.thesisAlerts.length === 0 ? <p className="lede" style={{ padding: "0 20px 16px" }}>Follow-ups appear here when a thesis needs attention.</p> : ui.thesisAlerts.map((alert) => (
            <div key={alert.id} className={`alert-row ${String(alert.severity || "").toLowerCase()}`}><div><span>{alert.severity} · {alert.symbol}</span><b>{alert.title}</b><small>{alert.detail}</small></div><button type="button" onClick={() => ui.dismissAlert(alert.id)}>Acknowledge</button></div>
          ))}
        </motion.section>
        <motion.section className="card timeline-panel" initial="hidden" animate="show" variants={item}>
          <div className="card-h"><h2>Timeline</h2><span className="tag">{ui.timelineItems.length} events</span></div>
          {ui.timelineItems.length === 0 ? <p className="lede" style={{ padding: "0 20px 16px" }}>Save a thesis to start a timeline.</p> : ui.timelineItems.map((event) => (
            <div key={event.id} className="timeline-row"><i /><div><span>{event.symbol} · {event.type}</span><b>{event.detail}</b><small>{new Date(event.createdAt).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div></div>
          ))}
        </motion.section>
      </div>
      <motion.section id="history" className="card history-panel" initial="hidden" animate="show" variants={item}>
        <div className="card-h"><h2>Onchain record</h2><a href={`https://sepolia.basescan.org/address/${ui.registry}#readContract`} target="_blank" rel="noreferrer">Open contract</a></div>
        <p className="lede" style={{ padding: "0 20px" }}>Recent research proofs are read from Base Sepolia. Recorded scores use a legacy heuristic and are not validated asset-risk ratings.</p>
        {ui.historyLoading ? <p className="lede" style={{ padding: 20 }}>Reading Base Sepolia…</p> : ui.historyError ? <p className="lede" style={{ padding: 20 }}>{ui.historyError}</p> : ui.thesisHistory.length === 0 ? <p className="lede" style={{ padding: 20 }}>No thesis recorded yet.</p> : (
          <div className="history-list">
            {(showAllHistory ? ui.thesisHistory : ui.thesisHistory.slice(0, 3)).map((row) => (
              <a key={row.id} className="history-row" href={`https://sepolia.basescan.org/address/${ui.registry}#events`} target="_blank" rel="noreferrer">
                <span className="history-id">#{row.id}</span>
                <span className="history-symbol"><b>{row.symbol}</b><small>{new Date(row.timestamp).toLocaleString("en-US", { day: "2-digit", month: "short", year: "numeric" })}</small></span>
                <span><small>Price</small><b className="num">{ui.formatUSD(row.price)}</b></span>
                <span><small>Change</small><b className={row.change === null || row.change === 0 ? "neutral-change" : row.change > 0 ? "up" : "down"}>{ui.displayProofChange(row.change)}</b></span>
                <span><small>Recorded score</small><b>{row.score}/100</b></span>
                <span className="history-wallet"><small>Researcher</small><b className="mono">{shortAddr(row.researcher)}</b></span>
              </a>
            ))}
            {ui.thesisHistory.length > 3 && <button className="btn ghost history-toggle" type="button" aria-expanded={showAllHistory} onClick={() => setShowAllHistory((shown) => !shown)}>{showAllHistory ? "Show fewer records" : `Show all ${ui.thesisHistory.length} loaded records`}</button>}
          </div>
        )}
      </motion.section>
    </div>
  );
}

function BottomNav({ active, go }) {
  return (
    <nav className="mobile-nav sl-bnav" aria-label="Sections">
      <button type="button" className={active === "markets" ? "on" : ""} onClick={() => go("markets")}>Markets</button>
      <button type="button" className={active === "brief" ? "on" : ""} onClick={() => go("brief", "lens")}>Brief</button>
      <button type="button" className={active === "agent" ? "on" : ""} onClick={() => go("agent")} aria-label="Portfolio Agent"><span className="fab"><BrandMark size={26} /></span>Agent</button>
      <button type="button" className={active === "paper" ? "on" : ""} onClick={() => go("paper")}>Paper</button>
      <button type="button" className={active === "theses" ? "on" : ""} onClick={() => go("theses")}>Theses</button>
    </nav>
  );
}
