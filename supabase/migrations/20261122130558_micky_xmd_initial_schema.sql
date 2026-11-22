create extension if not exists pgcrypto;
create schema if not exists private;
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text,email text,phone_number text,avatar_url text,
 default_prefix text not null default '.',timezone text not null default 'Africa/Nairobi',
 currency text not null default 'KES' check(currency='KES'),
 account_status text not null default 'active' check(account_status in ('active','suspended','closed')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.wallets (
 id uuid primary key default gen_random_uuid(),user_id uuid not null unique references public.profiles(id) on delete cascade,
 balance numeric(14,2) not null default 0 check(balance>=0),currency text not null default 'KES' check(currency='KES'),
 status text not null default 'active' check(status in ('active','frozen')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.wallet_transactions (
 id uuid primary key default gen_random_uuid(),wallet_id uuid not null references public.wallets(id) on delete restrict,
 user_id uuid not null references public.profiles(id) on delete restrict,
 transaction_type text not null check(transaction_type in ('topup','bot_deployment','subscription','refund','adjustment')),
 direction text not null check(direction in ('credit','debit')),amount numeric(14,2) not null check(amount>0),
 balance_before numeric(14,2) not null,balance_after numeric(14,2) not null,
 currency text not null default 'KES' check(currency='KES'),provider text,provider_reference text,
 status text not null default 'completed' check(status in ('pending','completed','failed','reversed')),
 metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),
 unique(provider,provider_reference)
);
create index if not exists wallet_tx_user_created_idx on public.wallet_transactions(user_id,created_at desc);
create table if not exists public.bot_instances (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 bot_name text not null default 'My MICKY-XMD Bot',session_id_hash text not null unique,session_last4 text not null,
 whatsapp_number text,whatsapp_jid text,auth_state_ciphertext text,encryption_key_version integer not null default 1,
 connection_status text not null default 'pending' check(connection_status in ('pending','pairing','connected','disconnected','logged_out','error')),
 bot_status text not null default 'stopped' check(bot_status in ('stopped','starting','running','paused','expired','error')),
 mode text not null default 'public' check(mode in ('public','self')),command_prefix text not null default '.',
 subscription_status text not null default 'inactive' check(subscription_status in ('inactive','active','expired','cancelled')),
 monthly_fee numeric(10,2) not null default 150 check(monthly_fee>=0),started_at timestamptz,expires_at timestamptz,
 auto_renew boolean not null default false,heartbeat_at timestamptz,connected_at timestamptz,
 reconnect_attempts integer not null default 0,is_active boolean not null default false,
 auto_view_status boolean not null default false,auto_react_status boolean not null default false,
 auto_read_messages boolean not null default false,anti_delete_enabled boolean not null default false,
 anti_link_enabled boolean not null default false,
 human_delay_min_ms integer not null default 2000 check(human_delay_min_ms between 2000 and 6000),
 human_delay_max_ms integer not null default 6000 check(human_delay_max_ms between human_delay_min_ms and 6000),
 metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists bot_instances_worker_idx on public.bot_instances(is_active,bot_status,expires_at);
create table if not exists public.group_configs (
 id uuid primary key default gen_random_uuid(),bot_instance_id uuid not null references public.bot_instances(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,chat_jid text not null,group_name text,
 anti_link_enabled boolean not null default false,welcome_enabled boolean not null default false,
 goodbye_enabled boolean not null default false,anti_spam_enabled boolean not null default false,admin_only boolean not null default false,
 deleted_cache_enabled boolean not null default false,retention_hours integer not null default 24 check(retention_hours between 1 and 168),
 settings jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(bot_instance_id,chat_jid)
);
create table if not exists public.deleted_messages_cache (
 id uuid primary key default gen_random_uuid(),bot_instance_id uuid not null references public.bot_instances(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,chat_jid text not null,message_id text not null,
 sender_jid text,message_type text,message_content jsonb not null,created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '24 hours'),unique(bot_instance_id,chat_jid,message_id)
);
create index if not exists deleted_cache_expiry_idx on public.deleted_messages_cache(expires_at);
create table if not exists public.api_keys (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 key_name text not null,key_prefix text not null,key_hash text not null unique,scopes text[] not null default '{}',
 is_active boolean not null default true,last_used_at timestamptz,expires_at timestamptz,revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.payment_requests (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 amount numeric(14,2) not null check(amount>=1),phone_number text not null,merchant_request_id text,
 checkout_request_id text unique,provider_reference text unique,
 status text not null default 'pending' check(status in ('pending','completed','failed','cancelled')),
 result_code text,result_description text,callback_payload jsonb,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.bot_instances enable row level security;
alter table public.group_configs enable row level security;
alter table public.deleted_messages_cache enable row level security;
alter table public.api_keys enable row level security;
alter table public.payment_requests enable row level security;
create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid())=id);
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);
create policy wallets_select_own on public.wallets for select to authenticated using ((select auth.uid())=user_id);
create policy wallet_tx_select_own on public.wallet_transactions for select to authenticated using ((select auth.uid())=user_id);
create policy bots_select_own on public.bot_instances for select to authenticated using ((select auth.uid())=user_id);
create policy groups_select_own on public.group_configs for select to authenticated using ((select auth.uid())=user_id);
create policy deleted_cache_select_own on public.deleted_messages_cache for select to authenticated using ((select auth.uid())=user_id);
create policy payment_requests_select_own on public.payment_requests for select to authenticated using ((select auth.uid())=user_id);
create policy api_keys_deny_client_access on public.api_keys for all to anon,authenticated using(false) with check(false);
revoke all on public.profiles,public.wallets,public.wallet_transactions,public.bot_instances,public.group_configs,public.deleted_messages_cache,public.api_keys,public.payment_requests from anon,authenticated;
grant select on public.profiles,public.wallets,public.wallet_transactions,public.group_configs,public.deleted_messages_cache,public.payment_requests to authenticated;
grant select(id,user_id,bot_name,whatsapp_number,whatsapp_jid,connection_status,bot_status,mode,command_prefix,subscription_status,monthly_fee,started_at,expires_at,auto_renew,heartbeat_at,connected_at,reconnect_attempts,is_active,auto_view_status,auto_react_status,auto_read_messages,anti_delete_enabled,anti_link_enabled,created_at,updated_at) on public.bot_instances to authenticated;
grant update(display_name,phone_number,avatar_url,default_prefix,timezone) on public.profiles to authenticated;
revoke all on public.api_keys from anon,authenticated;
revoke insert,update,delete on public.wallets,public.wallet_transactions,public.bot_instances,public.group_configs,public.deleted_messages_cache,public.payment_requests from anon,authenticated;
create or replace function public.wallet_credit(p_user_id uuid,p_amount numeric,p_type text,p_provider text default null,p_reference text default null,p_metadata jsonb default '{}'::jsonb)
returns table(transaction_id uuid,new_balance numeric) language plpgsql security invoker set search_path=public,pg_temp as $$
declare w public.wallets%rowtype; tx uuid;
begin
 if p_amount is null or p_amount<=0 or p_amount>1000000 or p_type not in ('topup','refund','adjustment') then raise exception 'Invalid credit'; end if;
 select * into w from public.wallets where user_id=p_user_id and status='active' for update;
 if not found then raise exception 'Active wallet not found'; end if;
 if p_provider is not null and p_reference is not null then
  perform pg_advisory_xact_lock(hashtextextended(p_provider||':'||p_reference,0));
  select id,balance_after into tx,new_balance from public.wallet_transactions where provider=p_provider and provider_reference=p_reference and status='completed';
  if found then transaction_id:=tx;return next;return;end if;
 end if;
 update public.wallets set balance=balance+p_amount,updated_at=now() where id=w.id returning balance into new_balance;
 insert into public.wallet_transactions(wallet_id,user_id,transaction_type,direction,amount,balance_before,balance_after,provider,provider_reference,metadata)
 values(w.id,p_user_id,p_type,'credit',p_amount,w.balance,new_balance,p_provider,p_reference,coalesce(p_metadata,'{}'::jsonb)) returning id into tx;
 transaction_id:=tx;return next;
end $$;
create or replace function public.wallet_debit(p_user_id uuid,p_amount numeric,p_type text,p_metadata jsonb default '{}'::jsonb)
returns table(transaction_id uuid,new_balance numeric) language plpgsql security invoker set search_path=public,pg_temp as $$
declare w public.wallets%rowtype; tx uuid;
begin
 if p_amount is null or p_amount<=0 or p_amount>1000000 or p_type not in ('bot_deployment','subscription') then raise exception 'Invalid debit'; end if;
 select * into w from public.wallets where user_id=p_user_id and status='active' for update;
 if not found then raise exception 'Active wallet not found'; end if;
 if w.balance<p_amount then raise exception 'Insufficient wallet balance'; end if;
 update public.wallets set balance=balance-p_amount,updated_at=now() where id=w.id returning balance into new_balance;
 insert into public.wallet_transactions(wallet_id,user_id,transaction_type,direction,amount,balance_before,balance_after,metadata)
 values(w.id,p_user_id,p_type,'debit',p_amount,w.balance,new_balance,coalesce(p_metadata,'{}'::jsonb)) returning id into tx;
 transaction_id:=tx;return next;
end $$;
create or replace function public.deploy_bot(p_user_id uuid,p_bot_id uuid,p_bot_name text,p_prefix text,p_mode text,p_auto_view boolean,p_auto_react boolean,p_anti_delete boolean,p_anti_link boolean,p_auto_read boolean)
returns table(new_balance numeric,expires_at timestamptz) language plpgsql security invoker set search_path=public,pg_temp as $$
declare w public.wallets%rowtype; b public.bot_instances%rowtype; after_balance numeric; exp timestamptz;
begin
 select * into b from public.bot_instances where id=p_bot_id and user_id=p_user_id for update;
 if not found then raise exception 'Bot session not found for this account'; end if;
 if b.is_active and b.subscription_status='active' and b.expires_at>now() then
  select balance into new_balance from public.wallets where user_id=p_user_id; expires_at:=b.expires_at;return next;return;
 end if;
 if b.connection_status<>'connected' or b.auth_state_ciphertext is null then raise exception 'Pair this WhatsApp account before deployment'; end if;
 select * into w from public.wallets where user_id=p_user_id and status='active' for update;
 if not found then raise exception 'Active wallet not found'; end if;
 if w.balance<150 then raise exception 'Insufficient wallet balance'; end if;
 update public.wallets set balance=balance-150,updated_at=now() where id=w.id returning balance into after_balance;
 insert into public.wallet_transactions(wallet_id,user_id,transaction_type,direction,amount,balance_before,balance_after,metadata)
 values(w.id,p_user_id,'bot_deployment','debit',150,w.balance,after_balance,jsonb_build_object('bot_id',p_bot_id,'plan','monthly'));
 exp:=now()+interval '30 days';
 update public.bot_instances set bot_name=coalesce(nullif(p_bot_name,''),'My MICKY-XMD Bot'),command_prefix=coalesce(nullif(p_prefix,''),'.'),
 mode=case when p_mode in ('public','self') then p_mode else 'public' end,auto_view_status=coalesce(p_auto_view,false),
 auto_react_status=coalesce(p_auto_react,false),anti_delete_enabled=coalesce(p_anti_delete,false),
 anti_link_enabled=coalesce(p_anti_link,false),auto_read_messages=coalesce(p_auto_read,false),bot_status='starting',
 subscription_status='active',started_at=now(),expires_at=exp,is_active=true,reconnect_attempts=0,updated_at=now() where id=p_bot_id;
 new_balance:=after_balance;expires_at:=exp;return next;
end $$;
revoke all on function public.wallet_credit(uuid,numeric,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.wallet_debit(uuid,numeric,text,jsonb) from public,anon,authenticated;
revoke all on function public.deploy_bot(uuid,uuid,text,text,text,boolean,boolean,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.wallet_credit(uuid,numeric,text,text,text,jsonb) to service_role;
grant execute on function public.wallet_debit(uuid,numeric,text,jsonb) to service_role;
grant execute on function public.deploy_bot(uuid,uuid,text,text,text,boolean,boolean,boolean,boolean,boolean) to service_role;
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin new.updated_at=now();return new;end $$;
do $$ declare t text; begin foreach t in array array['profiles','wallets','bot_instances','group_configs','payment_requests'] loop
 execute format('drop trigger if exists touch_updated_at on public.%I',t);
 execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()',t);
end loop; end $$;