import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class ServerSupabaseConfigError extends Error {
  constructor(message = "server_unconfigured") {
    super(message);
    this.name = "ServerSupabaseConfigError";
  }
}

/**
 * Server key for /api/resolve and other privileged RPCs.
 * Prefer the new secret key (`sb_secret_…` via SUPABASE_SECRET_KEY).
 * Legacy JWT service_role via SUPABASE_SERVICE_ROLE_KEY still works until deactivated.
 * Never expose either key to the browser (no NEXT_PUBLIC_ prefix).
 *
 * @see https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
 */
export function getServerSupabaseKey(): string | undefined {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (secret) return secret;
  const legacy = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (legacy) return legacy;
  return undefined;
}

export function createServerSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = getServerSupabaseKey();
  if (!url || !key) {
    throw new ServerSupabaseConfigError("server_unconfigured");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
