import { admin } from "./supabase.js";
import { encryptJson,decryptJson } from "./crypto.js";
import { initAuthCreds } from "@whiskeysockets/baileys";
export async function createRemoteAuthState(botId){
 let payload={creds:initAuthCreds(),keys:{}};
 const {data:row,error}=await admin.from("bot_instances").select("auth_state_ciphertext").eq("id",botId).single();
 if(error)throw error;
 if(row.auth_state_ciphertext)payload=decryptJson(row.auth_state_ciphertext);
 const save=async()=>{const {error:e}=await admin.from("bot_instances").update({auth_state_ciphertext:encryptJson(payload)}).eq("id",botId);if(e)throw e;};
 const state={creds:payload.creds,keys:{
  get:async(type,ids)=>Object.fromEntries(ids.map(id=>[id,payload.keys[`${type}:${id}`]??null])),
  set:async(data)=>{for(const [type,entries] of Object.entries(data))for(const [id,value] of Object.entries(entries)){const k=`${type}:${id}`;if(value===null)delete payload.keys[k];else payload.keys[k]=value;}await save();}
 }};
 return {state,saveCreds:async()=>{payload.creds=state.creds;await save();},exportEncrypted:()=>encryptJson(payload)};
}