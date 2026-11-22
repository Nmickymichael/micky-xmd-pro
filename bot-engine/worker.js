import "dotenv/config";
import pino from "pino";
import makeWASocket, { DisconnectReason } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { admin } from "../server/supabase.js";
import { remoteAuth } from "./session-store.js";
import { handleMessage } from "./plugins/index.js";
const log=pino({level:process.env.LOG_LEVEL||"info"}),workers=new Map();
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const backoff=n=>Math.min(60_000,1000*2**Math.min(n,6))+Math.floor(Math.random()*1000);
async function stopExpired(bot){
 await admin.from("bot_instances").update({bot_status:"expired",subscription_status:"expired",is_active:false,connection_status:"disconnected"}).eq("id",bot.id);
 const w=workers.get(bot.id);if(w){w.stopping=true;try{w.socket?.end(undefined);}catch{}workers.delete(bot.id);}
}
async function startBot(bot){
 if(workers.has(bot.id))return;
 const worker={socket:null,stopping:false,attempt:0};workers.set(bot.id,worker);
 while(!worker.stopping){
  try{
   const auth=await remoteAuth(bot.id);
   const sock=makeWASocket({auth:auth.state,logger:log.child({bot:bot.id}),printQRInTerminal:false,browser:["MICKY-XMD PRO","Chrome","1.0"],markOnlineOnConnect:false,syncFullHistory:false});
   worker.socket=sock;sock.ev.on("creds.update",auth.saveCreds);
   sock.ev.on("messages.upsert",async({messages,type})=>{if(type!=="notify")return;for(const msg of messages){try{await handleMessage({sock,msg,bot,log,admin});}catch(e){log.warn({err:e,bot:bot.id},"message handler failed");}}});
   sock.ev.on("messages.delete",async event=>{try{const keys=event.keys||[];for(const key of keys){const {data}=await admin.from("deleted_messages_cache").select("message_content,sender_jid,chat_jid").eq("bot_instance_id",bot.id).eq("chat_jid",key.remoteJid).eq("message_id",key.id).maybeSingle();if(data){const owner=sock.user?.id;if(owner)await sock.sendMessage(owner,{text:`A message you received was deleted in ${data.chat_jid}.\nSender: ${data.sender_jid||"unknown"}\nContent: ${data.message_content.text||"[non-text message]"}`});await admin.from("deleted_messages_cache").delete().eq("bot_instance_id",bot.id).eq("chat_jid",key.remoteJid).eq("message_id",key.id);}}}catch(e){log.warn({err:e},"anti-delete notification failed");}});
   sock.ev.on("connection.update",async update=>{
    if(update.connection==="open"){worker.attempt=0;await admin.from("bot_instances").update({connection_status:"connected",bot_status:"running",connected_at:new Date().toISOString(),heartbeat_at:new Date().toISOString(),reconnect_attempts:0,whatsapp_jid:sock.user?.id}).eq("id",bot.id);}
    if(update.connection==="close"){
     const code=new Boom(update.lastDisconnect?.error).output?.statusCode;
     if(code===DisconnectReason.loggedOut){worker.stopping=true;await admin.from("bot_instances").update({connection_status:"logged_out",bot_status:"stopped",is_active:false,auth_state_ciphertext:null}).eq("id",bot.id);workers.delete(bot.id);return;}
     worker.attempt++;await admin.from("bot_instances").update({connection_status:"disconnected",bot_status:"starting",reconnect_attempts:worker.attempt}).eq("id",bot.id);
    }
   });
   await new Promise(resolve=>sock.ev.on("connection.update",u=>{if(u.connection==="close")resolve();}));
   if(worker.stopping)break;
  }catch(e){worker.attempt++;log.error({err:e,bot:bot.id},"worker connection failed");}
  if(!worker.stopping)await wait(backoff(worker.attempt));
 }
 workers.delete(bot.id);
}
async function reconcile(){
 const now=new Date().toISOString();
 await admin.from("deleted_messages_cache").delete().lt("expires_at",now);
 const {data:expired}=await admin.from("bot_instances").select("id").eq("is_active",true).lt("expires_at",now);
 for(const b of expired||[])await stopExpired(b);
 const {data:active,error}=await admin.from("bot_instances").select("*").eq("is_active",true).eq("subscription_status","active").gt("expires_at",now);
 if(error)throw error;
 const ids=new Set((active||[]).map(x=>x.id));
 for(const [id,w] of workers)if(!ids.has(id)){w.stopping=true;try{w.socket?.end(undefined);}catch{}workers.delete(id);}
 for(const bot of active||[])if(!workers.has(bot.id))startBot(bot);
}
log.info("MICKY-XMD bot-engine process starting");
await reconcile();setInterval(()=>reconcile().catch(e=>log.error(e,"reconcile failed")),Number(process.env.WORKER_POLL_MS||15000));