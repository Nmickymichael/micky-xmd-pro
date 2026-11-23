import "dotenv/config";
import { randomUUID } from "node:crypto";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { z } from "zod";
import { admin,createAuthClient } from "./supabase.js";
import { authenticate,setAuthCookie,clearAuthCookies } from "./auth.js";
import { sha256,randomSessionToken } from "./crypto.js";
import { stkPush,verifyCallbackSecret } from "./daraja.js";
import makeWASocket, { DisconnectReason } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { Boom } from "@hapi/boom";
import { createRemoteAuthState } from "./remote-auth.js";
import { createPairingCodeWaiter, normalizePairingCode, createOnceAsync } from "./whatsapp/pairing-code.js";
import { normalizeWhatsAppNumber } from "./whatsapp/phone.js";

const app=express();app.set("trust proxy",1);
app.use(helmet({contentSecurityPolicy:false,crossOriginEmbedderPolicy:false}));
app.use(express.json({limit:"1mb"}));app.use(cookieParser());
app.use(express.static(new URL("../public",import.meta.url).pathname));
app.use("/api",rateLimit({windowMs:60_000,limit:100,standardHeaders:"draft-7",legacyHeaders:false}));
const pairingLimiter=rateLimit({windowMs:15*60_000,limit:5,standardHeaders:"draft-7",legacyHeaders:false,message:{error:"Too many pairing attempts. Wait 15 minutes before trying again."}});
const logger=pino({level:process.env.LOG_LEVEL||"info"});
const pendingPairings=new Map();
const phoneSchema=z.string().regex(/^(254|0)?[17]\d{8}$/);
const normalPhone=s=>{let v=s.replace(/\D/g,"");if(v.startsWith("0"))v="254"+v.slice(1);if(v.startsWith("7")||v.startsWith("1"))v="254"+v;return v;};
// Phone-number linking is triggered by Baileys' QR readiness update;
// QR linking renders each current QR update into a short-lived browser image.
function attachPairingSocket({botId,remote,requestId,phoneLast4}){
 const sock=makeWASocket({auth:remote.state,logger:pino({level:"silent"}),printQRInTerminal:false,browser:["MICKY-XMD PRO","Chrome","1.0.0"],markOnlineOnConnect:false,connectTimeoutMs:60_000,keepAliveIntervalMs:30_000});
 const pending=pendingPairings.get(botId);
 if(pending){pending.sock=sock;pending.connection="connecting";pending.closed=false;}
 sock.ev.on("creds.update",()=>remote.saveCreds().catch(err=>logger.error({err,requestId,botId},"Could not persist updated WhatsApp credentials")));
 sock.ev.on("connection.update",async update=>{
  if(update.qr){
   const p=pendingPairings.get(botId);
   if(p?.method==="phone"){
    // Baileys emits this event when the socket is ready for pairing-code requests.
    // A fixed sleep is not a reliable readiness signal.
    p.startPairingCode?.().catch(err=>logger.error({err,requestId,botId},"Phone-number pairing request failed after readiness event"));
   }else if(p?.method==="qr"){
    const revision=(p.qrRevision||0)+1;p.qrRevision=revision;
    try{
     const rendered=await QRCode.toDataURL(update.qr,{width:280,margin:1});
     const current=pendingPairings.get(botId);
     if(current===p&&current.sock===sock&&current.qrRevision===revision)current.qr=rendered;
    }catch(err){logger.warn({err,requestId,botId},"Could not render WhatsApp QR code");}
   }
  }
  if(update.connection==="open"){
   const activePair=pendingPairings.get(botId);if(activePair){activePair.restartAttempts=0;activePair.connected=true;activePair.connection="open";activePair.qr=null;}
   const jid=sock.user?.id||null;
   const {error}=await admin.from("bot_instances").update({connection_status:"connected",bot_status:"stopped",whatsapp_jid:jid,connected_at:new Date().toISOString(),auth_state_ciphertext:remote.exportEncrypted(),metadata:{pairing_completed_at:new Date().toISOString()}}).eq("id",botId);
   if(error)logger.error({err:error,requestId,botId},"Failed to persist paired WhatsApp session");
   else logger.info({requestId,botId,phoneLast4},"WhatsApp account paired successfully");
  }
  if(update.connection==="close"){
   const p=pendingPairings.get(botId);
   const error=update.lastDisconnect?.error;
   if(p){p.connection="close";p.lastError=error?.message||"WhatsApp socket closed";}
   const code=new Boom(error||new Error("WhatsApp socket closed")).output?.statusCode;
   if(p?.closing)return;
   if(code===DisconnectReason.restartRequired){
    if(p)p.connection="restarting";
    if(p)p.restartAttempts=(p.restartAttempts||0)+1;
    if((p?.restartAttempts||0)>3){
     p.closed=true;p.connection="closed";
     const {error:stateError}=await admin.from("bot_instances").update({connection_status:"error",bot_status:"error",is_active:false}).eq("id",botId);
     if(stateError)logger.warn({err:stateError,requestId,botId},"Could not persist exhausted pairing restart state");
     logger.error({requestId,botId,disconnectCode:code},"WhatsApp pairing socket exceeded restart limit");return;
    }
    logger.info({requestId,botId,disconnectCode:code,restartAttempt:p?.restartAttempts||1},"WhatsApp requested a socket restart after pairing; reconnecting with saved credentials");
    setTimeout(()=>{
     const current=pendingPairings.get(botId);
     if(!current||current.closing)return;
     try{attachPairingSocket({botId,remote,requestId,phoneLast4});}
     catch(restartError){
      current.closed=true;current.connection="closed";
      admin.from("bot_instances").update({connection_status:"error",bot_status:"error",is_active:false}).eq("id",botId)
       .then(({error:stateError})=>{if(stateError)logger.warn({err:stateError,requestId,botId},"Could not persist pairing restart failure");});
      logger.error({err:restartError,requestId,botId},"Could not restart WhatsApp pairing socket");
     }
    },500);
    return;
   }
   if(p)p.closed=true;
   if(p?.method==="phone"&&!p.pairingCodeRequested)p.codeWaiter?.reject(new Error("WhatsApp closed the connection before it became ready to request a pairing code."));
   logger.warn({requestId,botId,disconnectCode:code,disconnectMessage:error?.message},"WhatsApp pairing socket closed");
   if(code===DisconnectReason.loggedOut){
    const {error:saveError}=await admin.from("bot_instances").update({connection_status:"logged_out",bot_status:"stopped",is_active:false,auth_state_ciphertext:null}).eq("id",botId);
    if(saveError)logger.error({err:saveError,requestId,botId},"Could not persist logged-out state");
   }else{
    const {error:stateError}=await admin.from("bot_instances").update({connection_status:"disconnected",bot_status:"stopped",is_active:false}).eq("id",botId);
    if(stateError)logger.warn({err:stateError,requestId,botId,disconnectCode:code},"Could not persist disconnected pairing state");
   }
  }
 });
 return sock;
}

