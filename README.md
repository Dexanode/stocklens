# StockLens

StockLens is a paper-only research terminal for Coinbase B20 tokenized-stock reference data on Base. It combines live NAV context, persistent history, risk research, AI-assisted allocation, thesis tracking, and reversible paper rebalancing.

## Networks

- B20 NAV/reference data: Base mainnet (`8453`), read from the Coinbase Tokenized Stocks API.
- Wallet, paper USDC balance, and thesis registry: Base Sepolia (`84532`).
- Registry: `0xA54A6c46Fc5c5D0f0Fca952f3445c35ad8e6dD1C`.

The NAV is a reference value, not a quote, bid, ask, or guaranteed fill price. StockLens does not execute trades or custody assets. Access is blocked for US users/persons and the app is educational, not financial advice.

On Vercel, the US block is enforced server-side from the request IP (`x-vercel-ip-country`) on `/api/market`, `/api/risk`, and `/api/portfolio` (US → 451). In local development there is no IP header, so the self-declared country from the access modal applies instead — that is an attestation, not an enforcement.

## Product flow

1. Read the B20 market and select an asset.
2. Inspect NAV history, dynamic risk context, and the AI brief.
3. Run the Portfolio Agent with price change, NAV history, volatility, supply, freshness, and current paper holdings.
4. Preview the current-vs-target allocation before applying it to the local paper book.
5. Save, review, share, and monitor a thesis.

## Run locally

```bash
cp .env.example .env.local  # then fill in real values; never commit .env.local
npm install
npm run dev
```

Required production variables (see `.env.example` for the full list):

```text
VIKEY_API_KEY=...
BLOB_READ_WRITE_TOKEN=...
VITE_WALLETCONNECT_PROJECT_ID=...
```

Optional reliability setting for the history proxy:

```text
BASE_SEPOLIA_RPC_URL=https://your-sepolia-rpc.example
```

`VITE_WALLETCONNECT_PROJECT_ID` must be a real 32-character WalletConnect project ID. The UI disables the modal fallback when it is not configured.

## API routes

- `/api/market` — B20 universe and live NAV metadata. US → 451 (server-side geo).
- `/api/risk` — asset research brief through Vikey with deterministic fallback. US → 451; rate-limited to 30 req/min per IP (best-effort, in-memory per serverless instance).
- `/api/portfolio` — AI allocation and rebalance proposal using NAV history and volatility. US → 451; rate-limited to 10 req/min per IP (best-effort, in-memory per serverless instance). Only NAV history *statistics* are sent to Vikey, never raw history points; `max_tokens` is capped at `1800 + 100` per asset.
- `/api/nav-history` — persistent NAV snapshots through private Vercel Blob. GET is read-only and never writes. POST only accepts the 13-asset B20 allowlist and prices within ±50% of the live Coinbase NAV; anything else is rejected per symbol and never stored.
- `/api/thesis` — server-side thesis persistence and shareable thesis pages. POST requires at least a symbol, title, or note (empty theses are rejected with 400). PUT only updates an existing thesis (404 otherwise, never auto-creates). DELETE removes a thesis by id.
- `/api/follow-up` — deterministic thesis follow-up and review triggers.
- `/api/history` — Base Sepolia registry history through a server-side RPC.

## Safety and scope

All simulated positions are paper-only. The app shows data availability explicitly, keeps unavailable changes neutral, uses dynamic chart axes, and never presents missing history as a real trend. Onchain history is read-only from the app; the optional registry write is a user-confirmed Base Sepolia proof.

Write endpoints are unauthenticated by design for this hackathon build (no user accounts): abuse is mitigated by validation, per-symbol rejection, and rate limits, not by identity. The Blob read-modify-write is still last-writer-wins under concurrency — see the PR notes for the append-only follow-up.

Security headers (CSP, `X-Frame-Options`, HSTS, and others) are set in `vercel.json`. Secrets live only in `.env.local` / Vercel project settings and are excluded from git by `.gitignore`.

## Verification links

- [BaseScan registry](https://sepolia.basescan.org/address/0xA54A6c46Fc5c5D0f0Fca952f3445c35ad8e6dD1C)
- [Blockscout registry](https://base-sepolia.blockscout.com/address/0xA54A6c46Fc5c5D0f0Fca952f3445c35ad8e6dD1C)
