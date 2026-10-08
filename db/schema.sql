-- DRAFT, UNAPPLIED TO SUPABASE. Verified in isolated PGlite PostgreSQL only.
-- Run in a dedicated project; then security advisors and transactional tests.
begin;
create schema if not exists microforge_private;
revoke all on schema microforge_private from public, anon, authenticated;
grant usage on schema microforge_private to service_role;
create table microforge_private.users (id uuid primary key, email text not null default '', created_at timestamptz not null default now());
create table microforge_private.api_keys (key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'), user_id uuid not null references microforge_private.users, revoked_at timestamptz, created_at timestamptz not null default now());
create table microforge_private.credit_balances (user_id uuid primary key references microforge_private.users, balance bigint not null default 0 check (balance >= 0));
create table microforge_private.credit_ledger (id bigint generated always as identity primary key, user_id uuid not null references microforge_private.users, delta bigint not null check (delta <> 0), balance_after bigint not null check (balance_after >= 0), reason text not null, source text not null, external_transaction_id text, timestamp timestamptz not null default now());
create table microforge_private.purchases (transaction_id text primary key, user_id uuid not null references microforge_private.users, credits bigint not null check (credits > 0), revenue numeric(18,6) not null default 0, currency text not null default 'USD', metadata jsonb not null default '{}', created_at timestamptz not null default now());
create table microforge_private.subscriptions (subscription_id text primary key, user_id uuid not null references microforge_private.users, status text not null, monthly_amount numeric(18,6) not null default 0, currency text not null default 'USD', updated_at timestamptz not null default now());
create table microforge_private.webhook_events (event_id text primary key, transaction_id text not null, event_type text not null, processed_at timestamptz not null default now());
create table microforge_private.usage_events (id bigint generated always as identity primary key, user_id uuid not null references microforge_private.users, tool text, credits bigint not null check (credits > 0), context jsonb not null default '{}', created_at timestamptz not null default now());
create table microforge_private.analytics_events (id bigint generated always as identity primary key, event jsonb not null, created_at timestamptz not null default now());
create index credit_ledger_user_time on microforge_private.credit_ledger(user_id, timestamp desc);
create index usage_events_user_time on microforge_private.usage_events(user_id, created_at desc);
create index analytics_events_time on microforge_private.analytics_events(created_at desc);
do $$ declare t text; begin
  foreach t in array array['users','api_keys','credit_balances','credit_ledger','purchases','subscriptions','webhook_events','usage_events','analytics_events'] loop
    execute format('alter table microforge_private.%I enable row level security', t);
    execute format('revoke all on table microforge_private.%I from public, anon, authenticated', t);
  end loop;
end $$;
grant select, insert, update on all tables in schema microforge_private to service_role;
-- Financial history is append-only through this adapter.
revoke update on microforge_private.credit_ledger, microforge_private.purchases, microforge_private.webhook_events, microforge_private.usage_events, microforge_private.analytics_events from service_role;
grant usage, select on all sequences in schema microforge_private to service_role;

create function public.mf_create_user(p_id uuid, p_email text, p_key_hash text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  insert into microforge_private.users(id,email) values(p_id,p_email);
  insert into microforge_private.api_keys(key_hash,user_id) values(p_key_hash,p_id);
  insert into microforge_private.credit_balances(user_id) values(p_id);
  return jsonb_build_object('id',p_id,'email',p_email,'credits',0,'createdAt',now());
end $$;
create function public.mf_get_user(p_key_hash text) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('id',u.id,'email',u.email,'credits',b.balance,'createdAt',u.created_at)
  from microforge_private.api_keys k join microforge_private.users u on u.id=k.user_id
  join microforge_private.credit_balances b on b.user_id=u.id where k.key_hash=p_key_hash and k.revoked_at is null;
$$;
create function public.mf_use_credits(p_key_hash text, p_credits bigint, p_context jsonb default '{}') returns bigint
language plpgsql security invoker set search_path = '' as $$
declare uid uuid; new_balance bigint;
begin
  if p_credits is null or p_credits <= 0 then raise sqlstate 'PT400' using message='Invalid credit amount'; end if;
  select user_id into uid from microforge_private.api_keys where key_hash=p_key_hash and revoked_at is null for share;
  if uid is null then raise sqlstate 'PT401' using message='Invalid API key'; end if;
  update microforge_private.credit_balances set balance=balance-p_credits where user_id=uid and balance>=p_credits returning balance into new_balance;
  if new_balance is null then raise sqlstate 'PT402' using message='Insufficient credits'; end if;
  insert into microforge_private.credit_ledger(user_id,delta,balance_after,reason,source,external_transaction_id) values(uid,-p_credits,new_balance,'tool execution','api',p_context->>'requestId');
  insert into microforge_private.usage_events(user_id,tool,credits,context) values(uid,p_context->>'tool',p_credits,p_context);
  insert into microforge_private.analytics_events(event) values(p_context || jsonb_build_object('type','api_process','userId',uid,'credits',p_credits,'ts',now()));
  return new_balance;
end $$;
create function public.mf_grant_credits(p_user_id uuid, p_credits bigint, p_transaction_id text, p_event_id text, p_email text default '', p_metadata jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare new_balance bigint; inserted_id text;
begin
  if p_credits is null or p_credits<=0 or nullif(p_transaction_id,'') is null or nullif(p_event_id,'') is null then raise sqlstate 'PT400' using message='Invalid payment'; end if;
  -- Lock account first; independent webhook event IDs for one transaction serialize.
  perform 1 from microforge_private.credit_balances where user_id=p_user_id for update;
  if not found then raise sqlstate 'PT400' using message='Unknown account in payment'; end if;
  insert into microforge_private.webhook_events(event_id,transaction_id,event_type) values(p_event_id,p_transaction_id,'transaction.completed') on conflict do nothing returning event_id into inserted_id;
  if inserted_id is null then return jsonb_build_object('duplicate',true); end if;
  insert into microforge_private.purchases(transaction_id,user_id,credits,revenue,currency,metadata) values(p_transaction_id,p_user_id,p_credits,coalesce((p_metadata->>'revenue')::numeric,0),coalesce(p_metadata->>'currency','USD'),p_metadata) on conflict do nothing returning transaction_id into inserted_id;
  if inserted_id is null then return jsonb_build_object('duplicate',true); end if;
  update microforge_private.credit_balances set balance=balance+p_credits where user_id=p_user_id returning balance into new_balance;
  update microforge_private.users set email=p_email where id=p_user_id and email='' and p_email<>'';
  insert into microforge_private.credit_ledger(user_id,delta,balance_after,reason,source,external_transaction_id) values(p_user_id,p_credits,new_balance,'credit purchase','paddle',p_transaction_id);
  if nullif(p_metadata->>'subscriptionId','') is not null then
    insert into microforge_private.subscriptions(subscription_id,user_id,status,monthly_amount,currency)
    values(p_metadata->>'subscriptionId',p_user_id,'active',coalesce((p_metadata->>'revenue')::numeric,0),coalesce(p_metadata->>'currency','USD'))
    on conflict(subscription_id) do update set status='active',monthly_amount=excluded.monthly_amount,currency=excluded.currency,updated_at=now()
    where microforge_private.subscriptions.user_id=excluded.user_id;
  end if;
  insert into microforge_private.analytics_events(event) values(p_metadata || jsonb_build_object('type','purchase','userId',p_user_id,'credits',p_credits,'transactionId',p_transaction_id,'ts',now()));
  return jsonb_build_object('userId',p_user_id,'credits',new_balance);
end $$;
create function public.mf_log_event(p_event jsonb) returns void
language sql security invoker set search_path = '' as $$ insert into microforge_private.analytics_events(event) values(p_event); $$;
create function public.mf_dashboard_data() returns jsonb
language sql security invoker set search_path = '' as $$
 select jsonb_build_object('users',(select count(*) from microforge_private.users),'events',coalesce((select jsonb_agg(event) from (select event from microforge_private.analytics_events order by id desc limit 10000) recent),'[]'::jsonb),'revenueByCurrency',coalesce((select jsonb_object_agg(currency,revenue) from (select currency,sum(revenue) revenue from microforge_private.purchases group by currency) revenues),'{}'::jsonb));
$$;
revoke all on function public.mf_create_user(uuid,text,text), public.mf_get_user(text), public.mf_use_credits(text,bigint,jsonb), public.mf_grant_credits(uuid,bigint,text,text,text,jsonb), public.mf_log_event(jsonb), public.mf_dashboard_data() from public, anon, authenticated;
grant execute on function public.mf_create_user(uuid,text,text), public.mf_get_user(text), public.mf_use_credits(text,bigint,jsonb), public.mf_grant_credits(uuid,bigint,text,text,text,jsonb), public.mf_log_event(jsonb), public.mf_dashboard_data() to service_role;
notify pgrst, 'reload schema';
commit;
