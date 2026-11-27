# StockLens

StockLens is a paper-only research terminal for Coinbase B20 tokenized-stock reference data on Base. It combines live NAV context, persistent history, risk research, AI-assisted allocation, thesis tracking, and reversible paper rebalancing.

## Networks

- B20 NAV/reference data: Base mainnet (`8453`), read from the Coinbase Tokenized Stocks API.
- Wallet, paper USDC balance, and thesis registry: Base Sepolia (`84532`).
- Registry: `0xA54A6c46Fc5c5D0f0Fca952f3445c35ad8e6dD1C`.

The NAV is a reference value, not a quote, bid, ask, or guaranteed fill price. StockLens does not execute trades or custody assets. Access is blocked for US users/persons and the app is educational, not financial advice.

Market data refreshes every minute while the page is visible. NAV timestamps are supplied by Coinbase; values older than one hour are marked delayed. When no comparison price is supplied, change is unavailable. New onchain proofs encode unavailable change as -2147483648 basis points, a reserved sentinel, and the history API decodes it as null. Older zero values are ambiguous because earlier versions also used zero for missing data.

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
- `/api/portfolio` — AI allocation and rebalance proposal using NAV history and volatility. US → 451; rate-limited to 10 req/min per IP (best-effort, in-memory per serverless instance). Only NAV history *statistics* are sent to Vikey, never raw history points; `max_tokens` is capped at `2400 + 200` per asset (5,000 tokens for a 13-asset run, max 7,200), with a 25s upstream timeout — a 13-asset run took ~13s, so a shorter cap forced the fallback.
- `/api/nav-history` — persistent NAV snapshots through private Vercel Blob. GET is read-only and never writes. POST is a server-side refresh trigger only: the server fetches the live NAV itself from Coinbase and records only what it observed. Client-supplied prices are ignored entirely (a price inside any tolerance band could still poison the shared history, chart, and agent input), so there is no band to game.
- `/api/thesis` — server-side thesis persistence and shareable thesis pages. GET reads the thesis id from the request URL (`?id=` or `?thesisId=` — the share-link parameter), with `request.query` as a fallback, and never serves a publicly cacheable response (`no-store`); a GET with no id returns the list of public theses. POST requires at least a symbol, title, or note (empty theses are rejected with 400). PUT only updates an existing thesis (404 otherwise, never auto-creates) and requires proof of ownership: the server issues an `editToken` once, in the POST response that creates the thesis; the creator's browser keeps it in localStorage (`stocklens-thesis-edit-tokens-v1`, keyed by thesis id) and sends it as the `x-edit-token` header on PUT. No token → 401, wrong token → 401. The token is never in a GET response, never in a PUT response, and never in a share link (`?thesisId=` carries the id only). Theses created before edit tokens exist have no owner proof and are read-only on the server (PUT → 410); the owner can duplicate one as a new thesis in the UI to get an editable copy. There is deliberately no DELETE endpoint: thesis ids appear in public share links, and there is no ownership model to check a delete against. Deletion is owner-only via the Vercel Blob dashboard (Storage → Blob → `stocklens/theses.json`, remove the entry).

Storage is namespaced per Vercel environment (`api/lib/storage.js`): production keeps the historical paths (`stocklens/theses.json`, `stocklens/nav-history.json`); preview deployments use `stocklens/preview/…` and local development uses `stocklens/development/…`, so a preview can never read or write production data. Blob reads are fail-closed (`api/lib/blob-store.js`): only a genuinely missing file is treated as empty — a failed fetch, a non-2xx response, broken JSON, or a wrongly shaped payload returns an error (503/500) and stops the request before any write, so a failed read can never wipe stored theses or NAV history. Blob writes (`api/lib/blob-store.js`, `readModifyWrite`): a successful `put()` IS the write — the handler answers 200 with the record as written plus the edit token (POST thesis), because Blob reads lag writes by ~10–25 s live and a verify re-read can never gate a write's success (rev 6 tried that and returned false 503s for writes that had landed). A fresh re-read on a bounded schedule (~3.5 s) only reports whether the change is already visible, surfaced as `verified` / `pendingPropagation` in the response; `verified: false` is a normal outcome under propagation lag, not an error. A 503 happens only when `put()` itself fails on every attempt or the pre-write read fails outright. Before writing, the pre-write read is repeated a few times and the freshest snapshot (newest `updatedAt`/timestamp, then record count) wins, so a stale edge copy is less likely to be the base of a write — but without versioning/CAS, two writers racing inside the same read window can still overwrite each other (last writer wins). Share links carry only ids the server confirmed exist (`src/thesis-share.js` GET-verifies the id with retries, checks the list for a content match before re-creating, and falls back to the `?thesis=` JSON link when the server is unreachable, so a single stale 404 can never mint a duplicate). Covered by `tests/` (`node --test tests/*.test.mjs`, 70/70 pass, no dependencies) — including the GET-id regression tests, the PUT ownership matrix (401/401/200/410), and the lag-aware write + share-resolver cases.
- `/api/follow-up` — deterministic thesis follow-up and review triggers.
- `/api/history` — Base Sepolia registry history through a server-side RPC.

## Safety and scope

All simulated positions are paper-only. The app shows data availability explicitly, keeps unavailable changes neutral, uses dynamic chart axes, and never presents missing history as a real trend. Onchain history is read-only from the app; the optional registry write is a user-confirmed Base Sepolia proof.

Write endpoints are authenticated by ownership, not by accounts: `PUT /api/thesis` requires the per-thesis edit token issued at creation (legacy theses without one are read-only), and `/api/nav-history` records only NAV the server fetched itself, so client-supplied prices cannot poison shared history. A successful `put()` is the write (200 with the record as written plus `verified` / `pendingPropagation`); a 503 means the write itself failed or the pre-write read failed outright — never a false 503 for a landed write, which is what rev 6's verify-as-gate produced live. The read-modify-write is still last-writer-wins if two writers race inside the same read window — see the PR notes for the append-only follow-up.

Security headers (CSP, `X-Frame-Options`, HSTS, and others) are set in `vercel.json`. Secrets live only in `.env.local` / Vercel project settings and are excluded from git by `.gitignore`.

## Verification links

- [BaseScan registry](https://sepolia.basescan.org/address/0xA54A6c46Fc5c5D0f0Fca952f3445c35ad8e6dD1C)
- [Blockscout registry](https://base-sepolia.blockscout.com/address/0xA54A6c46Fc5c5D0f0Fca952f3445c35ad8e6dD1C)
