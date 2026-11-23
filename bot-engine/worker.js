import "dotenv/config";
import pino from "pino";
import makeWASocket, { DisconnectReason } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { admin } from "../server/supabase.js";
import { remoteAuth } from "./session-store.js";
import { handleMessage } from "./plugins/index.js";

const log = pino({ level: process.env.LOG_LEVEL || "info" });
const workers = new Map();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const backoff = attempt =>
  Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6)) + Math.floor(Math.random() * 1_000);

function clearHeartbeat(worker) {
  if (worker.heartbeatTimer) clearInterval(worker.heartbeatTimer);
  worker.heartbeatTimer = null;
}

function startHeartbeat(bot, worker, socket) {
  clearHeartbeat(worker);
  const heartbeat = async () => {
    if (worker.stopping || worker.socket !== socket) return;
    const now = new Date().toISOString();
    const { error } = await admin
      .from("bot_instances")
      .update({ heartbeat_at: now })
      .eq("id", bot.id)
      .eq("is_active", true);
    if (error) log.warn({ err: error, bot: bot.id }, "Could not update bot heartbeat");
    if (bot.always_online) {
      try {
        await socket.sendPresenceUpdate("available");
      } catch (error) {
        log.warn({ err: error, bot: bot.id }, "Always-online presence refresh failed");
      }
    }
  };
  worker.heartbeatTimer = setInterval(() => {
    heartbeat().catch(error => log.warn({ err: error, bot: bot.id }, "Heartbeat task failed"));
  }, 45_000);
  worker.heartbeatTimer.unref?.();
}

async function stopExpired(bot) {
  const { error } = await admin
    .from("bot_instances")
    .update({
      bot_status: "expired",
      subscription_status: "expired",
      is_active: false,
      connection_status: "disconnected"
    })
    .eq("id", bot.id);
  if (error) log.error({ err: error, bot: bot.id }, "Could not expire bot subscription");
  const worker = workers.get(bot.id);
  if (worker) {
    worker.stopping = true;
    worker.expired = true;
    clearHeartbeat(worker);
    try { worker.socket?.end(undefined); } catch {}
  }
}

async function startBot(bot) {
  if (workers.has(bot.id)) return;

  const worker = { socket: null, stopping: false, expired: false, attempt: 0, heartbeatTimer: null };
  workers.set(bot.id, worker);
  log.info({ bot: bot.id }, "Starting WhatsApp worker");

  while (!worker.stopping) {
    try {
      const auth = await remoteAuth(bot.id);
      if (worker.stopping) break;
      const socket = makeWASocket({
        auth: auth.state,
        logger: log.child({ bot: bot.id }),
        printQRInTerminal: false,
        browser: ["MICKY-XMD PRO", "Chrome", "1.0.0"],
        markOnlineOnConnect: false,
        syncFullHistory: false
      });
      worker.socket = socket;
      socket.ev.on("creds.update", () => {
        auth.saveCreds().catch(error =>
          log.error({ err: error, bot: bot.id }, "Could not persist WhatsApp credentials")
        );
      });

      socket.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        for (const message of messages) {
          try {
            await handleMessage({ sock: socket, msg: message, bot, log, admin });
          } catch (error) {
            log.warn({ err: error, bot: bot.id }, "Message handler failed");
          }
        }
      });

      socket.ev.on("messages.delete", async event => {
        try {
          for (const key of event.keys || []) {
            const { data, error } = await admin
              .from("deleted_messages_cache")
              .select("message_content,sender_jid,chat_jid")
              .eq("bot_instance_id", bot.id)
              .eq("chat_jid", key.remoteJid)
              .eq("message_id", key.id)
              .maybeSingle();
            if (error) throw error;
            if (!data) continue;

            const owner = socket.user?.id;
            if (owner) {
              await socket.sendMessage(owner, {
                text: `A message you received was deleted in ${data.chat_jid}.\nSender: ${data.sender_jid || "unknown"}\nContent: ${data.message_content?.text || "[non-text message]"}`
              });
            }
            await admin
              .from("deleted_messages_cache")
              .delete()
              .eq("bot_instance_id", bot.id)
              .eq("chat_jid", key.remoteJid)
              .eq("message_id", key.id);
          }
        } catch (error) {
          log.warn({ err: error, bot: bot.id }, "Anti-delete notification failed");
        }
      });

      const closed = new Promise(resolve => {
        let handled = false;
        socket.ev.on("connection.update", async update => {
          if (update.connection === "open") {
            worker.attempt = 0;
            const now = new Date().toISOString();
            const { error } = await admin
              .from("bot_instances")
              .update({
                connection_status: "connected",
                bot_status: "running",
                connected_at: now,
                heartbeat_at: now,
                reconnect_attempts: 0,
                whatsapp_jid: socket.user?.id || null
              })
              .eq("id", bot.id);
            if (error) log.error({ err: error, bot: bot.id }, "Could not persist worker connected state");
            else log.info({ bot: bot.id }, "WhatsApp worker connected");
            startHeartbeat(bot, worker, socket);
          }

          if (update.connection !== "close" || handled) return;
          handled = true;
          clearHeartbeat(worker);
          const disconnectCode = new Boom(update.lastDisconnect?.error || new Error("WhatsApp connection closed"))
            .output?.statusCode;

          if (disconnectCode === DisconnectReason.loggedOut) {
            worker.stopping = true;
            const { error } = await admin
              .from("bot_instances")
              .update({
                connection_status: "logged_out",
                bot_status: "stopped",
                is_active: false,
                auth_state_ciphertext: null
              })
              .eq("id", bot.id);
            if (error) log.error({ err: error, bot: bot.id }, "Could not persist logged-out state");
            log.warn({ bot: bot.id }, "WhatsApp session logged out; fresh pairing is required");
          } else if (!worker.stopping) {
            worker.attempt += 1;
            const { error } = await admin
              .from("bot_instances")
              .update({
                connection_status: "disconnected",
                bot_status: "starting",
                reconnect_attempts: worker.attempt
              })
              .eq("id", bot.id);
            if (error) log.warn({ err: error, bot: bot.id }, "Could not persist reconnect state");
            log.warn({ bot: bot.id, disconnectCode, attempt: worker.attempt }, "WhatsApp connection closed; reconnect scheduled");
          }
          resolve();
        });
      });

      await closed;
      if (worker.stopping) break;
    } catch (error) {
      worker.attempt += 1;
      clearHeartbeat(worker);
      log.error({ err: error, bot: bot.id, attempt: worker.attempt }, "Worker connection cycle failed");
    }

    if (!worker.stopping) await wait(backoff(worker.attempt));
  }

  clearHeartbeat(worker);
  try { worker.socket?.end(undefined); } catch {}
  workers.delete(bot.id);
  log.info({ bot: bot.id }, "WhatsApp worker stopped");
}

