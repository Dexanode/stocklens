# StockLens handoff

StockLens is a paper-only research prototype for Coinbase B20 reference NAV data. It does not place trades or custody assets. NAV is a reference, not an executable quote. AI output is illustrative and may use a deterministic fallback.

## Links and networks

- Live app: https://stocklens-black-six.vercel.app/
- Repository: https://github.com/Dexanode/stocklens
- Reference NAV: Coinbase Tokenized Stocks API, Base mainnet (8453).
- Optional thesis proof: Base Sepolia (84532), registry `0xA54A6c46Fc5c5D0f0Fca952f3445c35ad8e6dD1C`.
- Explorer: https://sepolia.basescan.org/address/0xA54A6c46Fc5c5D0f0Fca952f3445c35ad8e6dD1C

## Suggested demo

1. Complete the access check truthfully, then choose an asset and note its NAV timestamp and whether it is marked delayed.
2. Open the AI brief and explain the displayed model source and any fallback. Run the Portfolio Agent and inspect its target allocations before applying them to the paper book.
3. Run a paper trade with an available NAV and a positive budget. Refresh the page to demonstrate that the paper book is stored in that browser.
4. Save a non-sensitive thesis and use its share link to show the read-only view. Thesis data may be publicly readable; do not include private information.
5. Optionally connect a test wallet on Base Sepolia and record a proof. This creates a public transaction and uses testnet gas. The proof stores a snapshot, not a trade.

## Setup and checks

Use `.env.example` for configuration; do not put real credentials in the repository. Install dependencies with `npm ci`, run `npm run build`, and run `node --test tests/*.test.mjs`. Follow the setup and API sections in README for Vercel and storage details.

## Known limitations

- Source NAV timestamps may be old; refresh cannot make an upstream value newer. A percentage change is unavailable when the source supplies no valid comparison.
- Chart history is collected from observed NAV snapshots; it is not a complete historical price feed. Multiple observations can reflect an unchanged upstream NAV.
- Paper portfolio and thesis edit tokens are stored per browser, not synced to other devices. Losing the token prevents editing its server-side thesis.
- Stored onchain proofs are public. Old records with zero change are ambiguous because previous versions used zero when change was missing. New missing values use a reserved sentinel documented in README.
- Vikey and upstream market data can fail; the app may show fallback output or unavailable references. Rate limiting is best-effort per serverless instance, not a distributed quota.
- The access check and IP-based restrictions have implementation limits described in README; they do not replace a legal review.
- Preview and production storage are separated, but the deployed registry address is shared on Base Sepolia: a preview proof is visible publicly and in production history.
- Verify the specific event's rules, deadline, required submission fields, demo-video requirements and eligibility independently. No submission or traction claim is implied by this document.
