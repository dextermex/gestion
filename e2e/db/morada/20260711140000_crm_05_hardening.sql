-- ============================================================================
-- Morada Pro CRM — Migration 5: hardening pass from Supabase security advisors
-- ============================================================================
-- Trigger functions must never be callable through the REST RPC surface.
-- Postgres checks EXECUTE at CREATE TRIGGER time only, so triggers keep firing
-- for anon/authenticated writers even after these revokes.

alter function public.crm_touch_updated_at() set search_path = public, pg_temp;

revoke all on function public.crm_touch_updated_at() from public, anon, authenticated;
revoke all on function public.crm_after_message() from public, anon, authenticated;
revoke all on function public.crm_import_public_lead() from public, anon, authenticated;
revoke all on function public.crm_import_public_offer() from public, anon, authenticated;
revoke all on function public.crm_lead_won_tx() from public, anon, authenticated;
revoke all on function public.crm_log_lead_insert() from public, anon, authenticated;
revoke all on function public.crm_log_lead_stage() from public, anon, authenticated;
revoke all on function public.crm_log_task_done() from public, anon, authenticated;