async function requestPairingCodeWithRecovery({botId,phone,requestId,phoneLast4}){
 for(let attempt=1;attempt<=3;attempt++){
  const pending=pendingPairings.get(botId);
  if(!pending||pending.closing||pending.closed)throw new Error("WhatsApp pairing connection closed before a code could be generated");
  const socket=pending.sock;
  if(!socket)throw new Error("WhatsApp pairing socket is not ready");
  let timeout;
  try{
   logger.info({requestId,botId,phoneLast4,attempt},"Requesting WhatsApp pairing code");
   return await Promise.race([
    socket.requestPairingCode(phone),
    new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error("Timed out waiting for WhatsApp to generate a pairing code")),20_000);})
   ]);
  }catch(error){
   if(attempt===3)throw error;
   const replaced=await new Promise(resolve=>{
    const started=Date.now();
    const check=()=>{
     const latest=pendingPairings.get(botId);
     if(!latest||latest.closing||latest.closed)return resolve(false);
     if(latest.sock&&latest.sock!==socket)return resolve(true);
     if(Date.now()-started>=3_000)return resolve(false);
     setTimeout(check,100);
    };
    check();
   });
   if(!replaced)throw error;
   logger.warn({requestId,botId,phoneLast4,attempt},"WhatsApp replaced the pairing socket; retrying pairing-code request");
  }finally{clearTimeout(timeout);}
 }
 throw new Error("WhatsApp could not generate a pairing code");
}
async function ensureProfile(user){
 const {data:p,error:profileReadError}=await admin.from("profiles").select("id").eq("id",user.id).maybeSingle();
 if(profileReadError)throw profileReadError;
 if(!p){const {error}=await admin.from("profiles").upsert({id:user.id,email:user.email,display_name:user.user_metadata?.full_name||user.email?.split("@")[0]||"MICKY-XMD User"});if(error)throw error;}
 const {error:walletError}=await admin.from("wallets").upsert({user_id:user.id},{onConflict:"user_id",ignoreDuplicates:true});
 if(walletError)throw walletError;
}
app.get("/health",(_req,res)=>res.json({ok:true,service:"micky-xmd-web",time:new Date().toISOString()}));
async function cleanupStalePairingRows(){
 const cutoff=new Date(Date.now()-10*60*1000).toISOString();
 const {data,error}=await admin.from("bot_instances").update({connection_status:"disconnected",bot_status:"stopped",is_active:false}).eq("connection_status","pairing").lt("created_at",cutoff).select("id");
 if(error)logger.error({err:error},"Could not clean up stale WhatsApp pairing records");
 else if(data?.length)logger.info({count:data.length},"Cleaned up stale WhatsApp pairing records");
}
cleanupStalePairingRows().catch(err=>logger.error({err},"Stale pairing cleanup failed at startup"));
setInterval(async()=>{const cutoff=Date.now()-10*60*1000;for(const [botId,pair] of pendingPairings){if(!pair.connected&&pair.tokenShownAt<cutoff){pair.closing=true;try{pair.sock.end(undefined);}catch{}pendingPairings.delete(botId);await admin.from("bot_instances").update({connection_status:"disconnected",bot_status:"stopped",is_active:false}).eq("id",botId);}}},60_000).unref();
app.post("/api/auth/signup",async(req,res,next)=>{try{
 const {email,password}=z.object({email:z.string().email(),password:z.string().min(8)}).parse(req.body);
 const {data,error}=await createAuthClient().auth.signUp({email,password});if(error)throw error;
 if(data.session){await ensureProfile(data.user);setAuthCookie(res,data.session);}
 res.json({ok:true,confirmation_required:!data.session});
}catch(e){next(e);}});
app.post("/api/auth/login",async(req,res,next)=>{try{
 const {email,password}=z.object({email:z.string().email(),password:z.string().min(8)}).parse(req.body);
 const {data,error}=await createAuthClient().auth.signInWithPassword({email,password});if(error)throw error;
 await ensureProfile(data.user);setAuthCookie(res,data.session);res.json({ok:true});
}catch(e){next(e);}});
app.post("/api/auth/logout",authenticate,async(req,res,next)=>{try{
 await admin.auth.admin.signOut(req.accessToken);clearAuthCookies(res);res.json({ok:true});
}catch(e){clearAuthCookies(res);res.json({ok:true});}});
app.patch("/api/profile",authenticate,async(req,res,next)=>{try{
 const {default_prefix}=z.object({default_prefix:z.string().min(1).max(3).regex(/^[^\s]+$/)}).parse(req.body);
 const {error}=await admin.from("profiles").update({default_prefix}).eq("id",req.user.id);if(error)throw error;
 res.json({ok:true,default_prefix});
}catch(e){next(e);}});
app.get("/api/dashboard",authenticate,async(req,res,next)=>{try{
 await ensureProfile(req.user);
 const [{data:wallet,error:we},{data:bots,error:be}] = await Promise.all([
  admin.from("wallets").select("balance,currency,status").eq("user_id",req.user.id).maybeSingle(),
  admin.from("bot_instances").select("id,bot_name,connection_status,bot_status,subscription_status,expires_at,whatsapp_number,created_at").eq("user_id",req.user.id).order("created_at",{ascending:false})
 ]);
 if(we)throw we;if(be)throw be;res.json({wallet:wallet||{balance:0,currency:"KES"},bots:bots||[]});
}catch(e){next(e);}});
app.post("/api/pair",authenticate,pairingLimiter,async(req,res,next)=>{
 const requestId=randomUUID();let stage="validate_request";let botId=null;let phoneLast4=null;
 try{
  const {phone_number}=z.object({phone_number:z.string().trim().min(8).max(24)}).parse(req.body);const phone=normalizeWhatsAppNumber(phone_number);phoneLast4=phone.slice(-4);
  stage="close_previous_pending_pairings";
  for(const [existingId,existing] of pendingPairings){if(existing.userId===req.user.id&&!existing.connected){existing.closing=true;try{existing.sock.end(undefined);}catch{}pendingPairings.delete(existingId);const {error:closeError}=await admin.from("bot_instances").update({connection_status:"disconnected",bot_status:"stopped",is_active:false}).eq("id",existingId);if(closeError)logger.warn({err:closeError,requestId,botId:existingId},"Could not mark previous pairing as disconnected");}}
  stage="create_bot_record";
  const sessionToken=randomSessionToken(),tokenHash=sha256(sessionToken);
  const {data:row,error}=await admin.from("bot_instances").insert({user_id:req.user.id,bot_name:"My MICKY-XMD Bot",session_id_hash:tokenHash,session_last4:sessionToken.slice(-4),whatsapp_number:phone,connection_status:"pairing",bot_status:"stopped",is_active:false,metadata:{pairing_requested_at:new Date().toISOString(),pairing_request_id:requestId}}).select("id").single();
  if(error)throw error;botId=row.id;
  let sock;
  let codeWaiter;
  try{
   stage="initialize_remote_auth";
   const remote=await createRemoteAuthState(row.id);
   stage="persist_initial_auth";
   await remote.saveCreds();
   stage="initialize_whatsapp_socket";
   codeWaiter=createPairingCodeWaiter(55_000);
   const pending={sock:null,remote,userId:req.user.id,tokenShownAt:Date.now(),qr:null,closing:false,closed:false,restartAttempts:0,method:"phone",pairingCodeRequested:false,codeWaiter};
   pending.startPairingCode=createOnceAsync(async()=>{
    if(pending.closing||pending.closed)throw new Error("WhatsApp pairing session is no longer active.");
    if(remote.state.creds.registered)throw new Error("This pairing session already contains registered WhatsApp credentials. Start a fresh session.");
    pending.pairingCodeRequested=true;
    try{
     const generated=await requestPairingCodeWithRecovery({botId:row.id,phone,requestId,phoneLast4});
     codeWaiter.resolve(generated);
     return generated;
    }catch(pairingError){codeWaiter.reject(pairingError);throw pairingError;}
   });
   pendingPairings.set(row.id,pending);
   sock=attachPairingSocket({botId:row.id,remote,requestId,phoneLast4});
   stage="wait_for_baileys_pairing_ready_event";
   // Baileys emits connection.update with qr when the socket is ready.
   // The socket handler above requests the code once, at that point.
   const pairingCode=await codeWaiter.promise;
   codeWaiter.cancel();
   stage="validate_pairing_response";
   const normalizedCode=normalizePairingCode(pairingCode);
   if(!/^MICKY~[A-Za-z0-9_-]{20,}$/.test(sessionToken))throw new Error("Session token generation failed validation");
   logger.info({requestId,botId:row.id,phoneLast4,codeLength:normalizedCode.length,sessionTokenPresent:true},"WhatsApp pairing response generated");
   res.json({ok:true,pairing_code:normalizedCode,session_id:sessionToken,bot_id:row.id,message:"Enter the pairing code in WhatsApp. Copy the session ID now; it is shown only once."});
  }catch(err){
   codeWaiter?.cancel();
   const failedStage=stage;const pending=pendingPairings.get(row.id);if(pending){pending.closing=true;pendingPairings.delete(row.id);}
   try{(pending?.sock||sock)?.end(undefined);}catch{}
   const {error:stateError}=await admin.from("bot_instances").update({connection_status:"error",bot_status:"error",is_active:false,metadata:{pairing_failed_at:new Date().toISOString(),pairing_request_id:requestId,pairing_failure_stage:failedStage}}).eq("id",row.id);
   if(stateError)logger.error({err:stateError,requestId,botId:row.id,failedStage},"Could not persist pairing failure state");
   logger.error({err,requestId,botId:row.id,phoneLast4,failedStage},"WhatsApp pairing request failed");
   const rawMessage=String(err?.message||"");
   const safeMessage=/timed out/i.test(rawMessage)
    ?"WhatsApp did not finish generating a pairing code in time. Try again shortly or use QR pairing."
    :/429|rate.?limit|over.?limit/i.test(rawMessage)
     ?"WhatsApp temporarily limited pairing requests. Wait a minute before trying again."
     :/connection|socket|closed|open/i.test(rawMessage)
      ?"WhatsApp closed the pairing connection before the code was ready. Please retry once."
      :"WhatsApp could not generate a pairing code right now. QR pairing remains available.";
   return res.status(502).json({error:"WhatsApp pairing code unavailable",message:safeMessage,stage:failedStage});
  }
 }catch(err){logger.error({err,requestId,botId,phoneLast4,stage},"Pairing API request failed");next(err);}
});
app.post("/api/pair/qr",authenticate,pairingLimiter,async(req,res,next)=>{
 const requestId=randomUUID();let botId=null;let phoneLast4=null;
 try{
  for(const [existingId,existing] of pendingPairings){
   if(existing.userId===req.user.id&&!existing.connected){
    existing.closing=true;try{existing.sock?.end(undefined);}catch{}
    pendingPairings.delete(existingId);
    await admin.from("bot_instances").update({connection_status:"disconnected",bot_status:"stopped",is_active:false}).eq("id",existingId);
   }
  }
  const sessionToken=randomSessionToken(),tokenHash=sha256(sessionToken);
  const {data:row,error}=await admin.from("bot_instances").insert({
   user_id:req.user.id,bot_name:"My MICKY-XMD Bot",session_id_hash:tokenHash,
   session_last4:sessionToken.slice(-4),connection_status:"pairing",bot_status:"stopped",
   is_active:false,metadata:{pairing_method:"qr",pairing_requested_at:new Date().toISOString(),pairing_request_id:requestId}
  }).select("id").single();
  if(error)throw error;botId=row.id;
  const remote=await createRemoteAuthState(row.id);
  await remote.saveCreds();
  pendingPairings.set(row.id,{sock:null,remote,userId:req.user.id,tokenShownAt:Date.now(),qr:null,qrRevision:0,closing:false,closed:false,connected:false,connection:"connecting",lastError:null,restartAttempts:0,method:"qr"});
  const sock=attachPairingSocket({botId:row.id,remote,requestId,phoneLast4});
  logger.info({requestId,botId:row.id,method:"qr"},"Started fresh WhatsApp QR pairing session");
  return res.json({ok:true,bot_id:row.id,session_id:sessionToken,message:"A fresh QR session has started. Keep this Session ID private; it is shown only once."});
 }catch(err){
  logger.error({err,requestId,botId},"Could not start WhatsApp QR pairing session");
  if(botId){
   const pending=pendingPairings.get(botId);if(pending){pending.closing=true;pendingPairings.delete(botId);}
   try{pending?.sock?.end(undefined);}catch{}
   await admin.from("bot_instances").update({connection_status:"error",bot_status:"error",is_active:false,metadata:{pairing_method:"qr",pairing_failed_at:new Date().toISOString(),pairing_request_id:requestId}}).eq("id",botId);
  }
  next(err);
 }
});
app.get("/api/pair/qr",authenticate,async(req,res,next)=>{try{
 const {data:bot,error}=await admin.from("bot_instances").select("id,connection_status").eq("user_id",req.user.id).order("created_at",{ascending:false}).limit(1).maybeSingle();
 if(error)throw error;
 if(!bot||!["pairing","connected"].includes(bot.connection_status))return res.status(404).json({error:"No active pairing request. Start a fresh QR session."});
 if(bot.connection_status==="connected")return res.json({connected:true,message:"WhatsApp account connected successfully."});
 const pending=pendingPairings.get(bot.id);if(!pending)return res.status(410).json({error:"The pairing service restarted. Start a fresh QR session."});
 if(pending.connected)return res.json({connected:true,message:"WhatsApp account connected successfully."});
 if(pending.closed)return res.status(410).json({error:"WhatsApp pairing connection closed. Start a fresh QR session."});
 if(!pending.qr)return res.status(202).json({message:"QR is still being generated. Keep waiting.",connection:pending.connection||"connecting"});
 res.json({qr_data_url:pending.qr,connection:pending.connection||"connecting"});
}catch(e){next(e);}});
app.post("/api/bots/deploy",authenticate,async(req,res,next)=>{try{
 const input=z.object({session_id:z.string().regex(/^MICKY~[A-Za-z0-9_-]{20,}$/),bot_name:z.string().min(2).max(48).optional(),command_prefix:z.string().min(1).max(3).optional(),bot_mode:z.enum(["public","self"]).optional(),auto_view_status:z.boolean().optional(),auto_react_status:z.boolean().optional(),anti_delete_enabled:z.boolean().optional(),anti_link_enabled:z.boolean().optional(),auto_read:z.boolean().optional(),always_online:z.boolean().optional(),auto_react_emoji:z.string().min(1).max(8).optional()}).parse(req.body);
 const {data:bot,error:be}=await admin.from("bot_instances").select("id,connection_status,auth_state_ciphertext").eq("session_id_hash",sha256(input.session_id)).eq("user_id",req.user.id).single();
 if(be)throw be;if(bot.connection_status!=="connected"||!bot.auth_state_ciphertext)return res.status(409).json({error:"Pair this WhatsApp account before deployment."});
 const {data:deployment,error:deployError}=await admin.rpc("deploy_bot_v2",{
  p_user_id:req.user.id,p_bot_id:bot.id,p_bot_name:input.bot_name||"My MICKY-XMD Bot",
  p_prefix:input.command_prefix||".",p_mode:input.bot_mode||"public",
  p_auto_view:!!input.auto_view_status,p_auto_react:!!input.auto_react_status,
  p_anti_delete:!!input.anti_delete_enabled,p_anti_link:!!input.anti_link_enabled,p_auto_read:!!input.auto_read,p_always_online:!!input.always_online,p_auto_react_emoji:input.auto_react_emoji||"💚"
 });
 if(deployError)throw deployError;
 const expires=deployment?.[0]?.expires_at;
 const pending=pendingPairings.get(bot.id);if(pending){pending.closing=true;try{pending.sock.end(undefined);}catch{}pendingPairings.delete(bot.id);}
 res.json({ok:true,message:"Bot deployment started.",balance:deployment?.[0]?.new_balance??null,expires_at:expires});
}catch(e){next(e);}});
app.get("/api/bots/recovery",authenticate,async(req,res,next)=>{try{
 const {data,error}=await admin.from("bot_instances").select("id,bot_name,connection_status,bot_status,subscription_status,expires_at,session_last4").eq("user_id",req.user.id).in("connection_status",["disconnected","logged_out","error"]);
 if(error)throw error;res.json({bots:data||[]});
}catch(e){next(e);}});
app.post("/api/payments/stk",authenticate,async(req,res,next)=>{try{
 const {phone_number,amount}=z.object({phone_number:phoneSchema,amount:z.number().int().min(1).max(150000)}).parse(req.body);
 const phone=normalPhone(phone_number);
 const {data:payment,error}=await admin.from("payment_requests").insert({user_id:req.user.id,amount,phone_number:phone,status:"pending"}).select("id").single();if(error)throw error;
 const response=await stkPush({phone,amount,accountReference:payment.id.replaceAll("-","").slice(0,12),description:"MICKY-XMD wallet"});
 const {error:up}=await admin.from("payment_requests").update({merchant_request_id:response.MerchantRequestID,checkout_request_id:response.CheckoutRequestID}).eq("id",payment.id);if(up)throw up;
 res.json({ok:true,message:"STK Push sent. Complete the prompt on your phone.",checkout_request_id:response.CheckoutRequestID});
}catch(e){next(e);}});
app.post("/api/payments/mpesa-callback",async(req,res,next)=>{try{
 if(!verifyCallbackSecret(req))return res.status(401).json({ResultCode:1,ResultDesc:"Unauthorized"});
 const body=req.body?.Body?.stkCallback;if(!body?.CheckoutRequestID)return res.status(400).json({ResultCode:1,ResultDesc:"Invalid callback"});
 const {data:payment,error}=await admin.from("payment_requests").select("*").eq("checkout_request_id",body.CheckoutRequestID).maybeSingle();
 if(error)throw error;if(!payment)return res.json({ResultCode:0,ResultDesc:"Acknowledged"});
 if(payment.status==="completed"||payment.status==="failed")return res.json({ResultCode:0,ResultDesc:"Already processed"});
 const success=Number(body.ResultCode)===0;
 if(success){
  const items=body.CallbackMetadata?.Item||[];
  const paidAmount=Number(items.find(x=>x.Name==="Amount")?.Value);
  const paidPhone=String(items.find(x=>x.Name==="PhoneNumber")?.Value||"");
  if(paidAmount!==Number(payment.amount)||paidPhone!==String(payment.phone_number))throw new Error("M-Pesa callback amount or phone does not match the pending request");
  const receipt=items.find(x=>x.Name==="MpesaReceiptNumber")?.Value||body.CheckoutRequestID;
  const {error:creditErr}=await admin.rpc("wallet_credit",{p_user_id:payment.user_id,p_amount:payment.amount,p_type:"topup",p_provider:"mpesa",p_reference:String(receipt),p_metadata:{checkout_request_id:body.CheckoutRequestID}});
  if(creditErr)throw creditErr;
 }
 await admin.from("payment_requests").update({status:success?"completed":"failed",result_code:String(body.ResultCode),result_description:body.ResultDesc,provider_reference:body.CheckoutRequestID,callback_payload:body}).eq("id",payment.id).eq("status","pending");
 res.json({ResultCode:0,ResultDesc:"Accepted"});
}catch(e){logger.error(e);res.status(500).json({ResultCode:1,ResultDesc:"Callback processing failed"});}});
app.use((err,req,res,_next)=>{const status=err.name==="ZodError"?400:500;logger.error({err,message:err.message,method:req.method,path:req.path,status},"API request failed");res.status(status).json({error:status===400?err.issues?.[0]?.message||"Invalid request":"Request failed"});});
const port=Number(process.env.PORT||3000);
const server=app.listen(port,()=>logger.info({port},"MICKY-XMD web/API process listening"));
let shuttingDown=false;
async function shutdown(signal){
 if(shuttingDown)return;shuttingDown=true;
 logger.info({signal},"Stopping MICKY-XMD web/API process gracefully");
 const pending=[...pendingPairings.entries()].filter(([,pair])=>!pair.connected);
 for(const [botId,pair] of pending){
  pair.closing=true;
  try{pair.sock?.end(undefined);}catch{}
  pendingPairings.delete(botId);
 }
 await Promise.all(pending.map(async([botId])=>{
  const {error}=await admin.from("bot_instances").update({
   connection_status:"disconnected",bot_status:"stopped",is_active:false
  }).eq("id",botId).eq("connection_status","pairing");
  if(error)logger.warn({err:error,botId},"Could not persist pending-pairing shutdown state");
 }));
 await new Promise(resolve=>server.close(resolve));
 process.exit(0);
}
process.once("SIGTERM",()=>void shutdown("SIGTERM"));
process.once("SIGINT",()=>void shutdown("SIGINT"));