import { cookies, headers } from "next/headers";

export const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
export const sessionCookie = "cash_control_session";

export async function requireSameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function authHeaders(): Promise<Record<string, string> | null> {
  const token = (await cookies()).get(sessionCookie)?.value;
  return token ? { Authorization: `Bearer ${token}` } : null;
}

export async function backend(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${backendUrl}${path}`, { ...init, cache: "no-store" });
}