async function reconcile() {
  const now = new Date().toISOString();
  const { error: cacheError } = await admin
    .from("deleted_messages_cache")
    .delete()
    .lt("expires_at", now);
  if (cacheError) log.warn({ err: cacheError }, "Deleted-message cache cleanup failed");

  const { data: expired, error: expiredError } = await admin
    .from("bot_instances")
    .select("id")
    .eq("is_active", true)
    .lt("expires_at", now);
  if (expiredError) throw expiredError;
  for (const bot of expired || []) await stopExpired(bot);

  const { data: active, error } = await admin
    .from("bot_instances")
    .select("*")
    .eq("is_active", true)
    .eq("subscription_status", "active")
    .gt("expires_at", now);
  if (error) throw error;

  const activeIds = new Set((active || []).map(bot => bot.id));
  for (const [id, worker] of workers) {
    if (!activeIds.has(id)) {
      worker.stopping = true;
      clearHeartbeat(worker);
      try { worker.socket?.end(undefined); } catch {}
      if (!worker.expired) {
        const { error: stopError } = await admin
          .from("bot_instances")
          .update({ connection_status: "disconnected", bot_status: "stopped", is_active: false })
          .eq("id", id);
        if (stopError) log.warn({ err: stopError, bot: id }, "Could not persist inactive worker state");
      }
    }
  }
  for (const bot of active || []) {
    if (!workers.has(bot.id)) void startBot(bot);
  }
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "Stopping MICKY-XMD bot worker gracefully");
  const now = new Date().toISOString();
  const entries = [...workers.entries()];
  for (const [, worker] of entries) {
    worker.stopping = true;
    clearHeartbeat(worker);
    try { worker.socket?.end(undefined); } catch {}
  }
  await Promise.all(entries.map(async ([id]) => {
    const { error } = await admin
      .from("bot_instances")
      .update({ connection_status: "disconnected", bot_status: "starting", heartbeat_at: now })
      .eq("id", id)
      .eq("is_active", true);
    if (error) log.warn({ err: error, bot: id }, "Could not persist graceful shutdown state");
  }));
  await wait(500);
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

log.info("MICKY-XMD bot-engine process starting");
await reconcile();
const pollMs = Math.max(5_000, Number(process.env.WORKER_POLL_MS || 15_000));
setInterval(() => {
  if (!shuttingDown) reconcile().catch(error => log.error({ err: error }, "Worker reconciliation failed"));
}, pollMs).unref?.();
