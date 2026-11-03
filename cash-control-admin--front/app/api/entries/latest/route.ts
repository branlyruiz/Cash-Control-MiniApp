import { authHeaders, backend, requireSameOrigin } from "@/lib/backend";

export async function GET() {
  const auth = await authHeaders();
  if (!auth) return new Response(null, { status: 401 });
  try {
    const response = await backend("/entries/latest", { headers: auth });
    return Response.json(await response.json(), { status: response.status });
  } catch {
    return Response.json({ detail: "El servidor no está disponible" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  if (!(await requireSameOrigin())) return new Response(null, { status: 403 });
  const auth = await authHeaders();
  if (!auth) return new Response(null, { status: 401 });
  try {
    const response = await backend("/entries/latest", {
      method: "DELETE", headers: { ...auth, "Content-Type": "application/json" }, body: await request.text(),
    });
    return Response.json(await response.json(), { status: response.status });
  } catch {
    return Response.json({ detail: "El servidor no está disponible" }, { status: 503 });
  }
}
