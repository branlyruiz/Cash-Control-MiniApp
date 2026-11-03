import { NextResponse } from "next/server";
import { authHeaders, backend, requireSameOrigin, sessionCookie } from "@/lib/backend";

export async function POST() {
  if (!(await requireSameOrigin())) return new Response(null, { status: 403 });
  const headers = await authHeaders();
  if (headers) {
    try { await backend("/auth/logout", { method: "POST", headers }); } catch { /* Clear local session anyway. */ }
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(sessionCookie);
  return response;
}
