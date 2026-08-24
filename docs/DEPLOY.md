# Deploying Morada Gestion to Cloudflare (`app.morada.lu`)

The app is a Next.js 15 App Router site rendered per-request (it reads the
`morada_locale` cookie on every page), packaged for Cloudflare Workers with the
**OpenNext** adapter. The `morada.lu` zone already lives on the target
Cloudflare account, so the custom hostname is created by the deploy itself — no
manual DNS record needed.

## What's committed

- `open-next.config.ts` — OpenNext Cloudflare config (no incremental cache: every
  route is dynamic, so there's nothing to persist in KV/R2).
- `wrangler.jsonc` — Worker name `morada-gestion`, `nodejs_compat`, minified
  bundle, `ASSETS` binding, and the production route:
  `{ "pattern": "app.morada.lu", "custom_domain": true }`.
- `deploy/` — a snapshot of the exact published artifact (bundled `worker.js`,
  the 50 static assets, and the Workers asset `manifest.json`). Handy for a
  direct-upload deploy; regenerate it with `npm run build:cf` first.

## Finish the publish — pick one

### A. Connect the repo in the Cloudflare dashboard (recommended)

Workers Builds (Cloudflare's first-party CI) is already enabled on the account.

1. Dashboard → **Workers & Pages → Create → Import a repository**.
2. Pick **`dextermex/gestion`**, branch `claude/morada-property-management-ve2hla`
   (or `main` once merged).
3. It auto-detects `wrangler.jsonc`. Build command `npm run build:cf`,
   deploy command `npx wrangler deploy`.
4. Deploy. The route in `wrangler.jsonc` binds `app.morada.lu` automatically.

Every push to the watched branch then redeploys.

### B. One command locally

```bash
npm install
npx wrangler login          # once, opens the browser
npm run deploy:cf           # builds with OpenNext + wrangler deploy
```

`wrangler` reads `wrangler.jsonc`, uploads the Worker + assets, and creates the
`app.morada.lu` custom domain on the `morada.lu` zone.

### C. Scoped API token (CI without the dashboard)

Create a token with **Account → Workers Scripts → Edit**, **Account → Workers
Routes → Edit**, **Zone → DNS → Edit** and **Zone → Workers Routes → Edit** on
the `morada.lu` zone, then:

```bash
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npm run deploy:cf
```

## After first deploy

- `https://app.morada.lu` serves the app; the language follows the
  `morada_locale` cookie (FR default, EN/DE/LU via the globe menu).
- The bundle is ~3.4 MB / ~0.9 MB gzip — well within Workers limits.
