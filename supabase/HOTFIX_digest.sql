-- Paste in Supabase SQL Editor (digest algorithm must be typed as text)
create extension if not exists "pgcrypto";

create or replace function public.wd_hash_token(p_token text)
returns text
language sql
immutable
as $$
  select encode(digest(convert_to(p_token, 'UTF8'), 'sha256'::text), 'hex');
$$;
