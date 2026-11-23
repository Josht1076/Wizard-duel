import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class ServerSupabaseConfigError extends Error {
  constructor(message = "server_unconfigured") {
    super(message);
    this.name = "ServerSupabaseConfigError";
  }
}

/**
 * Server Supabase client for /api/resolve.
 * Prefers SUPABASE_SERVICE_ROLE_KEY (required for wd_fetch_resolve_bundle /
 * wd_apply_resolution). Never expose that key to the browser.
 */
export function createServerSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new ServerSupabaseConfigError("server_unconfigured");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
