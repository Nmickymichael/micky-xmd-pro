import { createAuthClient } from "./supabase.js";
const cookieName=process.env.AUTH_COOKIE_NAME||"micky_access";
function cookies(header=""){return Object.fromEntries(header.split(";").map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf("=");return [x.slice(0,i),decodeURIComponent(x.slice(i+1))]}));}
export async function authenticate(req,res,next){
 try{
  const jar=cookies(req.headers.cookie||"");
  let token=(req.headers.authorization||"").replace(/^Bearer\s+/i,"")||jar[cookieName];
  if(!token) return res.status(401).json({error:"Sign in required"});
  const authClient=createAuthClient();
  let result=await authClient.auth.getUser(token);
  if((result.error||!result.data.user)&&jar.micky_refresh){
   const refreshed=await authClient.auth.refreshSession({refresh_token:jar.micky_refresh});
   if(!refreshed.error&&refreshed.data.session){setAuthCookie(res,refreshed.data.session);token=refreshed.data.session.access_token;result={data:{user:refreshed.data.user},error:null};}
  }
  if(result.error||!result.data.user) return res.status(401).json({error:"Session expired. Sign in again."});
  req.user=result.data.user;req.accessToken=token;next();
 }catch(e){next(e);}
}
export function setAuthCookie(res,session){
 const secure=process.env.NODE_ENV==="production";
 res.cookie(cookieName,session.access_token,{httpOnly:true,secure,sameSite:"lax",path:"/",maxAge:session.expires_in*1000});
 res.cookie("micky_refresh",session.refresh_token,{httpOnly:true,secure,sameSite:"lax",path:"/",maxAge:30*86400*1000});
}
export function clearAuthCookies(res){
 const secure=process.env.NODE_ENV==="production";
 res.clearCookie(cookieName,{httpOnly:true,secure,sameSite:"lax",path:"/"});
 res.clearCookie("micky_refresh",{httpOnly:true,secure,sameSite:"lax",path:"/"});
}