const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function statusAutomation({sock,msg,bot,args,admin}) {
 const cmd=(msg.message?.conversation||msg.message?.extendedTextMessage?.text||"").split(/\s+/)[0].slice((bot.command_prefix||".").length).toLowerCase();
 if(cmd==="autoview"||cmd==="autoreact"){
  const enabled=(args[0]||"").toLowerCase()==="on",field=cmd==="autoview"?"auto_view_status":"auto_react_status";
  const {error}=await admin.from("bot_instances").update({[field]:enabled}).eq("id",bot.id);if(error)throw error;bot[field]=enabled;
  await sock.sendMessage(msg.key.remoteJid,{text:`${cmd} ${enabled?"enabled":"disabled"}.`},{quoted:msg});return;
 }
 if(msg.key.remoteJid!=="status@broadcast")return;
 if(!bot.auto_view_status&&!bot.auto_react_status)return;
 const delay=2000+Math.floor(Math.random()*4001);await sleep(delay);
 if(bot.auto_view_status)try{await sock.readMessages([msg.key]);}catch{}
 if(bot.auto_react_status)try{await sock.sendMessage(msg.key.participant||msg.key.remoteJid,{react:{text:"💚",key:msg.key}});}catch{}
}