# MICKY-XMD PRO

Multi-tenant WhatsApp bot hosting SaaS built with Node.js 22+, Express, Supabase, Baileys and Safaricom Daraja.

## Architecture
- Web/API process: `npm run start:web`
- Separate WhatsApp worker: `npm run start:bot`
- Supabase PostgreSQL/Auth for tenant data, wallets, bot sessions and payments.

Read [SETUP.md](./SETUP.md) before deploying. Static-only hosting is not sufficient; both services need persistent Node processes and outbound WebSocket support.

## Supabase
The initial schema and security migrations are in `supabase/migrations/`. Apply them only to the dedicated MICKY-XMD project.

## Security
Never commit secrets. Pair only WhatsApp accounts you own or are authorized to administer. Session tokens are hashed and Baileys auth state is encrypted server-side. The product intentionally does not bypass view-once privacy protections.

## Current status
Database migrations have been applied to the configured Supabase project. Production hosting, private environment configuration, live Daraja credentials and end-to-end WhatsApp/payment tests are separate deployment steps.