# MICKY-XMD PRO deployment status

Last checked: 2026-11-22.

## Completed
- Supabase project `dtibowvdocfqihrgpdvk` is connected and healthy.
- Initial schema, RLS hardening/indexes, and bot presence preferences migrations have been applied.
- Eight application tables have RLS enabled.
- Wallet credit/debit and atomic bot deployment RPCs are installed and restricted to `service_role`.
- Express API, authentication helpers, encrypted session storage, Daraja adapter, worker and bot plugins are committed.
- Login, pairing and dashboard pages are committed.
- GitHub Actions syntax/test workflow is configured.
- AES-256-GCM session encryption unit tests have passed in the local Node 22 environment.

## Not yet completed / not verified
- Hosting services have not been provisioned.
- Hosting environment variables have not been configured.
- No live WhatsApp pairing has been performed against a real account.
- No live worker deployment or reconnect test has been performed.
- Daraja credentials and callback ingress are not configured; no M-Pesa sandbox transaction has been run.
- No production domain, backups, alerting or operational monitoring are configured.
- SMM boosting and reseller API are dashboard placeholders, not functioning features.

## Deployment prerequisites
Set these privately on both web and worker services:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SESSION_ENCRYPTION_KEY` (same 64-character hex value on both services)

Set Daraja variables on web only when ready for sandbox payment testing. Do not put any secret in GitHub, browser code, issue comments or chat messages.