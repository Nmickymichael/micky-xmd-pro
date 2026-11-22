# MICKY-XMD PRO — setup and deployment

## Current architecture
MICKY-XMD PRO runs as two long-lived Node.js 22+ processes:
- **Web/API:** `npm run start:web` — Express, Supabase Auth, pairing, dashboard APIs and Daraja callbacks.
- **WhatsApp worker:** `npm run start:bot` — Baileys sessions, command processing and reconnect supervision.

A static-only host or a serverless function platform is not suitable for the WhatsApp worker. Both processes need persistent runtime, outbound WebSocket access and the same Supabase credentials and session-encryption key.

## Supabase database
The dedicated project is `dtibowvdocfqihrgpdvk` (`https://dtibowvdocfqihrgpdvk.supabase.co`). The following migrations have already been applied and are committed in `supabase/migrations/`:
- `20261122130558_micky_xmd_initial_schema.sql`
- `20261122130608_micky_xmd_security_and_indexes.sql`
- `20261122131508_micky_xmd_bot_presence_options.sql`

Do not apply these to another product's Supabase project. The schema includes profiles, KES wallets, wallet ledger, bot instances, group configuration, deleted-message cache, API keys and M-Pesa payment requests. RLS is enabled on all eight tables. Browser users cannot mutate wallets, transactions, bot session credentials or API keys.

Enable Email in Supabase Authentication → Providers. Set the production Site URL and allowed redirect URLs after the public web domain is known.

## Environment variables
Copy `.env.example` into a private environment file locally or configure each variable in the hosting provider's secret manager. Never commit `.env`, service-role keys, Daraja credentials or session encryption keys.

Required on **both** web and worker:
- `SUPABASE_URL=https://dtibowvdocfqihrgpdvk.supabase.co`
- `SUPABASE_ANON_KEY` — Supabase publishable/anon key
- `SUPABASE_SERVICE_ROLE_KEY` — server-side only; never expose in browser code
- `SESSION_ENCRYPTION_KEY` — exactly 32 random bytes represented as 64 hex characters

Generate the encryption key with `openssl rand -hex 32`. Use the exact same value for both processes. If it is lost, existing encrypted WhatsApp credentials cannot be decrypted.

Web service only, when enabling M-Pesa:
- `MPESA_ENV=sandbox` initially
- `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`
- `MPESA_CALLBACK_URL` — public HTTPS endpoint ending in `/api/payments/mpesa-callback`
- `MPESA_CALLBACK_SECRET` — long random secret; configure a trusted callback gateway to send it as `x-mpesa-callback-secret`. Do not enable production payments until callback verification is tested end to end.

Worker only, optional:
- `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`
- Install `yt-dlp` and `ffmpeg` for public TikTok/YouTube downloader commands.

## Local run
```bash
npm install
npm run start:web
```
In a second terminal:
```bash
npm run start:bot
```
Open `http://localhost:3000/login.html`. Register, confirm email if required, sign in, pair a WhatsApp account you own/control, copy the one-time MICKY session token, and use it to deploy. Deployment currently charges KES 150 for 30 days.

## Hosting
Create two separate persistent Node services from this repository:
- Web/API service: build `npm install`; start `npm run start:web`; health check `/health`.
- Background worker: build `npm install`; start `npm run start:bot`.

Both services must use Node.js 22+, the same Supabase project and the same `SESSION_ENCRYPTION_KEY`. The worker does not need Daraja credentials. Do not run multiple worker replicas until distributed leases/locking are implemented; otherwise more than one worker may attempt to own the same WhatsApp session.

The web service must use HTTPS in production. Configure Supabase Auth's Site URL/redirect allow-list to the final domain. Configure the Daraja callback through a trusted ingress that injects the callback secret header; do not put secrets in query strings or logs.

## Security and product limitations
- Session tokens are random opaque credentials. Only their SHA-256 hashes are stored in the database. The token is returned once to the signed-in user.
- Baileys auth state is encrypted using AES-256-GCM before database persistence.
- Never share the service-role key or session-encryption key.
- Pair only WhatsApp accounts you own or are authorized to administer.
- `.vv` explicitly refuses to bypass view-once privacy.
- Anti-delete only caches ordinary text messages the bot legitimately received before deletion; retention is limited to 24 hours.
- Baileys is an unofficial WhatsApp Web client library. Account restrictions are possible; no anti-ban guarantee is made.
- M-Pesa must remain in sandbox until successful, failed, mismatched and duplicate callback scenarios have been tested.
- Reseller API, SMM boosting, advanced account settings and full transaction-history UI are not yet implemented; dashboard placeholders must not be interpreted as active services.

## Verification checklist
- [ ] Set private runtime environment variables.
- [ ] Confirm signup, email confirmation, login and logout.
- [ ] Confirm profile and wallet are created on first login.
- [ ] Pair a test WhatsApp account and verify session ciphertext persists.
- [ ] Deploy with a test wallet balance and verify exactly one KES 150 debit.
- [ ] Verify worker reconnects after restart and expires subscriptions.
- [ ] Test Daraja sandbox success, failure, wrong amount/phone and duplicate callback.
- [ ] Configure backups, log retention, alerting and incident response before public launch.