import crypto from "node:crypto";
const base=process.env.MPESA_ENV==="production"?"https://api.safaricom.co.ke":"https://sandbox.safaricom.co.ke";
async function accessToken(){
 const auth=Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString("base64");
 const r=await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`,{headers:{Authorization:`Basic ${auth}`}});
 const d=await r.json();if(!r.ok||!d.access_token)throw new Error("Daraja OAuth failed");return d.access_token;
}
export async function stkPush({phone,amount,accountReference,description}){
 const token=await accessToken(),timestamp=new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14);
 const password=Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString("base64");
 const body={BusinessShortCode:process.env.MPESA_SHORTCODE,Password:password,Timestamp:timestamp,TransactionType:process.env.MPESA_TRANSACTION_TYPE||"CustomerPayBillOnline",Amount:Math.round(amount),PartyA:phone,PartyB:process.env.MPESA_SHORTCODE,PhoneNumber:phone,CallBackURL:process.env.MPESA_CALLBACK_URL,AccountReference:accountReference.slice(0,12),TransactionDesc:description.slice(0,13)};
 const r=await fetch(`${base}/mpesa/stkpush/v1/processrequest`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
 const d=await r.json();if(!r.ok||d.ResponseCode!=="0")throw new Error(d.errorMessage||d.ResponseDescription||"STK Push failed");return d;
}
export function verifyCallbackSecret(req){
 const expected=process.env.MPESA_CALLBACK_SECRET;if(!expected)return false;
 const got=req.get("x-mpesa-callback-secret")||String(req.query.secret||"");
 return got.length===expected.length&&crypto.timingSafeEqual(Buffer.from(got),Buffer.from(expected));
}