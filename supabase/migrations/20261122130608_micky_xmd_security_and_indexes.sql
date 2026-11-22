drop policy if exists api_keys_deny_client_access on public.api_keys;
create policy api_keys_deny_client_access on public.api_keys for all to anon,authenticated using(false) with check(false);
create index if not exists api_keys_user_id_idx on public.api_keys(user_id);
create index if not exists bot_instances_user_id_idx on public.bot_instances(user_id);
create index if not exists deleted_messages_cache_user_id_idx on public.deleted_messages_cache(user_id);
create index if not exists group_configs_user_id_idx on public.group_configs(user_id);
create index if not exists payment_requests_user_id_idx on public.payment_requests(user_id);
create index if not exists wallet_transactions_wallet_id_idx on public.wallet_transactions(wallet_id);