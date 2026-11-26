function price(value) {
  const parsed = Number(String(value ?? '').replace(/[$,]/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' })
  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {}
    const thesis = body.thesis || {}
    const market = body.market || {}
    const entry = price(thesis.entryPriceValue ?? thesis.entryPrice)
    const current = price(market.price)
    const change = entry && current ? ((current - entry) / entry) * 100 : null
    let nextAction = 'Monitor the signal against the original thesis.'
    let reviewWindow = 'Review in 48 hours'
    let triggers = ['New NAV observation', 'Material change in risk score']
    if (thesis.status === 'CLOSED' || thesis.status === 'INVALIDATED') {
      nextAction = 'Write a short post-mortem and keep the thesis closed.'
      reviewWindow = 'No active review'
      triggers = ['New thesis required to reopen']
    } else if (change === null) {
      nextAction = 'Wait for a fresh NAV observation before judging the outcome.'
      reviewWindow = 'After next NAV update'
      triggers = ['NAV becomes available', 'History reaches a new observation']
    } else if (change <= -5) {
      nextAction = 'Reassess the invalidation condition before adding risk.'
      reviewWindow = 'Review today'
      triggers = [`Return is ${change.toFixed(2)}% since entry`, 'Risk score moves higher']
    } else if (change >= 5) {
      nextAction = 'Review whether the catalyst still supports the current conviction.'
      reviewWindow = 'Review within 24 hours'
      triggers = [`Return is +${change.toFixed(2)}% since entry`, 'Momentum changes direction']
    }
    return response.status(200).json({
      source: 'Deterministic follow-up / market snapshot',
      confidence: current ? 76 : 48,
      nextAction,
      reviewWindow,
      triggers,
      changeSinceEntry: change,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    return response.status(400).json({ error: error instanceof Error ? error.message : 'Follow-up unavailable.' })
  }
}
