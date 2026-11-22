alter table public.bot_instances
 add column if not exists always_online boolean not null default false,
 add column if not exists auto_react_emoji text not null default '💚' check (char_length(auto_react_emoji) between 1 and 8);

create or replace function public.deploy_bot_v2(
 p_user_id uuid,p_bot_id uuid,p_bot_name text,p_prefix text,p_mode text,
 p_auto_view boolean,p_auto_react boolean,p_anti_delete boolean,p_anti_link boolean,
 p_auto_read boolean,p_always_online boolean,p_auto_react_emoji text
) returns table(new_balance numeric,expires_at timestamptz)
language plpgsql security invoker set search_path=public,pg_temp as $$
declare w public.wallets%rowtype; b public.bot_instances%rowtype; after_balance numeric; exp timestamptz;
begin
 select * into b from public.bot_instances where id=p_bot_id and user_id=p_user_id for update;
 if not found then raise exception 'Bot session not found for this account'; end if;
 if b.is_active and b.subscription_status='active' and b.expires_at>now() then
  select balance into new_balance from public.wallets where user_id=p_user_id;
  expires_at:=b.expires_at;return next;return;
 end if;
 if b.connection_status<>'connected' or b.auth_state_ciphertext is null then raise exception 'Pair this WhatsApp account before deployment'; end if;
 select * into w from public.wallets where user_id=p_user_id and status='active' for update;
 if not found then raise exception 'Active wallet not found'; end if;
 if w.balance<150 then raise exception 'Insufficient wallet balance'; end if;
 update public.wallets set balance=balance-150,updated_at=now() where id=w.id returning balance into after_balance;
 insert into public.wallet_transactions(wallet_id,user_id,transaction_type,direction,amount,balance_before,balance_after,metadata)
 values(w.id,p_user_id,'bot_deployment','debit',150,w.balance,after_balance,jsonb_build_object('bot_id',p_bot_id,'plan','monthly'));
 exp:=now()+interval '30 days';
 update public.bot_instances set
  bot_name=coalesce(nullif(p_bot_name,''),'My MICKY-XMD Bot'),
  command_prefix=coalesce(nullif(p_prefix,''),'.'),
  mode=case when p_mode in ('public','self') then p_mode else 'public' end,
  auto_view_status=coalesce(p_auto_view,false),auto_react_status=coalesce(p_auto_react,false),
  anti_delete_enabled=coalesce(p_anti_delete,false),anti_link_enabled=coalesce(p_anti_link,false),
  auto_read_messages=coalesce(p_auto_read,false),always_online=coalesce(p_always_online,false),
  auto_react_emoji=coalesce(nullif(p_auto_react_emoji,''),'💚'),
  bot_status='starting',subscription_status='active',started_at=now(),expires_at=exp,
  is_active=true,reconnect_attempts=0,updated_at=now()
 where id=p_bot_id;
 new_balance:=after_balance;expires_at:=exp;return next;
end $$;
revoke all on function public.deploy_bot_v2(uuid,uuid,text,text,text,boolean,boolean,boolean,boolean,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.deploy_bot_v2(uuid,uuid,text,text,text,boolean,boolean,boolean,boolean,boolean,boolean,text) to service_role;