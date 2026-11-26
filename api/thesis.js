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

// A thesis is empty when it has no symbol, no title, and no note at all.
// This is the check that stops a repeat of the empty thesis created during
// the 26 Nov audit via POST {} (id th_68e55fb6-1cc4-4b2b-b8fd-f60d459e9539).
function hasContent(thesis) {
  return [thesis.symbol, thesis.title, thesis.note].some((value) => String(value || '').trim().length > 0)
}

function parseBody(request) {
  try {
    return typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {}
  } catch {
    return null
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
    // No DELETE endpoint by design (review fix, 26 Nov 2026): thesis ids
    // appear in public share links (?thesisId=), so anyone holding a link
    // could delete someone else's thesis and there is no ownership model
    // (no accounts, no recorded creator) to check against. The UI has no
    // delete button either, so a public DELETE would be pure attack
    // surface. Deletion is owner-only via the Vercel Blob dashboard
    // (Storage -> Blob -> stocklens/theses.json, remove the entry) — that
    // is also how the empty audit thesis th_68e55fb6… is removed.
    if (request.method !== 'POST' && request.method !== 'PUT') return response.status(405).json({ error: 'Method not allowed.' })
    const input = parseBody(request)
    if (input === null) return response.status(400).json({ error: 'Request body is not valid JSON.' })
    const id = request.method === 'PUT' ? clean(input.id, 100) : `th_${crypto.randomUUID()}`
    if (!id) return response.status(400).json({ error: 'Missing thesis id.' })
    const index = theses.findIndex((item) => item.id === id)
    // PUT must only update a thesis that already exists. It never creates
    // one: previously a PUT with a new id silently inserted a thesis, so
    // anyone who knew (or guessed) an id could plant content (audit C-1).
    if (request.method === 'PUT' && index < 0) return response.status(404).json({ persistent: true, error: 'Thesis not found.' })
    const next = sanitize(input, id)
    const merged = index >= 0 ? { ...theses[index], ...next } : next
    if (!hasContent(merged)) return response.status(400).json({ error: 'Thesis requires at least a symbol, title, or note.' })
    if (index >= 0) theses[index] = merged
    else theses.unshift(next)
    await put(PATH, JSON.stringify(theses.slice(0, MAX_ITEMS)), { access: 'private', addRandomSuffix: false, allowOverwrite: true, token, contentType: 'application/json' })
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).json({ persistent: true, thesis: index >= 0 ? theses[index] : next })
  } catch (error) {
    return response.status(500).json({ persistent: false, error: error instanceof Error ? error.message : 'Thesis persistence unavailable.' })
  }
}
