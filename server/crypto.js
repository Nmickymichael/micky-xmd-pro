import crypto from "node:crypto";
const key = () => {
  const raw = process.env.SESSION_ENCRYPTION_KEY || "";
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new Error("SESSION_ENCRYPTION_KEY must be 32-byte hex (64 characters)");
  return Buffer.from(raw, "hex");
};
export function encryptJson(value) {
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv("aes-256-gcm",key(),iv);
  const serialized=JSON.stringify(value,(_k,v)=>v&&v.type==="Buffer"&&Array.isArray(v.data)?v:(Buffer.isBuffer(v)?{type:"Buffer",data:[...v]}:v));
  const body=Buffer.concat([cipher.update(serialized,"utf8"),cipher.final()]);
  return [iv.toString("base64"),cipher.getAuthTag().toString("base64"),body.toString("base64")].join(".");
}
export function decryptJson(value) {
  const [iv,tag,body]=String(value||"").split(".");
  if(!iv||!tag||!body) throw new Error("Invalid encrypted session payload");
  const decipher=crypto.createDecipheriv("aes-256-gcm",key(),Buffer.from(iv,"base64"));
  decipher.setAuthTag(Buffer.from(tag,"base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body,"base64")),decipher.final()]).toString("utf8"),(_k,v)=>v&&v.type==="Buffer"&&Array.isArray(v.data)?Buffer.from(v.data):v);
}
export const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
export const randomSessionToken = () => `MICKY~${crypto.randomBytes(32).toString("base64url")}`;