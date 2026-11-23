# WhatsApp connection lifecycle

MICKY-XMD has two independent connection paths:

- **Phone-number linking:** create fresh unregistered auth state, start one socket, wait for Baileys' first `connection.update` event containing `qr`, and only then request the pairing code. Baileys documents this QR event as the readiness trigger for phone-number pairing; do not use an arbitrary sleep as a readiness signal.
- **QR linking:** create fresh auth state and render each current QR update. QR refresh starts a new server-side pairing session; it does not merely reload the last image.

The two methods share encrypted remote auth persistence and connection lifecycle handling, but never share a socket or auth state. Each request is serialized per account. Connected sessions are not closed when a new pending session is created.

The browser only receives the one-time opaque session token. WhatsApp credentials remain encrypted in Supabase. QR strings and pairing codes are temporary and must never be logged or persisted as application data.

A QR displayed by the web process is tied to that process's in-memory socket. If the web process restarts before linking finishes, the browser must start a fresh QR session. Once linking completes, the encrypted credentials are durable and the separate bot worker can restore them. An idle pairing socket is closed after ten minutes to release memory and connections; this does not erase the saved linked-device credentials or the one-time session-token hash.
