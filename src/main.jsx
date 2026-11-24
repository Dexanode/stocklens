import { StrictMode, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const assets = {
  AAPLx: { name: 'Apple', sector: 'Consumer tech', price: '$184.20', change: '+2.84%', tone: 'blue', risk: 'Moderate', score: 74, volume: '$18.4M', time: '2 min ago', bull: 'Clean momentum with strong liquidity.', bear: 'Signal is concentrated in one trend.', color: '#2457ff', points: '4,55 52,42 100,49 148,28 196,39 244,25 292,34 340,18 388,30 436,22 484,35 532,13 580,22 628,8 676,17 724,4' },
  COINx: { name: 'Coinbase', sector: 'Crypto exchange', price: '$212.64', change: '+5.12%', tone: 'cyan', risk: 'Elevated', score: 62, volume: '$12.8M', time: '4 min ago', bull: 'Upside expands with crypto volume.', bear: 'Highly sensitive to market beta.', color: '#00b8c8', points: '4,64 52,51 100,56 148,38 196,49 244,28 292,39 340,22 388,42 436,29 484,33 532,18 580,26 628,12 676,27 724,8' },
  TSLAx: { name: 'Tesla', sector: 'Mobility', price: '$248.71', change: '-1.08%', tone: 'coral', risk: 'High', score: 48, volume: '$9.7M', time: '7 min ago', bull: 'A smaller position keeps the thesis measurable.', bear: 'Choppy trend with elevated volatility.', color: '#ff6b52', points: '4,22 52,30 100,18 148,43 196,28 244,52 292,40 340,62 388,48 436,54 484,44 532,68 580,56 628,72 676,62 724,78' },
  NVDAx: { name: 'NVIDIA', sector: 'Semiconductors', price: '$138.91', change: '+3.41%', tone: 'violet', risk: 'Moderate', score: 81, volume: '$22.1M', time: '1 min ago', bull: 'Momentum and score are aligned.', bear: 'A strong score is not a return guarantee.', color: '#7959f5', points: '4,50 52,44 100,54 148,36 196,42 244,28 292,39 340,22 388,30 436,16 484,25 532,12 580,20 628,6 676,15 724,4' },
}

const briefs = {
  AAPLx: 'Momentum is positive, but the signal is concentrated in one clean trend. Watch liquidity before treating the move as conviction.',
  COINx: 'Higher upside comes with higher sensitivity to crypto volume. Treat this as a volatility-led setup, not a quiet compounder.',
  TSLAx: 'The trend is choppy and the risk lens is elevated. A smaller position keeps the experiment measurable while the thesis develops.',
  NVDAx: 'The strongest demo signal in this watchlist: momentum and score are aligned. Still, a strong score is not a guarantee of future returns.',
}

function App() {
  const [selected, setSelected] = useState('AAPLx')
  const [range, setRange] = useState('1M')
  const [budget, setBudget] = useState(1000)
  const [isSimulating, setIsSimulating] = useState(false)
  const [wallet, setWallet] = useState('')
  const [portfolio, setPortfolio] = useState([])
  const [notice, setNotice] = useState('')
  const asset = assets[selected]
  const allocation = useMemo(() => Math.round((budget / Number(asset.price.replace(/[$,]/g, ''))) * 100) / 100, [asset, budget])

  async function connectWallet() {
    try {
      if (window.ethereum) {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
        if (accounts?.[0]) { setWallet(accounts[0]); setNotice('Wallet connected. Use Base Sepolia for a real testnet transaction.') }
      } else { setWallet('preview'); setNotice('Preview wallet enabled. No browser wallet was detected.') }
    } catch { setNotice('Wallet connection cancelled.') }
  }

  function runSimulation() {
    setIsSimulating(true)
    setPortfolio((items) => [{ symbol: selected, units: allocation, notional: Number(budget) }, ...items.filter((item) => item.symbol !== selected)])
    setNotice(`${selected} paper position added to your local portfolio.`)
    window.setTimeout(() => setIsSimulating(false), 850)
  }

  const pick = (symbol) => { setSelected(symbol); setNotice(`${symbol} selected. Review the thesis before simulating.`) }

  return <div className="terminal-app">
    <aside className="sidebar"><a className="brand" href="#top"><span className="brand-mark">◈</span><span>STOCK</span>LENS</a><div className="workspace-label">WORKSPACE <b>01</b></div><nav className="side-nav"><a className="active" href="#overview">Overview</a><a href="#watchlist">Markets</a><a href="#lens">Risk lens</a><a href="#simulate">Paper lab</a></nav><div className="side-bottom"><div className="base-chip"><i /> BASE <span>8453</span></div><p>Research surface for tokenized stock experiments.</p><a href="#simulate" className="side-link">Open paper lab <b>↗</b></a></div></aside>
    <div className="main-column" id="top"><header className="topbar"><div className="mobile-brand">STOCKLENS <span>/ TERMINAL</span></div><div className="breadcrumb">RESEARCH / <b>MARKET OVERVIEW</b></div><div className="top-actions"><span className="status"><i /> {wallet ? 'Wallet ready' : 'Demo data'}</span><button className="wallet-button" onClick={connectWallet}>{wallet ? (wallet === 'preview' ? 'Preview wallet' : `${wallet.slice(0, 6)}…${wallet.slice(-4)}`) : 'Connect wallet'} <b>↗</b></button></div></header>
      <main>
        <section id="overview" className="overview-section"><div className="overview-heading"><div><div className="kicker"><span>01</span> DAILY BRIEFING / 24 NOV 2026</div><h1>Research the<br /><em>signal.</em></h1><p>A focused terminal for understanding tokenized stock activity on Base. Read the thesis before you make the move.</p></div><div className="market-state"><span>MARKET STATE</span><strong>Constructive</strong><small>Risk appetite is holding</small><div className="state-line"><i /><i /><i /><i /><i /><i /><i /></div></div></div><div className="tape"><span>MARKET TAPE</span>{Object.entries(assets).map(([symbol, item]) => <button key={symbol} onClick={() => pick(symbol)}><b>{symbol}</b><strong>{item.price}</strong><small className={item.change.startsWith('+') ? 'up' : 'down'}>{item.change}</small></button>)}<span className="tape-end">ILLUSTRATIVE DATA ↗</span></div></section>
        <section id="watchlist" className="research-grid"><div className="watchlist-panel panel"><div className="panel-head"><div><span className="kicker"><span>02</span> WATCHLIST</span><h2>Market <em>map</em></h2></div><span className="count">4 ASSETS</span></div><div className="asset-list">{Object.entries(assets).map(([symbol, item]) => <button key={symbol} className={`asset-row ${symbol === selected ? 'active' : ''}`} onClick={() => pick(symbol)}><span className={`asset-icon ${item.tone}`}>{symbol.slice(0, 1)}</span><span className="asset-name"><b>{symbol}</b><small>{item.name} / {item.sector}</small></span><span className="asset-price"><b>{item.price}</b><small className={item.change.startsWith('+') ? 'up' : 'down'}>{item.change}</small></span><span className="row-arrow">↗</span></button>)}</div><div className="panel-foot"><span>Curated universe</span><span>Updated {asset.time}</span></div></div><div className="chart-panel panel"><div className="panel-head chart-head"><div><span className="kicker"><span>SELECTED ASSET</span> / {asset.sector.toUpperCase()}</span><h2>{selected} <small>{asset.name}</small></h2></div><div className="asset-quote"><strong>{asset.price}</strong><span className={asset.change.startsWith('+') ? 'up' : 'down'}>{asset.change}</span></div></div><div className="chart-toolbar"><span>PRICE / BASE DEMO</span><div className="ranges">{['1W', '1M', '3M', '1Y'].map((item) => <button key={item} className={range === item ? 'active' : ''} onClick={() => setRange(item)}>{item}</button>)}</div></div><div className="chart"><div className="chart-y"><span>200</span><span>150</span><span>100</span><span>50</span></div><svg viewBox="0 0 728 90" preserveAspectRatio="none" role="img" aria-label={`Demo chart for ${selected}`}><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={asset.color} stopOpacity=".22" /><stop offset="1" stopColor={asset.color} stopOpacity="0" /></linearGradient></defs><polyline points={`4,90 ${asset.points} 724,90`} fill="url(#fill)" /><polyline points={asset.points} fill="none" stroke={asset.color} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg><div className="chart-x"><span>01 {range}</span><span>15 {range}</span><span>30 {range}</span></div></div><div className="chart-foot"><span><i className="legend-dot" style={{ background: asset.color }} /> Price movement</span><span>Volume {asset.volume} · {asset.time}</span></div></div></section>
        <section id="lens" className="lens-grid"><div className="thesis-copy"><div className="kicker"><span>03</span> INTELLIGENCE LAYER</div><h2>What is the<br /><em>thesis?</em></h2><p>Numbers become useful when they are placed in context. This brief compresses the signal into something you can challenge.</p><div className="method-note"><span>METHOD NOTE</span><b>Momentum + liquidity + volatility</b><small>Model output is illustrative and not financial advice.</small></div></div><div className="lens-panel panel"><div className="panel-head"><span className="kicker"><span>AI BRIEF</span> / {selected}</span><span className="model-tag">MODEL / DEMO</span></div><div className="score-row"><div className="score-ring" style={{ '--score': `${asset.score * 3.6}deg`, '--ring': asset.color }}><strong>{asset.score}</strong><small>/100</small></div><div><span className="muted-label">SIGNAL QUALITY</span><h3>{asset.risk} <span>risk</span></h3><p>{briefs[selected]}</p></div></div><div className="case-grid"><div><span>BULL CASE</span><b>{asset.bull}</b></div><div><span>BEAR CASE</span><b>{asset.bear}</b></div></div><div className="lens-metrics"><div><span>Momentum</span><b className={asset.change.startsWith('+') ? 'up' : 'down'}>{asset.change.startsWith('+') ? 'Positive' : 'Cooling'}</b></div><div><span>Liquidity</span><b>{asset.volume}</b></div><div><span>Network</span><b>Base Sepolia</b></div></div></div></section>
        <section id="simulate" className="lab-grid"><div><div className="kicker"><span>04</span> PAPER LAB</div><h2>Test the<br /><em>conviction.</em></h2><p>Model a position without connecting a wallet or placing an order. A safe surface for exploring the thesis.</p>{portfolio.length > 0 && <div className="portfolio-mini"><span>LOCAL PAPER PORTFOLIO</span>{portfolio.map((item) => <div key={item.symbol}><b>{item.symbol}</b><small>{item.units} units · ${item.notional.toLocaleString()} notional</small><strong className="up">+{assets[item.symbol].change}</strong></div>)}</div>}</div><div className="simulator panel"><div className="lab-title"><span>POSITION BUILDER</span><b>{wallet ? 'BASE SEPOLIA / READY' : 'NO WALLET REQUIRED'}</b></div><div className="selected-token"><span className={`asset-icon ${asset.tone}`}>{selected.slice(0, 1)}</span><div><b>{selected}</b><small>{asset.name} / {asset.price}</small></div><span className="token-network">BASE</span></div><label>PAPER BUDGET <output>${Number(budget).toLocaleString()}</output><input type="range" min="100" max="10000" step="100" value={budget} onChange={(e) => setBudget(e.target.value)} /></label><div className="sim-result"><div><span>EST. UNITS</span><strong>{allocation}</strong></div><div><span>NOTIONAL</span><strong>${Number(budget).toLocaleString()}</strong></div></div><button className="run-button" onClick={runSimulation}>{isSimulating ? 'CALCULATING…' : 'RUN PAPER TRADE'} <b>↗</b></button><button className="wallet-inline" onClick={connectWallet}>{wallet ? 'WALLET CONNECTED' : 'CONNECT BASE WALLET'} <b>↗</b></button>{notice && <p className="trade-notice">{notice}</p>}<p className="sim-note">Paper mode only. No transaction is signed. Base Sepolia integration is ready for a browser wallet.</p></div></section>
      </main><footer><span>STOCKLENS / ONCHAIN RESEARCH TERMINAL</span><span>BASE BUILD SPRINT / V0.2</span></footer></div>
  </div>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
