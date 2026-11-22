-- Hotfix: pgcrypto digest() needs an explicit type for the algorithm arg.
-- Symptom: wd_create_match → "function digest(text, unknown) does not exist"

create extension if not exists "pgcrypto";

create or replace function public.wd_hash_token(p_token text)
returns text
language sql
immutable
as $$
  select encode(digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;
