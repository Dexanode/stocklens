// Pure, framework-free helper for the share-link flow (rev 6).
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
// paths (local-only theses, and orphan ids left over from the race):
//
//   resolveShareId(item, fetchFn) -> { serverId, thesis, editToken }
//   - item already has a th_ id: GET /api/thesis?id=<id> first. 200 ->
//     use it as-is (no POST, no duplicate). 404 -> re-create the thesis
//     with a POST and use the fresh server id (self-healing link).
//     Any other non-OK status (e.g. 503 store down) -> return "" and do
//     NOT post: minting a second record while the store is unhealthy
//     would only add a duplicate.
//   - item has only a client id (local-only thesis): POST it and use the
//     id the server assigns. The caller adopts the returned thesis +
//     token into local state (workspace + token map).
//   - server unreachable / POST fails / response has no id: return "" —
//     the caller falls back to the ?thesis= JSON link, which always
//     works, instead of handing out a ?thesisId= link that 404s.
//
// The editToken is never in the returned serverId and never in a link:
// it only travels from the POST response into the caller's token map.
export async function resolveShareId(item, fetchFn) {
  const hasServerId = typeof item?.id === 'string' && item.id.startsWith('th_')
  if (hasServerId) {
    try {
      const check = await fetchFn(`/api/thesis?id=${encodeURIComponent(item.id)}`)
      if (check.ok) return { serverId: item.id, thesis: null, editToken: null }
      if (check.status !== 404) return { serverId: '', thesis: null, editToken: null }
      // 404: the record is gone server-side; fall through and re-create
      // it below so the link points at a record that exists.
    } catch {
      return { serverId: '', thesis: null, editToken: null }
    }
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
