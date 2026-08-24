import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// All app pages are request-rendered (locale cookie) — no ISR, so the
// default (no-op) incremental cache is correct; no KV/R2 needed.
export default defineCloudflareConfig();
