import { createClient } from "@supabase/supabase-js";
const url=process.env.SUPABASE_URL, service=process.env.SUPABASE_SERVICE_ROLE_KEY, anon=process.env.SUPABASE_ANON_KEY;
if(!url||!service||!anon) throw new Error("Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY");
export const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
export const createAuthClient=()=>createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
export const publicClient=createAuthClient();