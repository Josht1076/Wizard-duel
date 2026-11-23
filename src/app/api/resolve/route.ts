import {
  createServerSupabaseClient,
  ServerSupabaseConfigError,
} from "@/lib/supabase/server";
import { resolveBundle } from "@/lib/match/resolve";
import type { ResolveBundle } from "@/lib/match/types";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.matchId !== "string" ||
    typeof body.token !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(body.matchId) ||
    body.token.length < 16 ||
    body.token.length > 256
  ) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const sb = createServerSupabaseClient();
    const { data, error } = await sb.rpc("wd_fetch_resolve_bundle", {
      p_match_id: body.matchId,
      p_token: body.token,
    });
    if (error) {
      return Response.json(
        { error: error.message },
        { status: error.message.includes("wrong_phase") ? 409 : 400 },
      );
    }
    if (!data) {
      return Response.json({ error: "bundle_missing" }, { status: 500 });
    }

    const payload = resolveBundle(data as ResolveBundle);
    const { data: applied, error: applyError } = await sb.rpc(
      "wd_apply_resolution",
      {
        p_match_id: body.matchId,
        p_token: body.token,
        p_result: payload,
      },
    );
    if (applyError) {
      return Response.json(
        { error: applyError.message || "resolution_apply_failed" },
        { status: 500 },
      );
    }
    return Response.json({ status: "ok", applied });
  } catch (err) {
    if (err instanceof ServerSupabaseConfigError) {
      return Response.json({ error: "server_unconfigured" }, { status: 503 });
    }
    // No tokens, request bodies or private bundles in server logs.
    console.error("wizard_duel_resolution_failed");
    try {
      await createServerSupabaseClient().rpc("wd_resolution_failed", {
        p_match_id: body.matchId,
        p_token: body.token,
      });
    } catch {
      /* Configuration/network failures can only be counted in server logs. */
    }
    return Response.json({ error: "resolution_failed" }, { status: 500 });
  }
}
