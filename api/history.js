import { Contract, JsonRpcProvider } from 'ethers'

const REGISTRY_ADDRESS = '0xA54A6c46Fc5c5D0f0Fca952f3445c35ad8e6dD1C'
const ABI = [
  'function thesisCount() view returns (uint256)',
  'function getThesis(uint256 thesisId) view returns (tuple(address researcher,string symbol,uint256 priceCents,int256 changeBps,uint8 riskScore,uint256 timestamp))',
]

function normalizeSymbol(symbol) {
  return { AAPLx: 'AAPLc', NVDAx: 'NVDAc', METAx: 'METAc', TSLAx: 'TSLAc' }[symbol] || symbol
}

export default async function handler(_request, response) {
  try {
    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
    const provider = new JsonRpcProvider(rpcUrl, 84532, { staticNetwork: true })
    const registry = new Contract(REGISTRY_ADDRESS, ABI, provider)
    const count = Number(await registry.thesisCount())
    const start = Math.max(0, count - 12)
    const rows = await Promise.all(Array.from({ length: count - start }, (_, index) => registry.getThesis(start + index)))
    const data = rows.map((row, index) => ({
      id: start + index, researcher: row.researcher, symbol: normalizeSymbol(row.symbol),
      price: Number(row.priceCents) / 100, change: Number(row.changeBps) / 100,
      score: Number(row.riskScore), timestamp: Number(row.timestamp) * 1000,
    })).reverse()
    response.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120')
    return response.status(200).json({ chainId: 84532, registry: REGISTRY_ADDRESS, data, source: rpcUrl === 'https://sepolia.base.org' ? 'Base Sepolia RPC' : 'Configured Base Sepolia RPC' })
  } catch (error) {
    return response.status(502).json({ error: 'Base Sepolia history unavailable', detail: error instanceof Error ? error.message : 'RPC error' })
  }
}
