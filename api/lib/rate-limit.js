// Best-effort per-IP rate limiting for the Vikey-backed routes (risk, portfolio).
//
// In-memory only: each serverless instance keeps its own counters, so this is
// NOT a hard guarantee across Vercel's fleet — requests spread across many
// instances can exceed the nominal limit. It stops casual abuse and a
// single-IP key-drain of VIKEY_API_KEY (audit C-2), which is the threat that
// matters before the 5 Dec demo. For a hard guarantee, move the counters to
// Upstash Redis / Vercel KV and key them the same way.

const buckets = new Map() // key -> { count, resetAt }

function clientIp(request) {
  const forwarded = request?.headers?.['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
  return request?.socket?.remoteAddress || 'unknown'
}

export function checkRateLimit(request, { limit, windowMs, keyPrefix }) {
  if (buckets.size > 5000) {
    const now = Date.now()
    for (const [key, bucket] of buckets) if (now >= bucket.resetAt) buckets.delete(key)
  }
  const key = `${keyPrefix}:${clientIp(request)}`
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    const resetAt = now + windowMs
    buckets.set(key, { count: 1, resetAt })
    return { limited: false, remaining: limit - 1, resetAt, retryAfterSeconds: 0 }
  }
  if (bucket.count >= limit) {
    return { limited: true, remaining: 0, resetAt: bucket.resetAt, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) }
  }
  bucket.count += 1
  return { limited: false, remaining: limit - bucket.count, resetAt: bucket.resetAt, retryAfterSeconds: 0 }
}
