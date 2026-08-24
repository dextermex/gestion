# Deploying Morada Gestion — Vercel

Morada Gestion is hosted on **Vercel**, next to the other Morada properties
(`morada.lu` and `www` already run there). It is a standard Next.js 15 App
Router app rendered per-request (it reads the `morada_locale` cookie on every
page) — zero-config on Vercel, no adapter needed.

## Production domain

`app.morada.lu` — the DNS is already in place on the Cloudflare-managed
`morada.lu` zone:

```
CNAME  app  →  cname.vercel-dns.com   (proxied, like www and gestion)
```

The zone also carries a pre-existing `gestion.morada.lu → Vercel` record, so
that hostname works as an alternative or an alias.

## Setup (once, in the Morada Vercel account)

1. **Add New → Project → Import Git Repository** → `dextermex/gestion`.
   Framework auto-detects as Next.js; no custom settings needed.
   Set the production branch (currently `claude/morada-property-management-ve2hla`,
   or `main` once merged).
2. Project → **Settings → Domains** → add `app.morada.lu` (and optionally
   `gestion.morada.lu`). Since `morada.lu` is already verified in this
   account, the domain attaches instantly — DNS is pre-pointed, nothing else
   to change.
3. Done. Every push to the production branch deploys; previews per PR.

## Notes

- An interim `morada-gestion` project exists in the AURA SOCIETY LLC team
  (created via direct upload before the account question was settled). Once
  the project lives in the Morada account, delete that interim one to keep
  the separation between Morada and Aura clean.
- No environment variables are required for the demo build. When Supabase is
  wired for production, add `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Project → Settings → Environment
  Variables (see docs/ARCHITECTURE.md).
