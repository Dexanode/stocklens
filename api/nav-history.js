import { list, put } from '@vercel/blob'

const PATH = 'stocklens/nav-history.json'
const MAX_POINTS = 260
const MAX_AGE = 366 * 864e5

async function readHistory(token) {
  const result = await list({ prefix: PATH, token })
  const blob = result.blobs.find((item) => item.pathname === PATH)
  if (!blob) return {}
  const response = await fetch(blob.url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) return {}
  return await response.json()
}

export default async function handler(request, response) {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return response.status(200).json({ persistent: false, history: {}, warning: 'BLOB_READ_WRITE_TOKEN is not configured.' })
  try {
    const existing = await readHistory(token)
    const input = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {}
    const snapshots = input.snapshots && typeof input.snapshots === 'object' ? input.snapshots : {}
    const now = Date.now()
    const history = { ...existing }
    for (const [symbol, raw] of Object.entries(snapshots)) {
      const price = Number(raw?.price)
      if (!Number.isFinite(price) || price <= 0) continue
      const rows = Array.isArray(history[symbol]) ? history[symbol].filter((row) => now - Number(row.timestamp) <= MAX_AGE) : []
      if (!rows.length || now - Number(rows.at(-1).timestamp) >= 15 * 60e3) rows.push({ timestamp: now, price })
      history[symbol] = rows.slice(-MAX_POINTS)
    }
    await put(PATH, JSON.stringify(history), { access: 'private', addRandomSuffix: false, allowOverwrite: true, token, contentType: 'application/json' })
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).json({ persistent: true, history })
  } catch (error) {
    return response.status(200).json({ persistent: false, history: {}, warning: error instanceof Error ? error.message : 'Persistent history unavailable' })
  }
}
