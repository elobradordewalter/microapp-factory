-- Run after schema.sql in an isolated database. Rolls back all test data.
-- Verified in isolated PGlite PostgreSQL; remote Supabase verification pending.
begin;
set local role service_role;
do $$
declare
  uid uuid := '00000000-0000-4000-8000-000000000001';
  kh text := repeat('a',64);
  result jsonb;
  balance bigint;
begin
  result := public.mf_create_user(uid,'',kh);
  if (result->>'credits')::bigint <> 0 then raise exception 'Initial balance'; end if;
  result := public.mf_grant_credits(uid,300,'verify-txn','verify-event','','{"revenue":3,"currency":"USD"}');
  if (result->>'credits')::bigint <> 300 then raise exception 'Grant balance'; end if;
  result := public.mf_grant_credits(uid,300,'verify-txn','verify-event');
  if result->>'duplicate' <> 'true' then raise exception 'Event dedupe'; end if;
  result := public.mf_grant_credits(uid,300,'verify-txn','verify-event-two');
  if result->>'duplicate' <> 'true' then raise exception 'Transaction dedupe'; end if;
  balance := public.mf_use_credits(kh,1,'{"tool":"json-formatter"}');
  if balance <> 299 then raise exception 'Debit balance'; end if;
  if (select count(*) from microforge_private.credit_ledger where user_id=uid) <> 2 then raise exception 'Ledger count'; end if;
  if (select sum(delta) from microforge_private.credit_ledger where user_id=uid) <> 299 then raise exception 'Ledger sum'; end if;
  if (select count(*) from microforge_private.purchases where user_id=uid) <> 1 then raise exception 'Duplicate purchase'; end if;
  begin
    perform public.mf_use_credits(kh,300);
    raise exception 'Expected insufficient credits';
  exception when sqlstate 'PT402' then null; end;
  begin
    perform public.mf_use_credits(repeat('b',64),1);
    raise exception 'Expected invalid key';
  exception when sqlstate 'PT401' then null; end;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon','public.mf_grant_credits(uuid,bigint,text,text,text,jsonb)','execute') then raise exception 'Anonymous grant access'; end if;
  if has_function_privilege('authenticated','public.mf_use_credits(text,bigint,jsonb)','execute') then raise exception 'Authenticated debit access'; end if;
  if has_schema_privilege('anon','microforge_private','usage') then raise exception 'Anonymous private schema access'; end if;
end $$;
rollback;
