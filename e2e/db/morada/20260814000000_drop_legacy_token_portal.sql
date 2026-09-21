-- Security: remove the legacy slug+token "agency portal" API.
-- These SECURITY DEFINER functions were callable by anon with a hardcoded token
-- ('morada-demo-2026') and exposed cross-tenant lead PII, stats and offers, and
-- allowed listing creation / lead mutation in any agency. Morada Pro (Supabase
-- Auth + crm_members RLS) fully supersedes them; the /agency page is removed.

drop function if exists public.agency_leads(text, text);
drop function if exists public.agency_offers(text, text);
drop function if exists public.agency_stats(text, text);
drop function if exists public.agency_create_listing(text, text, jsonb);
drop function if exists public.update_lead_status(text, text, uuid, text);
drop function if exists public.request_video_tour(text, text, uuid);
