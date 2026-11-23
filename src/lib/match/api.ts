import { testerId } from "@/lib/session";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import type { AdvantageSpend } from "@/lib/rules";
import type { MatchPublicSnapshot } from "./types";

function clientOrThrow() {
  const sb = createBrowserSupabaseClient();
  if (!sb) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return sb;
}

function rpcError(error: { message?: string } | null, fallback: string): never {
  const msg = error?.message ?? fallback;
  throw new Error(msg.replace(/^.*?:\s*/, ""));
}

type Joined = { match_id: string; room_code: string; seat: "A" | "B"; display_name?: string; status: string; phase: string };
async function command(token: string, action: string, args: Record<string, unknown>) {
  const requestId = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await clientOrThrow().rpc("wd_command", {
        p_request_id: requestId, p_token: token, p_command: action, p_args: args,
      });
      if (error) {
        if (!attempt && /fetch|network|Failed to fetch/i.test(error.message)) continue;
        rpcError(error, `${action}_failed`);
      }
      return data;
    } catch (error) {
      if (attempt || !(error instanceof TypeError)) throw error;
    }
  }
  throw new Error("network_failed");
}
export async function createMatch(displayName: string, token: string): Promise<Joined> {
  return command(token, "create", { display_name: displayName, tester_id: testerId() });
}
export async function joinMatch(roomCode: string, displayName: string, token: string): Promise<Joined> {
  return command(token, "join", { room_code: roomCode, display_name: displayName, tester_id: testerId() });
}
export async function reconnectMatch(roomCode: string, token: string): Promise<Joined> {
  return command(token, "reconnect", { room_code: roomCode });
}
export async function fetchMatchPublic(
  roomCode: string,
): Promise<MatchPublicSnapshot> {
  const sb = clientOrThrow();
  const { data, error } = await sb.rpc("wd_get_match_public", {
    p_room_code: roomCode,
  });
  if (error) rpcError(error, "fetch_failed");
  return data as MatchPublicSnapshot;
}

export async function submitBid(matchId: string, token: string, power: number) {
  return command(token, "bid", { match_id: matchId, power });
}
export async function submitCommit(args: {
  matchId: string; token: string; spell: string; power: number;
  advantageSpend?: AdvantageSpend;
}) {
  return command(args.token, "commit", { match_id: args.matchId, spell: args.spell, power: args.power,
    advantage_spend: args.advantageSpend ?? null });
}
export async function chooseRefresh(matchId: string, token: string, spend: boolean) {
  return command(token, "refresh", { match_id: matchId, spend });
}
export function track(matchId: string, token: string, kind: string, payload: Record<string, unknown> = {}) {
  const requestId = crypto.randomUUID();
  void (async () => {
    try { await clientOrThrow().rpc("wd_track", { p_request_id: requestId, p_match_id: matchId,
      p_token: token, p_kind: kind, p_payload: payload }); } catch { /* telemetry never blocks play */ }
  })();
}
export async function requestResolve(matchId: string, token: string) {
  const res = await fetch("/api/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId, token }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    status?: string;
  };
  if (!res.ok) {
    throw new Error(body.error ?? `resolve_failed_${res.status}`);
  }
  return body;
}
