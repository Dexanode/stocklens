import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walletIsOnBaseSepolia, guardedWalletProvider } from '../src/wallet-network.js'

test('requires connected account, connector, and provider to agree on Base Sepolia', async () => {
  const provider = (chain) => ({ request: async () => chain })
  const connector = (chain) => ({ getChainId: async () => chain })
  assert.equal(await walletIsOnBaseSepolia(connector(84532), provider('0x14a34'), 84532), true)
  assert.equal(await walletIsOnBaseSepolia(connector(999), provider('0x14a34'), 84532), false)
  assert.equal(await walletIsOnBaseSepolia(connector(84532), provider('0x3e7'), 84532), false)
  assert.equal(await walletIsOnBaseSepolia(connector(84532), provider('0x14a34'), 999), false)
  assert.equal(await walletIsOnBaseSepolia(null, null, 84532), false)
})

test('checks network and account again immediately before sending', async () => {
  let chain = '0x14a34'
  let sent = 0
  const account = '0xAbC'
  const provider = { request: async ({ method }) => {
    if (method === 'eth_chainId') return chain
    if (method === 'eth_accounts') return [account]
    if (method === 'eth_sendTransaction') { sent++; return 'hash' }
  } }
  const connector = { getChainId: async () => 84532 }
  const guarded = guardedWalletProvider(connector, provider, 84532, account)
  const tx = { method: 'eth_sendTransaction', params: [{ from: account }] }
  chain = '0x3e7'
  await assert.rejects(guarded.request(tx), /Base Sepolia/)
  assert.equal(sent, 0)
  chain = '0x14a34'
  await assert.rejects(guarded.request({ ...tx, params: [{ from: '0xdef' }] }), /account changed/)
  assert.equal(sent, 0)
  assert.equal(await guarded.request(tx), 'hash')
  assert.equal(sent, 1)
})
