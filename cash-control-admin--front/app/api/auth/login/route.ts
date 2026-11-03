import { NextResponse } from "next/server";
import { backend, requireSameOrigin, sessionCookie } from "@/lib/backend";

export async function POST(request: Request) {
  if (!(await requireSameOrigin())) return new Response(null, { status: 403 });
  try {
    const response = await backend("/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: await request.text(),
    });
    const data = await response.json();
    if (!response.ok) return NextResponse.json(data, { status: response.status });
    const result = NextResponse.json({ ok: true });
    result.cookies.set(sessionCookie, data.access_token, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict",
      path: "/", maxAge: data.expires_in,
    });
    return result;
  } catch {
    return Response.json({ detail: "El servidor no está disponible" }, { status: 503 });
  }
}
