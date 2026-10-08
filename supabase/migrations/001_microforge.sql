create extension if not exists pgcrypto;

create table if not exists public.mf_internal_secrets (
  key text primary key,
  value_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  key_hash text not null unique,
  key_prefix text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.credit_balances (
  user_id uuid primary key references public.users(id) on delete cascade,
  credits bigint not null default 0 check (credits >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  delta bigint not null,
  balance_after bigint not null check (balance_after >= 0),
  reason text not null,
  source text not null,
  external_transaction_id text,
  created_at timestamptz not null default now()
);
create unique index if not exists credit_ledger_purchase_unique
  on public.credit_ledger(external_transaction_id)
  where external_transaction_id is not null and reason='purchase';

create table if not exists public.purchases (
  external_transaction_id text primary key,
  user_id uuid not null references public.users(id) on delete restrict,
  amount_cents bigint not null default 0,
  currency text,
  credits bigint not null,
  price_id text,
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  external_subscription_id text primary key,
  user_id uuid not null references public.users(id) on delete restrict,
  price_id text,
  status text not null default 'active',
  updated_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  external_event_id text primary key,
  event_type text not null,
  external_transaction_id text,
  processed_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.users(id) on delete set null,
  tool text not null,
  credits bigint not null default 0,
  latency_ms integer not null default 0,
  status text not null default 'ok',
  created_at timestamptz not null default now()
);

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  tool text,
  user_id uuid references public.users(id) on delete set null,
  session_id text,
  source text,
  referrer text,
  country text,
  revenue numeric(14,4) not null default 0,
  estimated_cost_usd numeric(14,8) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.mf_internal_secrets enable row level security;
alter table public.users enable row level security;
alter table public.api_keys enable row level security;
alter table public.credit_balances enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.purchases enable row level security;
alter table public.subscriptions enable row level security;
alter table public.webhook_events enable row level security;
alter table public.usage_events enable row level security;
alter table public.analytics_events enable row level security;

revoke all on public.mf_internal_secrets,public.users,public.api_keys,public.credit_balances,public.credit_ledger,public.purchases,public.subscriptions,public.webhook_events,public.usage_events,public.analytics_events from anon,authenticated;

create or replace function public.mf_assert_secret(p_secret text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare expected text;
begin
  select value_hash into expected from public.mf_internal_secrets where key='store_secret';
  if expected is null or encode(digest(coalesce(p_secret,''),'sha256'),'hex') <> expected then
    raise exception 'unauthorized' using errcode='42501';
  end if;
end $$;

create or replace function public.mf_create_user(
  p_user_id uuid,p_email text,p_api_key_hash text,p_api_key_prefix text,p_secret text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.mf_assert_secret(p_secret);
  insert into public.users(id,email) values(p_user_id,nullif(lower(trim(coalesce(p_email,''))),'')); 
  insert into public.credit_balances(user_id,credits) values(p_user_id,0);
  insert into public.api_keys(user_id,key_hash,key_prefix) values(p_user_id,p_api_key_hash,p_api_key_prefix);
  return jsonb_build_object('id',p_user_id,'email',lower(trim(coalesce(p_email,''))),'credits',0,'createdAt',now());
end $$;

create or replace function public.mf_get_user_by_key(p_api_key_hash text,p_secret text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare out jsonb;
begin
  perform public.mf_assert_secret(p_secret);
  select jsonb_build_object('id',u.id,'email',coalesce(u.email,''),'credits',b.credits,'createdAt',u.created_at)
  into out
  from public.api_keys k join public.users u on u.id=k.user_id join public.credit_balances b on b.user_id=u.id
  where k.key_hash=p_api_key_hash and k.revoked_at is null limit 1;
  return out;
end $$;

create or replace function public.mf_use_credits(
  p_api_key_hash text,p_amount bigint,p_tool text,p_latency_ms integer,p_secret text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid; bal bigint;
begin
  perform public.mf_assert_secret(p_secret);
  if p_amount <= 0 then raise exception 'invalid credit amount'; end if;
  select user_id into uid from public.api_keys where key_hash=p_api_key_hash and revoked_at is null limit 1;
  if uid is null then return jsonb_build_object('error','invalid_key'); end if;
  select credits into bal from public.credit_balances where user_id=uid for update;
  if bal < p_amount then return jsonb_build_object('error','insufficient_credits','credits',bal); end if;
  bal:=bal-p_amount;
  update public.credit_balances set credits=bal,updated_at=now() where user_id=uid;
  insert into public.credit_ledger(user_id,delta,balance_after,reason,source) values(uid,-p_amount,bal,'api_usage',coalesce(nullif(p_tool,''),'api'));
  insert into public.usage_events(user_id,tool,credits,latency_ms,status) values(uid,coalesce(nullif(p_tool,''),'unknown'),p_amount,greatest(coalesce(p_latency_ms,0),0),'ok');
  return jsonb_build_object('credits',bal,'userId',uid);
end $$;

create or replace function public.mf_grant_credits(
  p_user_id uuid,p_amount bigint,p_payment_id text,p_event_id text,p_email text,
  p_amount_cents bigint,p_currency text,p_price_id text,p_subscription_id text,p_secret text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare bal bigint;
begin
  perform public.mf_assert_secret(p_secret);
  if p_amount <= 0 or nullif(p_payment_id,'') is null then raise exception 'invalid credit grant'; end if;

  if nullif(p_event_id,'') is not null and exists(select 1 from public.webhook_events where external_event_id=p_event_id) then
    return jsonb_build_object('duplicate',true,'reason','event');
  end if;
  if exists(select 1 from public.purchases where external_transaction_id=p_payment_id) then
    return jsonb_build_object('duplicate',true,'reason','transaction');
  end if;

  if not exists(select 1 from public.users where id=p_user_id) then raise exception 'unknown account in payment'; end if;
  if nullif(trim(coalesce(p_email,'')),'') is not null then
    update public.users set email=coalesce(email,lower(trim(p_email))) where id=p_user_id;
  end if;

  select credits into bal from public.credit_balances where user_id=p_user_id for update;
  bal:=bal+p_amount;
  update public.credit_balances set credits=bal,updated_at=now() where user_id=p_user_id;

  insert into public.purchases(external_transaction_id,user_id,amount_cents,currency,credits,price_id,status)
  values(p_payment_id,p_user_id,greatest(coalesce(p_amount_cents,0),0),upper(coalesce(p_currency,'')),p_amount,p_price_id,'completed');

  insert into public.credit_ledger(user_id,delta,balance_after,reason,source,external_transaction_id)
  values(p_user_id,p_amount,bal,'purchase','paddle',p_payment_id);

  if nullif(p_event_id,'') is not null then
    insert into public.webhook_events(external_event_id,event_type,external_transaction_id)
    values(p_event_id,'transaction.completed',p_payment_id);
  end if;

  if nullif(p_subscription_id,'') is not null then
    insert into public.subscriptions(external_subscription_id,user_id,price_id,status)
    values(p_subscription_id,p_user_id,p_price_id,'active')
    on conflict(external_subscription_id) do update set user_id=excluded.user_id,price_id=excluded.price_id,status='active',updated_at=now();
  end if;

  return jsonb_build_object('userId',p_user_id,'credits',bal,'duplicate',false);
end $$;

create or replace function public.mf_log_event(p_event jsonb,p_secret text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.mf_assert_secret(p_secret);
  insert into public.analytics_events(event_type,tool,user_id,session_id,source,referrer,country,revenue,estimated_cost_usd,metadata,created_at)
  values(
    coalesce(p_event->>'type','unknown'),nullif(p_event->>'tool',''),
    case when coalesce(p_event->>'userId','') ~* '^[0-9a-f-]{36}$' then (p_event->>'userId')::uuid else null end,
    nullif(p_event->>'sessionId',''),nullif(p_event->>'source',''),nullif(p_event->>'referrer',''),nullif(p_event->>'ipCountry',''),
    coalesce((p_event->>'revenue')::numeric,0),coalesce((p_event->>'estimatedCostUsd')::numeric,0),
    p_event - array['type','tool','userId','sessionId','source','referrer','ipCountry','revenue','estimatedCostUsd','ts'],
    coalesce((p_event->>'ts')::timestamptz,now())
  );
end $$;

create or replace function public.mf_dashboard_data(p_secret text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cnt bigint; ev jsonb;
begin
  perform public.mf_assert_secret(p_secret);
  select count(*) into cnt from public.users;
  select coalesce(jsonb_agg(x.obj),'[]'::jsonb) into ev from (
    select jsonb_build_object(
      'type',event_type,'tool',tool,'userId',user_id,'sessionId',session_id,'source',source,'referrer',referrer,'ipCountry',country,
      'revenue',revenue,'estimatedCostUsd',estimated_cost_usd,'ts',created_at
    ) || metadata as obj
    from public.analytics_events order by created_at desc limit 10000
  ) x;
  return jsonb_build_object('users',cnt,'events',ev);
end $$;

revoke all on function public.mf_assert_secret(text) from public,anon,authenticated;
grant execute on function public.mf_create_user(uuid,text,text,text,text) to anon,authenticated;
grant execute on function public.mf_get_user_by_key(text,text) to anon,authenticated;
grant execute on function public.mf_use_credits(text,bigint,text,integer,text) to anon,authenticated;
grant execute on function public.mf_grant_credits(uuid,bigint,text,text,text,bigint,text,text,text,text) to anon,authenticated;
grant execute on function public.mf_log_event(jsonb,text) to anon,authenticated;
grant execute on function public.mf_dashboard_data(text) to anon,authenticated;

-- Before applying this template, insert a generated store secret hash:
-- insert into public.mf_internal_secrets(key,value_hash)
-- values('store_secret','__STORE_SECRET_SHA256__')
-- on conflict(key) do update set value_hash=excluded.value_hash;
