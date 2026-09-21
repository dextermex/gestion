# Morada schema, vendored for the end-to-end database

Copied from dextermex/morada `supabase/migrations` at commit `ac4ec4f` on 2026-09-21 by `e2e/db/sync-morada-schema.mjs`.

These files are applied to a throwaway local Supabase in CI, before this repository's `supabase/applied` files, because the `gestion` schema delegates identity and permissions to Morada's `public.agencies`, `public.crm_members` and `public.gestion_onboard`. They are never applied to production from here.

- 20260711100000_crm_01_foundation.sql
- 20260711110000_crm_02_core.sql
- 20260711120000_crm_03_collab.sql
- 20260711130000_crm_04_integration.sql
- 20260711140000_crm_05_hardening.sql
- 20260711150000_discover_search.sql
- 20260711160000_discover_rank.sql
- 20260716120000_agency_storefront.sql
- 20260724120000_pro_platform.sql
- 20260725120000_customer_account.sql
- 20260726120000_customer_messaging_realtime.sql
- 20260726120500_agency_reads_contacting_customer_profile.sql
- 20260726130000_listing_images_bucket.sql
- 20260727000000_discovery_feed.sql
- 20260728000000_discovery_platform.sql
- 20260728120000_discovery_analytics.sql
- 20260728130000_discovery_react_logs_events.sql
- 20260729000000_discovery_publication_backend.sql
- 20260729120000_discovery_media_catalog.sql
- 20260730000000_client_conversations.sql
- 20260731000000_listings_assigned_to.sql
- 20260801000000_listings_details_jsonb.sql
- 20260802000000_listing_boosts.sql
- 20260803000000_team_management.sql
- 20260814000000_drop_legacy_token_portal.sql
- 20260814010000_identity_team_hardening.sql
- 20260814020000_profile_name_sync.sql
- 20260815000000_gestion_foundation.sql
- 20260816000000_gestion_operations.sql
- 20260823000000_gestion_bank_reconciliation.sql
- 20260823010000_gestion_portal.sql
