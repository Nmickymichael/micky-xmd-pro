import test from "node:test";
import assert from "node:assert/strict";
process.env.SESSION_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const {encryptJson,decryptJson,sha256,randomSessionToken}=await import("../server/crypto.js");
test("AES-256-GCM encrypted session round-trips JSON and buffers",()=>{
 const input={user:"micky",nested:{count:3},bytes:Buffer.from([0,1,2,255])};
 const encrypted=encryptJson(input);
 assert.notEqual(encrypted,JSON.stringify(input));
 const output=decryptJson(encrypted);
 assert.equal(output.user,input.user);
 assert.deepEqual(output.nested,input.nested);
 assert.deepEqual(output.bytes,input.bytes);
});
test("tampered ciphertext is rejected",()=>{
 const encrypted=encryptJson({ok:true});
 const parts=encrypted.split(".");
 parts[2]=Buffer.from("tampered").toString("base64");
 assert.throws(()=>decryptJson(parts.join(".")));
});
test("session token is opaque and hashable",()=>{
 const token=randomSessionToken();
 assert.match(token,/^MICKY~[A-Za-z0-9_-]{40,}$/);
 assert.equal(sha256(token).length,64);
 assert.notEqual(sha256(token),token);
});