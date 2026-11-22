import { menu } from "./menu.js";
import { ping } from "./ping.js";
import { viewOnce } from "./vv.js";
import { antiDelete } from "./antidelete.js";
import { statusAutomation } from "./status.js";
import { sticker } from "./sticker.js";
import { downloader } from "./downloaders.js";
import { tagAll } from "./tagall.js";
import { antiLink } from "./antilink.js";
import { ai } from "./ai.js";
const commands={menu,ping,vv:viewOnce,antidelete:antiDelete,autoview:statusAutomation,autoreact:statusAutomation,sticker,tiktok:downloader,ytmp3:downloader,tagall:tagAll,antilink:antiLink,ai};
export async function handleMessage(ctx){
 const {sock,msg,bot}=ctx;
 if(!msg.message||msg.key.fromMe)return;
 if(bot.auto_read_messages)await sock.readMessages([msg.key]);
 if(msg.key.remoteJid==="status@broadcast"){await statusAutomation(ctx);return;}
 if(bot.anti_delete_enabled){
  const plain=msg.message.conversation||msg.message.extendedTextMessage?.text;
  if(plain&&!msg.message.imageMessage&&!msg.message.videoMessage&&!msg.message.viewOnceMessage&&!msg.message.viewOnceMessageV2){
   await ctx.admin.from("deleted_messages_cache").upsert({bot_instance_id:bot.id,user_id:bot.user_id,chat_jid:msg.key.remoteJid,message_id:msg.key.id,sender_jid:msg.key.participant||msg.key.remoteJid,message_type:"text",message_content:{text:plain},expires_at:new Date(Date.now()+24*3600000).toISOString()},{onConflict:"bot_instance_id,chat_jid,message_id"});
  }
 }
 await antiLink(ctx);
 const text=msg.message.conversation||msg.message.extendedTextMessage?.text||"";
 if(!text.startsWith(bot.command_prefix||"."))return;
 const [name,...args]=text.slice((bot.command_prefix||".").length).trim().split(/\s+/);
 const command=commands[name?.toLowerCase()];if(command)await command({...ctx,args,text:args.join(" ")});
}