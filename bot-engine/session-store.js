import { admin } from "../server/supabase.js";
import { decryptJson,encryptJson } from "../server/crypto.js";
import { initAuthCreds } from "@whiskeysockets/baileys";
export async function remoteAuth(botId){
 const {data:row,error}=await admin.from("bot_instances").select("auth_state_ciphertext").eq("id",botId).single();if(error)throw error;
 let payload=row.auth_state_ciphertext?decryptJson(row.auth_state_ciphertext):{creds:initAuthCreds(),keys:{}};
 const persist=async()=>{const {error:e}=await admin.from("bot_instances").update({auth_state_ciphertext:encryptJson(payload),heartbeat_at:new Date().toISOString()}).eq("id",botId);if(e)throw e;};
 return {state:{creds:payload.creds,keys:{
  get:async(type,ids)=>Object.fromEntries(ids.map(id=>[id,payload.keys[`${type}:${id}`]??null])),
  set:async(data)=>{for(const [type,entries] of Object.entries(data))for(const [id,value] of Object.entries(entries)){const k=`${type}:${id}`;if(value===null)delete payload.keys[k];else payload.keys[k]=value;}await persist();}
 }},saveCreds:async()=>{await persist();}};
}