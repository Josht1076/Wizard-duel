import type { Seat } from "@/lib/rules";

export const WD_SESSION_KEY = "wd_player";

export type PlayerSession = {
  matchId: string;
  roomCode: string;
  seat: Seat;
  name: string;
  token: string;
};

export function loadSession(): PlayerSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WD_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlayerSession;
    if (
      !parsed?.matchId ||
      !parsed?.roomCode ||
      !parsed?.token ||
      (parsed.seat !== "A" && parsed.seat !== "B")
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: PlayerSession) {
  window.localStorage.setItem(WD_SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  window.localStorage.removeItem(WD_SESSION_KEY);
}

export function newReconnectToken(): string {
  return crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
}

export function testerId(): string {
  const key = "wd_tester_id";
  let id = window.localStorage.getItem(key);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    id = crypto.randomUUID();
    window.localStorage.setItem(key, id);
  }
  return id;
}
