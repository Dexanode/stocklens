import { isBlockedCountry } from './lib/geo.js'
import { checkRateLimit } from './lib/rate-limit.js'
import { navFreshness } from '../src/market-freshness.js'
import { dataQualityScore } from '../src/data-quality.js'

// Best-effort per-IP limit (in-memory, per serverless instance — see
// api/lib/rate-limit.js). 30 req/min/IP keeps normal research use working
// while stopping a single IP from draining VIKEY_API_KEY (audit C-2).
const RATE_LIMIT = { limit: 30, windowMs: 60_000, keyPrefix: 'risk' }

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
  const hours = asset.navUpdatedAt ? Math.max(0, (Date.now() - Date.parse(asset.navUpdatedAt)) / 36e5) : Infinity
  const history = asset.dataQuality?.history === true
  const change = asset.dataQuality?.change === true
  const paused = Array.isArray(asset.pausedFeatures) && asset.pausedFeatures.length > 0
  const score = dataQualityScore(asset)
  const confidence = Math.min(score, 75)
  const navStatus = navFreshness(asset)
  const navDescription = { current: 'The NAV source timestamp is within the last hour.', delayed: 'The NAV source timestamp is over one hour old; the reference is delayed.', unknown: 'The NAV source timestamp is unavailable or invalid.', unavailable: 'No usable NAV reference is available.' }[navStatus]
  const missing = [
    asset.dataQuality?.history === false ? 'NAV history' : '',
    asset.dataQuality?.change === false ? 'price change' : '',
    paused ? 'paused features' : '',
  ].filter(Boolean)
  return {
    summary: compact(`${asset.symbol} has a ${score}/100 data-availability score. Asset risk is not assessed. ${navDescription} ${missing.length ? `Missing ${missing.join(' and ')} limits trend confidence.` : 'The available reference fields are internally consistent.'}`, 300),
    bull: navStatus === 'current' ? 'The source supplied a recent NAV reference for this asset.' : navDescription,
    bear: 'NAV is a reference value, not a bid, ask, or guaranteed fill price.',
    risk: 'Unknown',
    score,
    confidence,
    catalysts: [
      navStatus === 'current' ? `NAV source timestamp is ${Math.round(hours * 10) / 10}h old.` : 'A recent NAV print would improve signal quality.',
      history ? 'Persistent NAV history is available for trend comparison.' : 'A second NAV observation would improve trend analysis.',
    ].map((item) => compact(item, 120)),
    risks: [
      missing.length ? `Model inputs missing: ${missing.join(', ')}.` : 'No bid, ask, holder, or redemption data is supplied.',
      paused ? 'The token reports paused features; treat the reference as constrained.' : 'Model output can lag sudden market changes.',
    ].map((item) => compact(item, 120)),
    portfolioRationale: compact('Keep sizing proportional to data confidence; this is a paper-only research signal, not an execution recommendation.', 240),
    navStatus,
    source: 'StockLens deterministic data model',
    fallback: true,
    method: 'Data availability: NAV, recent timestamp, NAV history and comparison change (25 points each)',
    scoreBasis: { nav: navStatus !== 'unavailable', current: navStatus === 'current', history, change },
    fallbackReason: compact(reason, 120),
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' })
  // Geo-block enforced from the Vercel IP header, not the self-declared
  // client header (audit C-3). See api/lib/geo.js.
  if (isBlockedCountry(request).blocked) return response.status(451).json({ error: 'Research access is unavailable in the United States.' })
  const rate = checkRateLimit(request, RATE_LIMIT)
  response.setHeader('X-RateLimit-Remaining', String(Math.max(0, rate.remaining)))
  response.setHeader('X-RateLimit-Reset', String(Math.ceil(rate.resetAt / 1000)))
  if (rate.limited) {
    response.setHeader('Retry-After', String(rate.retryAfterSeconds))
    return response.status(429).json({ error: 'Rate limit exceeded. Try again shortly.', retryAfterSeconds: rate.retryAfterSeconds })
  }

  // Parse the body once, up front. The old handler re-parsed it inside the
  // catch block, so an invalid-JSON body threw again inside catch and the
  // client got a bare 500 with no JSON (audit M-5).
  let input = null
  try {
    input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
  } catch {
    return response.status(400).json({ error: 'Request body is not valid JSON' })
  }

  try {
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
      risk: 'Unknown',
      score: Number.isFinite(Number(asset.score)) ? Number(asset.score) : 50,
      volume: String(asset.volume || 'Unavailable').slice(0, 32),
      navUpdatedAt: String(asset.navUpdatedAt || '').slice(0, 40),
      navStatus: navFreshness(asset),
      totalSupply: Number.isFinite(Number(asset.totalSupply)) ? Number(asset.totalSupply) : null,
      multiplier: Number.isFinite(Number(asset.multiplier)) ? Number(asset.multiplier) : null,
      pausedFeatures: Array.isArray(asset.pausedFeatures) ? asset.pausedFeatures.slice(0, 6) : [],
      dataQuality: asset.dataQuality || {},
    }
    const navStatus = navFreshness(compactAsset)
    if (navStatus !== 'current') return response.status(200).json(fallbackRisk(compactAsset, `NAV ${navStatus}: using a deterministic brief until the source timestamp is current`))
    if (!process.env.VIKEY_API_KEY) return response.status(200).json(fallbackRisk(compactAsset, 'VIKEY_API_KEY is not configured'))
    const upstream = await fetch('https://api-plan.vikey.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.VIKEY_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'vikey/plan',
        max_tokens: 2400,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: 'You are StockLens Research AI. Return only valid JSON with exactly these keys: summary (string), bull (string), bear (string), risk (string), score (integer 0-100), confidence (integer 0-100), catalysts (array of 2 concise strings), risks (array of 2 concise strings), portfolioRationale (string). Do not assess asset risk or describe any asset as low-risk, safe, or high-risk. Do not invent or state a numeric score. Ground the brief only in the supplied B20 NAV, supply, multiplier, pause, freshness and data-quality fields. The NAV status and timestamp are supplied explicitly; never call delayed or unknown data current. If history or change is unavailable, say so explicitly and lower confidence. Never invent news, fundamentals, ownership, or live events. This is educational research, not financial advice.' }, { role: 'user', content: JSON.stringify(compactAsset) }],
      }),
      // Bound the upstream call so a slow Vikey cannot hang the function
      // into a Vercel timeout (audit C-2). 15s: the single-asset brief is
      // quick, but the original 8s cap risked needless fallbacks on slow
      // upstreams. vercel.json allows 30s for this route, so 15s leaves
      // room for the response to be parsed and returned.
      signal: AbortSignal.timeout(15000),
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
    const normalizedScore = dataQualityScore(compactAsset)
    const confidenceMap = { low: 35, medium: 60, high: 80 }
    const rawConfidence = Number(result.confidence)
    const normalizedConfidence = Math.min(normalizedScore, Number.isFinite(rawConfidence) ? Math.round(clamp(rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence, 0, 100)) : (confidenceMap[String(result.confidence || '').toLowerCase()] || 50))
    const prose = [result.summary, result.bull, result.bear, ...result.catalysts, ...result.risks, result.portfolioRationale].join(' ')
    if (/(?:low(?:er)?|high(?:er)?|moderate|elevated|safe)\s*[- ]?\s*risk|risk\s*(?:is|:|of)?\s*(?:low(?:er)?|high(?:er)?|moderate|elevated)|\b\d{1,3}\s*\/\s*100/i.test(prose)) {
      return response.status(200).json(fallbackRisk(compactAsset, 'Model made an unsupported risk or score claim'))
    }
    const compactResult = {
      ...result,
      summary: compact(result.summary, 300),
      bull: compact(result.bull, 190),
      bear: compact(result.bear, 190),
      catalysts: Array.isArray(result.catalysts) ? result.catalysts.slice(0, 2).map((item) => compact(item, 120)) : [],
      risks: Array.isArray(result.risks) ? result.risks.slice(0, 2).map((item) => compact(item, 120)) : [],
      portfolioRationale: compact(result.portfolioRationale, 240),
      risk: 'Unknown',
      score: normalizedScore,
      confidence: normalizedConfidence,
      navStatus,
      method: 'Data availability: NAV, recent timestamp, NAV history and comparison change (25 points each)',
      source: 'Vikey Research AI',
      fallback: false,
    }
    response.status(200).json(compactResult)
  } catch (error) {
    const asset = input?.asset || {}
    response.status(200).json(fallbackRisk(asset, error instanceof Error ? error.message : 'Unable to parse Vikey response'))
  }
}
