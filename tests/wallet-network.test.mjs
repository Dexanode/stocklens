import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walletIsOnBaseSepolia } from '../src/wallet-network.js'

test('requires connected account, connector, and provider to agree on Base Sepolia', async () => {
  const provider = (chain) => ({ request: async () => chain })
  const connector = (chain) => ({ getChainId: async () => chain })
  assert.equal(await walletIsOnBaseSepolia(connector(84532), provider('0x14a34'), 84532), true)
  assert.equal(await walletIsOnBaseSepolia(connector(999), provider('0x14a34'), 84532), false)
  assert.equal(await walletIsOnBaseSepolia(connector(84532), provider('0x3e7'), 84532), false)
  assert.equal(await walletIsOnBaseSepolia(connector(84532), provider('0x14a34'), 999), false)
  assert.equal(await walletIsOnBaseSepolia(null, null, 84532), false)
})
