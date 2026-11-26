# StockLens

StockLens is a paper-only research terminal for Coinbase B20 tokenized-stock reference data on Base. It combines live NAV context, persistent history, risk research, AI-assisted allocation, thesis tracking, and reversible paper rebalancing.

## Networks

- B20 NAV/reference data: Base mainnet (`8453`), read from the Coinbase Tokenized Stocks API.
- Wallet, paper USDC balance, and thesis registry: Base Sepolia (`84532`).
- Registry: `0xA54A6c46Fc5c5D0f0Fca952f3445c35ad8e6dD1C`.

The NAV is a reference value, not a quote, bid, ask, or guaranteed fill price. StockLens does not execute trades or custody assets. Access is blocked for US users/persons and the app is educational, not financial advice.

## Product flow

1. Read the B20 market and select an asset.
2. Inspect NAV history, dynamic risk context, and the AI brief.
3. Run the Portfolio Agent with price change, NAV history, volatility, supply, freshness, and current paper holdings.
4. Preview the current-vs-target allocation before applying it to the local paper book.
5. Save, review, share, and monitor a thesis.

## Run locally

```bash
npm install
npm run dev
```

Required production variables:

```text
VIKEY_API_KEY=...
BLOB_READ_WRITE_TOKEN=...
VITE_WALLETCONNECT_PROJECT_ID=...
```

Optional reliability setting for the history proxy:

```text
BASE_SEPOLIA_RPC_URL=https://your-sepolia-rpc.example
```

Optional:

```text
```

`VITE_WALLETCONNECT_PROJECT_ID` must be a real 32-character WalletConnect project ID. The UI disables the modal fallback when it is not configured.
```

## API routes

- `/api/market` — B20 universe and live NAV metadata.
- `/api/risk` — asset research brief through Vikey with deterministic fallback.
- `/api/portfolio` — AI allocation and rebalance proposal using NAV history and volatility.
- `/api/nav-history` — persistent NAV snapshots through private Vercel Blob.
- `/api/thesis` — server-side thesis persistence and shareable thesis pages.
- `/api/follow-up` — deterministic thesis follow-up and review triggers.
- `/api/history` — Base Sepolia registry history through a server-side RPC.

## Safety and scope

All simulated positions are paper-only. The app shows data availability explicitly, keeps unavailable changes neutral, uses dynamic chart axes, and never presents missing history as a real trend. Onchain history is read-only from the app; the optional registry write is a user-confirmed Base Sepolia proof.

## Verification links

- [BaseScan registry](https://sepolia.basescan.org/address/0xA54A6c46Fc5c5D0f0Fca952f3445c35ad8e6dD1C)
- [Blockscout registry](https://base-sepolia.blockscout.com/address/0xA54A6c46Fc5c5D0f0Fca952f3445c35ad8e6dD1C)
