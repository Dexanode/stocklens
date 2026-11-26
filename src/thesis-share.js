// Pure, framework-free helper for the share-link flow (rev 7).
//
// The problem it fixes: a workspace copy can hold a server id whose
// record no longer exists server-side. That happened live 26 Nov 2026 —
// the run-2 thesis "PR1 retest 2" was shared as ?thesisId=th_f4005b18…,
// but the store holds that thesis under th_4e47756f…, so the link 404s
// for every recipient while the browser happily shows it as shared. The
// record was minted by a share POST and then wiped by a later PUT whose
// read-modify-write ran on a stale list (the pre-rev-6 lost-update race).
// saveThesis already adopts the server id from the POST response, so a
// freshly saved thesis links correctly; this helper covers the remaining
// paths (local-only theses, and orphan ids left over from the race).
//
// Rev 7 corrects rev 6's verification in two ways, after live proof on
// 26 Nov 2026 that Blob reads lag writes by ~10–25 s (a GET of a
// just-created id 404'd at +24 s and returned 200 at +40 s):
//   1. A single 404 NEVER concludes "missing". The verify GET is
//      retried on a bounded schedule (default offsets [0, 500, 1500,
//      3000] ms — ~3 s worst case); only when every attempt 404s do we
//      treat the record as gone. A non-404 failure (503/500, network
//      error) never concludes anything: it returns "" and the caller
//      falls back to the ?thesis= JSON link instead of minting while
//      the store is unhealthy.
//   2. Before re-creating, check the list for a record with the same
//      CONTENT (same id first, then same symbol + title + note +
//      createdAt + entry price). Rev 6 re-created on the first 404 and
//      stored the same thesis twice (th_e27e0fe5… + th_d6c52364…,
//      identical title/note/createdAt) because the verify read was
//      stale. The dedup check also covers local-only theses: a record
//      may already exist server-side under a server id (e.g. its
//      creation POST returned a rev-6 503 while the record landed), so
//      a local-only item is listed first and adopted when it matches,
//      not blindly POSTed.
//
//   resolveShareId(item, fetchFn, options?) -> { serverId, thesis, editToken }
//   - item already has a th_ id: GET-verify with retries (200 -> use
//     it as-is, no POST, no duplicate); all-404 -> list dedup check
//     (match -> adopt that id); no match -> re-create with a POST and
//     use the fresh server id (self-healing link).
//   - item has only a client id: list dedup check first (match ->
//     adopt it), then POST and use the id the server assigns.
//   - server unreachable / POST fails / response has no id / list
//     check fails: return "" — the caller falls back to the ?thesis=
//     JSON link, which always works, instead of handing out a
//     ?thesisId= link that 404s or minting a duplicate blind.
//
// The editToken is never in the returned serverId and never in a link:
// it only travels from the POST response into the caller's token map.
// `options.verifyDelaysMs` overrides the retry schedule (tests pass
// [0] to keep runs instant); the defaults apply in the app.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// GET-verify one id, retried on a bounded schedule. Returns 'found'
// (a 200 at any attempt), 'missing' (every attempt 404'd), or
// 'unknown' (any attempt failed differently — store unhealthy or
// unreachable — so "missing" cannot be concluded).
async function verifyId(id, fetchFn, delaysMs) {
  let sawError = false
  for (let i = 0; i < delaysMs.length; i++) {
    if (i > 0) await sleep(delaysMs[i] - delaysMs[i - 1])
    let check
    try {
      check = await fetchFn(`/api/thesis?id=${encodeURIComponent(id)}`)
    } catch {
      sawError = true
      continue
    }
    if (check.ok) return 'found'
    if (check.status !== 404) sawError = true
  }
  return sawError ? 'unknown' : 'missing'
}

// Two records are the same thesis when their stable content matches:
// symbol + title + note + createdAt (set once, at creation, and never
// edited by status/review updates) + entry price when both carry one.
// createdAt is the discriminator that keeps two theses with the same
// title/note apart.
function contentMatches(a, b) {
  if (!a || !b) return false
  return a.symbol === b.symbol
    && a.title === b.title
    && a.note === b.note
    && a.createdAt === b.createdAt
    && (a.entryPriceValue ?? null) === (b.entryPriceValue ?? null)
}

// Look for `item` in the server list, by id first, then by content.
// Returns { status: 'found', id, thesis }, { status: 'none' }, or
// { status: 'unknown' } when the list itself could not be read (the
// caller must then NOT re-create blindly).
async function findContentMatch(item, fetchFn) {
  let listRes
  try {
    listRes = await fetchFn('/api/thesis')
  } catch {
    return { status: 'unknown' }
  }
  if (!listRes?.ok) return { status: 'unknown' }
  let payload
  try {
    payload = await listRes.json()
  } catch {
    return { status: 'unknown' }
  }
  const theses = Array.isArray(payload?.theses) ? payload.theses : []
  const byId = item?.id ? theses.find((row) => row.id === item.id) : null
  if (byId) return { status: 'found', id: byId.id, thesis: byId }
  const byContent = theses.find((row) => contentMatches(row, item))
  if (byContent) return { status: 'found', id: byContent.id, thesis: byContent }
  return { status: 'none' }
}

export async function resolveShareId(item, fetchFn, options = {}) {
  const verifyDelaysMs = options.verifyDelaysMs ?? [0, 500, 1500, 3000]
  const hasServerId = typeof item?.id === 'string' && item.id.startsWith('th_')
  if (hasServerId) {
    const state = await verifyId(item.id, fetchFn, verifyDelaysMs)
    if (state === 'found') return { serverId: item.id, thesis: null, editToken: null }
    if (state === 'unknown') return { serverId: '', thesis: null, editToken: null }
    // 'missing' after every retry: check the list before concluding
    // the record is gone — the verify reads may all have been stale.
    const match = await findContentMatch(item, fetchFn)
    if (match.status === 'found') return { serverId: match.id, thesis: match.thesis, editToken: null }
    if (match.status === 'unknown') return { serverId: '', thesis: null, editToken: null }
    // No match anywhere: re-create below.
  } else {
    // Local-only thesis: it may already exist server-side under a
    // server id (e.g. its creation POST failed in rev 6 while the
    // record landed). Adopt the match instead of minting a duplicate.
    const match = await findContentMatch(item, fetchFn)
    if (match.status === 'found') return { serverId: match.id, thesis: match.thesis, editToken: null }
    if (match.status === 'unknown') return { serverId: '', thesis: null, editToken: null }
  }
  try {
    const response = await fetchFn('/api/thesis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    })
    if (!response.ok) return { serverId: '', thesis: null, editToken: null }
    const payload = await response.json()
    if (!payload?.thesis?.id) return { serverId: '', thesis: null, editToken: null }
    return { serverId: payload.thesis.id, thesis: payload.thesis, editToken: payload.editToken || null }
  } catch {
    return { serverId: '', thesis: null, editToken: null }
  }
}
