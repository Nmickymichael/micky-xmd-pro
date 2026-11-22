import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const run=(args)=>new Promise((resolve,reject)=>{const p=spawn(process.env.YTDLP_PATH||"yt-dlp",args,{stdio:["ignore","pipe","pipe"]});let out="",err="";p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);p.on("error",reject);p.on("close",c=>c===0?resolve(out.trim()):reject(new Error(err.slice(-700)||"yt-dlp failed")));});
export async function downloader({sock,msg,args}) {
 const cmd=(msg.message?.conversation||msg.message?.extendedTextMessage?.text||"").split(/\s+/)[0].slice(1).toLowerCase(),url=args[0];
 let parsed;try{parsed=new URL(url);}catch{}
 if(!parsed||!/^https?:$/.test(parsed.protocol)||!["tiktok","vm.tiktok.com","www.tiktok.com","youtube.com","www.youtube.com","youtu.be","m.youtube.com"].includes(parsed.hostname.toLowerCase()))return sock.sendMessage(msg.key.remoteJid,{text:"Use a public TikTok URL with .tiktok or a YouTube URL with .ytmp3."},{quoted:msg});
 if(!["tiktok","ytmp3"].includes(cmd))return;
 if(cmd==="tiktok"&&!parsed.hostname.toLowerCase().includes("tiktok"))return sock.sendMessage(msg.key.remoteJid,{text:".tiktok requires a TikTok URL."},{quoted:msg});
 if(cmd==="ytmp3"&&!(["youtube.com","www.youtube.com","youtu.be","m.youtube.com"].includes(parsed.hostname.toLowerCase())))return sock.sendMessage(msg.key.remoteJid,{text:".ytmp3 requires a YouTube URL."},{quoted:msg});
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"micky-xmd-"));
 try{
  const output=path.join(tmp,cmd==="ytmp3"?"audio.%(ext)s":"video.%(ext)s");
  await run(["--no-playlist","--max-filesize","45M","--socket-timeout","15","-o",output,...(cmd==="ytmp3"?["-x","--audio-format","mp3"]:["--format","mp4/best[ext=mp4]/best"]),url]);
  const files=await fs.readdir(tmp);if(!files.length)throw new Error("No downloadable media was returned");
  const file=path.join(tmp,files[0]),buffer=await fs.readFile(file);
  await sock.sendMessage(msg.key.remoteJid,cmd==="ytmp3"?{audio:buffer,mimetype:"audio/mpeg",fileName:"audio.mp3"}:{video:buffer,mimetype:"video/mp4",caption:"Downloaded with MICKY-XMD"},{quoted:msg});
 }catch(e){await sock.sendMessage(msg.key.remoteJid,{text:`Download failed: ${e.message.slice(0,180)}. Check that yt-dlp and ffmpeg are installed and the URL is public.`},{quoted:msg});}
 finally{await fs.rm(tmp,{recursive:true,force:true});}
}