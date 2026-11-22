import sharp from "sharp";
import {downloadMediaMessage} from "@whiskeysockets/baileys";
export async function sticker({sock,msg}) {
 const source=msg.message?.imageMessage;
 if(!source)return sock.sendMessage(msg.key.remoteJid,{text:"Send an image with the caption .sticker to convert it."},{quoted:msg});
 const media=await downloadMediaMessage(msg,"buffer",{});
 const webp=await sharp(media).resize(512,512,{fit:"inside",withoutEnlargement:true}).webp({quality:82}).toBuffer();
 await sock.sendMessage(msg.key.remoteJid,{sticker:webp},{quoted:msg});
}