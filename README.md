# MICKY-XMD PRO

Multi-tenant WhatsApp bot hosting platform built with Node.js 22+, Express, Supabase, Baileys and Safaricom Daraja.

## Services

- **Web/API:** `npm run start:web` — authentication, dashboard APIs, WhatsApp pairing, encrypted session persistence and payment callbacks.
- **Bot worker:** `npm run start:bot` — restores deployed WhatsApp sessions, handles commands and supervises reconnects.
- **Database:** Supabase PostgreSQL/Auth — tenant data, wallets, transaction ledger, bot records and encrypted WhatsApp credentials.

Both services must use the same Supabase project and `SESSION_ENCRYPTION_KEY`. Run one bot-worker replica until distributed worker leases are implemented.

## WhatsApp pairing

Phone-number and QR pairing are independent flows that create fresh auth state and sockets. Phone-number pairing is requested only after Baileys emits its `connection.update` readiness event containing `qr`; a fixed delay is not a readiness signal. QR refresh starts a new server-side pairing session and polls for the current QR. The browser never receives raw auth credentials.

See [the WhatsApp lifecycle notes](./server/whatsapp/README.md) and [SETUP.md](./SETUP.md).

## Supabase

Migrations are stored in `supabase/migrations/`. They were designed for the dedicated MICKY-XMD project. Do not apply them to another product's database. Preserve existing bot rows and encrypted credentials when deploying application changes.

## Security

- Never commit secrets or expose Supabase service-role credentials in browser code.
- Session tokens are random opaque credentials; only SHA-256 hashes are stored.
- Baileys auth state is encrypted with AES-256-GCM before database persistence.
- Pair only WhatsApp accounts you own or are authorized to administer.
- Pairing endpoints have dedicated rate limits.
- The product does not bypass WhatsApp view-once privacy protections.
- Baileys is an unofficial WhatsApp Web client library; account restrictions are possible and no anti-ban guarantee is made.

## Verification

Run `npm test` for unit tests and `npm run check` for syntax checks. A green unit test suite does not replace a real WhatsApp link test, worker restart test or M-Pesa sandbox verification.

## Current operational limits

A live WhatsApp handshake requires the deployed Node service, correct private environment variables, outbound WebSocket connectivity and WhatsApp availability. GitHub source updates do not prove that Railway has deployed or that WhatsApp accepted a pairing request.
