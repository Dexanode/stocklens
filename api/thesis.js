import { list, put } from '@vercel/blob'

const PATH = 'stocklens/theses.json'
const MAX_ITEMS = 500

async function readTheses(token) {
  const result = await list({ prefix: PATH, token })
  const blob = result.blobs.find((item) => item.pathname === PATH)
  if (!blob) return []
  const response = await fetch(blob.url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) return []
  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max)
}

function sanitize(input, id) {
  return {
    id,
    symbol: clean(input.symbol, 20),
    assetName: clean(input.assetName, 100),
    title: clean(input.title, 160),
    note: clean(input.note, 1200),
    conviction: Math.min(5, Math.max(1, Number(input.conviction) || 3)),
    status: ['OPEN', 'MONITORING', 'INVALIDATED', 'CLOSED'].includes(input.status) ? input.status : 'OPEN',
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    entryPrice: clean(input.entryPrice, 40),
    entryPriceValue: Number.isFinite(Number(input.entryPriceValue)) ? Number(input.entryPriceValue) : null,
    score: Number.isFinite(Number(input.score)) ? Number(input.score) : null,
    risk: clean(input.risk, 40),
    change: clean(input.change, 40),
    target: input.target === null || input.target === undefined ? null : Number(input.target),
    source: clean(input.source, 80),
    lastReviewedAt: input.lastReviewedAt || null,
    lastReviewedPrice: input.lastReviewedPrice || null,
    reviewCount: Math.max(0, Number(input.reviewCount) || 0),
  }
}

export default async function handler(request, response) {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return response.status(503).json({ persistent: false, error: 'BLOB_READ_WRITE_TOKEN is not configured.' })
  try {
    const theses = await readTheses(token)
    if (request.method === 'GET') {
      const id = clean(request.query?.id, 100)
      const thesis = theses.find((item) => item.id === id)
      if (!thesis) return response.status(404).json({ persistent: true, error: 'Thesis not found.' })
      response.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=300')
      return response.status(200).json({ persistent: true, thesis })
    }
    if (request.method !== 'POST' && request.method !== 'PUT') return response.status(405).json({ error: 'Method not allowed.' })
    const input = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {}
    const id = request.method === 'PUT' ? clean(input.id, 100) : `th_${crypto.randomUUID()}`
    if (!id) return response.status(400).json({ error: 'Missing thesis id.' })
    const next = sanitize(input, id)
    const index = theses.findIndex((item) => item.id === id)
    if (index >= 0) theses[index] = { ...theses[index], ...next }
    else theses.unshift(next)
    await put(PATH, JSON.stringify(theses.slice(0, MAX_ITEMS)), { access: 'private', addRandomSuffix: false, allowOverwrite: true, token, contentType: 'application/json' })
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).json({ persistent: true, thesis: index >= 0 ? theses[index] : next })
  } catch (error) {
    return response.status(500).json({ persistent: false, error: error instanceof Error ? error.message : 'Thesis persistence unavailable.' })
  }
}
