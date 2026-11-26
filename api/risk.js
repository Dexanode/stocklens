MallocNanoZone=0
NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S=461c4ba94b821ec805da79c8e8138fe510b1b3358609fc93da47387a2cf3fbf3,6d25aa7656feac858f3a3bdaea5bcbab0dbfd426c9de8e6931ce90c399ee8e4f
NO_COLOR=1
NoDefaultCurrentDirectoryInExePath=1
OLDPWD=/Users/dexa/OpenBot/Agents/agent-1e0da785-6ac6-469e-8b50-ccfa26ddeb1d/stocklens
OPENBOT_AGENT_PROCESS=1
PAGER=cat
PATH=$'/Applications/Wine \nStaging.app/Contents/Resources/wine/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/Users/dexa/Library/Application Support/OpenBot/provider-runtimes/codex/darwin-arm64/0.172.0/codex-path:/Users/dexa/.codex/tmp/arg0-macos/codex-arg00VuJF4:/opt/homebrew/bin:/opt/homebrew/sbin:/Users/dexa/.cargo/bin:/Users/dexa/Library/Python/3.9/bin:/Users/dexa/.foundry/bin:/Users/dexa/tizen-studio/tools/ide/bin:/Users/dexa/tizen-studio/tools'
PWD=/Users/dexa/OpenBot/Agents/agent-1e0da785-6ac6-469e-8b50-ccfa26ddeb1d/stocklens
SHELL=/bin/zsh
SHLVL=1
SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.LAlBoNYgeX/Listeners
TERM=dumb
TMPDIR=/var/folders/93/yn8h0ylj4tn60nmq57hqmvrm0000gn/T/
USER=dexa
XPC_FLAGS=0x0
XPC_SERVICE_NAME=application.app.openbot.desktop.164698546.164698552
__CFBundleIdentifier=app.openbot.desktop
__CF_USER_TEXT_ENCODING=0x1F5:0x0:0x0
function compact(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function parseModelJson(content) {
  if (Array.isArray(content)) return parseModelJson(content.map((part) => part?.text || part?.content || '').join(''))
  if (content && typeof content === 'object' && (content.text || content.content)) return parseModelJson(content.text || content.content)
  if (content && typeof content === 'object') return content
  const text = String(content || '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Vikey returned no JSON object')
  return JSON.parse(text.slice(start, end + 1))
}

function fallbackRisk(asset, reason = 'Vikey unavailable') {
  const price = Number(String(asset.price || '').replace(/[$,]/g, ''))
  const supply = Number(asset.totalSupply || 0)
  const hours = asset.navUpdatedAt ? Math.max(0, (Date.now() - Date.parse(asset.navUpdatedAt)) / 36e5) : Infinity
  const freshness = Number.isFinite(hours) ? Math.round(clamp(30 - hours * 2, 0, 30)) : 0
  const supplySignal = Number.isFinite(price) && price > 0 && supply > 0 ? Math.round(clamp(Math.log10(Math.max(1, price * supply)) * 5, 0, 35)) : 0
  const history = asset.dataQuality?.history === true ? 10 : 0
  const change = asset.dataQuality?.change === true ? 5 : 0
  const paused = Array.isArray(asset.pausedFeatures) && asset.pausedFeatures.length ? -25 : 0
  const score = Math.round(clamp(35 + freshness + supplySignal + history + change + paused, 0, 100))
  const risk = score >= 75 ? 'Lower' : score >= 55 ? 'Moderate' : score >= 35 ? 'Elevated' : 'High'
  const confidence = Math.round(clamp(25 + (asset.dataQuality?.nav !== false ? 25 : 0) + (history ? 20 : 0) + (change ? 10 : 0) + (paused ? 0 : 10), 20, 90))
  const missing = [
    asset.dataQuality?.history === false ? 'NAV history' : '',
    asset.dataQuality?.change === false ? 'price change' : '',
    paused ? 'paused features' : '',
  ].filter(Boolean)
  return {
    summary: compact(`${asset.symbol} receives a ${score}/100 ${risk.toLowerCase()}-risk signal from live NAV quality, freshness, supply and token status. ${missing.length ? `Missing ${missing.join(' and ')} limits trend confidence.` : 'The available reference fields are internally consistent.'}`, 300),
    bull: asset.dataQuality?.nav !== false ? 'The asset has a live NAV reference and a verified B20 contract on Base mainnet.' : 'Contract identity remains available, but live NAV is not confirmed.',
    bear: 'NAV is a reference value, not a bid, ask, or guaranteed fill price.',
    risk,
    score,
    confidence,
    catalysts: [
      freshness > 0 ? `NAV print is fresh within the model freshness window (${Math.round(hours * 10) / 10}h old).` : 'A new NAV print would improve signal quality.',
      history ? 'Persistent NAV history is available for trend comparison.' : 'A second NAV observation would improve trend analysis.',
    ].map((item) => compact(item, 120)),
    risks: [
      missing.length ? `Model inputs missing: ${missing.join(', ')}.` : 'No bid, ask, holder, or redemption data is supplied.',
      paused ? 'The token reports paused features; treat the reference as constrained.' : 'Model output can lag sudden market changes.',
    ].map((item) => compact(item, 120)),
    portfolioRationale: compact('Keep sizing proportional to data confidence; this is a paper-only research signal, not an execution recommendation.', 240),
    source: 'StockLens deterministic risk model',
    fallback: true,
    method: 'NAV freshness + supply + history/change availability + paused-feature penalty',
    scoreBasis: { freshness, supply: supplySignal, history, change, paused },
    fallbackReason: compact(reason, 120),
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' })
  if (String(request.headers['x-stocklens-country'] || '').toUpperCase() === 'US') return response.status(451).json({ error: 'Research access is unavailable in the United States.' })

  try {
    const input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
    const asset = input?.asset
    if (!asset?.symbol || !asset?.price || !asset?.change) {
      return response.status(400).json({ error: 'Asset payload requires symbol, price, and change' })
    }
    const compactAsset = {
      symbol: String(asset.symbol).slice(0, 24),
      name: String(asset.name || asset.symbol).slice(0, 80),
      sector: String(asset.sector || 'Tokenized equity').slice(0, 80),
      price: String(asset.price).slice(0, 32),
      change: String(asset.change).slice(0, 32),
      risk: String(asset.risk || 'Moderate').slice(0, 24),
      score: Number.isFinite(Number(asset.score)) ? Number(asset.score) : 50,
      volume: String(asset.volume || 'Unavailable').slice(0, 32),
      navUpdatedAt: String(asset.navUpdatedAt || '').slice(0, 40),
      totalSupply: Number.isFinite(Number(asset.totalSupply)) ? Number(asset.totalSupply) : null,
      multiplier: Number.isFinite(Number(asset.multiplier)) ? Number(asset.multiplier) : null,
      pausedFeatures: Array.isArray(asset.pausedFeatures) ? asset.pausedFeatures.slice(0, 6) : [],
      dataQuality: asset.dataQuality || {},
    }
    if (!process.env.VIKEY_API_KEY) return response.status(200).json(fallbackRisk(compactAsset, 'VIKEY_API_KEY is not configured'))
    const upstream = await fetch('https://api-plan.vikey.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.VIKEY_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'vikey/plan',
        max_tokens: 900,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: 'You are StockLens Research AI. Return only valid JSON with exactly these keys: summary (string), bull (string), bear (string), risk (one of Lower, Moderate, Elevated, High), score (integer 0-100), confidence (integer 0-100), catalysts (array of 2 concise strings), risks (array of 2 concise strings), portfolioRationale (string). Ground the brief only in the supplied B20 NAV, supply, multiplier, pause, freshness and data-quality fields. If history or change is unavailable, say so explicitly and lower confidence. Never invent news, fundamentals, ownership, or live events. This is educational research, not financial advice.' }, { role: 'user', content: JSON.stringify(compactAsset) }],
      }),
    })
    if (!upstream.ok) {
      const detail = await upstream.text()
      return response.status(200).json(fallbackRisk(compactAsset, `Vikey request failed (${upstream.status})`))
    }
    const payload = await upstream.json()
    const content = payload.choices?.[0]?.message?.content
    const result = parseModelJson(content)
    if (!result?.summary || !result?.bull || !result?.bear || !Array.isArray(result?.catalysts) || !Array.isArray(result?.risks)) {
      return response.status(200).json(fallbackRisk(compactAsset, 'Vikey returned incomplete research JSON'))
    }
    const rawScore = Number(result.score)
    const normalizedScore = Number.isFinite(rawScore) ? Math.round(clamp(rawScore <= 10 ? rawScore * 10 : rawScore, 0, 100)) : compactAsset.score
    const confidenceMap = { low: 35, medium: 60, high: 80 }
    const rawConfidence = Number(result.confidence)
    const normalizedConfidence = Number.isFinite(rawConfidence) ? Math.round(clamp(rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence, 0, 100)) : (confidenceMap[String(result.confidence || '').toLowerCase()] || 50)
    const riskToken = String(result.risk || '').trim().split(/[.\s]/)[0]
    const normalizedRisk = ['Lower', 'Moderate', 'Elevated', 'High'].includes(riskToken) ? riskToken : (normalizedScore >= 75 ? 'Lower' : normalizedScore >= 55 ? 'Moderate' : normalizedScore >= 35 ? 'Elevated' : 'High')
    const compactResult = {
      ...result,
      summary: compact(result.summary, 300),
      bull: compact(result.bull, 190),
      bear: compact(result.bear, 190),
      catalysts: Array.isArray(result.catalysts) ? result.catalysts.slice(0, 2).map((item) => compact(item, 120)) : [],
      risks: Array.isArray(result.risks) ? result.risks.slice(0, 2).map((item) => compact(item, 120)) : [],
      portfolioRationale: compact(result.portfolioRationale, 240),
      risk: normalizedRisk,
      score: normalizedScore,
      confidence: normalizedConfidence,
      source: 'Vikey Research AI',
      fallback: false,
    }
    response.status(200).json(compactResult)
  } catch (error) {
    const input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
    const asset = input?.asset || {}
    response.status(200).json(fallbackRisk(asset, error instanceof Error ? error.message : 'Unable to parse Vikey response'))
  }
}
