-- Paste in Supabase SQL Editor
-- On Supabase, pgcrypto lives in schema "extensions" (digest is not on public).
create extension if not exists "pgcrypto" with schema extensions;

create or replace function public.wd_hash_token(p_token text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;
