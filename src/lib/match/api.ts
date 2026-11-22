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

export async function createMatch(displayName: string, token: string) {
  const sb = clientOrThrow();
  const { data, error } = await sb.rpc("wd_create_match", {
    p_display_name: displayName,
    p_token: token,
  });
  if (error) rpcError(error, "create_failed");
  return data as {
    match_id: string;
    room_code: string;
    seat: "A";
    status: string;
    phase: string;
  };
}

export async function joinMatch(
  roomCode: string,
  displayName: string,
  token: string,
) {
  const sb = clientOrThrow();
  const { data, error } = await sb.rpc("wd_join_match", {
    p_room_code: roomCode,
    p_display_name: displayName,
    p_token: token,
  });
  if (error) rpcError(error, "join_failed");
  return data as {
    match_id: string;
    room_code: string;
    seat: "B";
    status: string;
    phase: string;
  };
}

export async function reconnectMatch(roomCode: string, token: string) {
  const sb = clientOrThrow();
  const { data, error } = await sb.rpc("wd_reconnect", {
    p_room_code: roomCode,
    p_token: token,
  });
  if (error) rpcError(error, "reconnect_failed");
  return data as {
    match_id: string;
    room_code: string;
    seat: "A" | "B";
    display_name: string;
    status: string;
    phase: string;
    winner_seat: string | null;
  };
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

export async function submitBid(
  matchId: string,
  token: string,
  power: number,
) {
  const sb = clientOrThrow();
  const { data, error } = await sb.rpc("wd_submit_bid", {
    p_match_id: matchId,
    p_token: token,
    p_power: power,
  });
  if (error) rpcError(error, "bid_failed");
  return data as Record<string, unknown>;
}

export async function submitCommit(args: {
  matchId: string;
  token: string;
  spell: string;
  power: number;
  advantageSpend?: AdvantageSpend;
  declaredSchool?: string | null;
}) {
  const sb = clientOrThrow();
  const { data, error } = await sb.rpc("wd_submit_commit", {
    p_match_id: args.matchId,
    p_token: args.token,
    p_spell: args.spell,
    p_power: args.power,
    p_advantage_spend: args.advantageSpend ?? null,
    p_declared_school: args.declaredSchool ?? null,
  });
  if (error) rpcError(error, "commit_failed");
  return data as Record<string, unknown>;
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

export function subscribeMatch(
  matchId: string,
  onChange: () => void,
): () => void {
  const sb = clientOrThrow();
  const channel = sb
    .channel(`match:${matchId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "match_state", filter: `match_id=eq.${matchId}` },
      () => onChange(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "match_players", filter: `match_id=eq.${matchId}` },
      () => onChange(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
      () => onChange(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "commits", filter: `match_id=eq.${matchId}` },
      () => onChange(),
    )
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}
