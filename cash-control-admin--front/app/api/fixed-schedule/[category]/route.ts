import { authHeaders, backend, requireSameOrigin } from "@/lib/backend";

export async function PUT(request: Request, { params }: { params: Promise<{ category: string }> }) {
  if (!(await requireSameOrigin())) return new Response(null, { status: 403 });
  const auth = await authHeaders();
  if (!auth) return new Response(null, { status: 401 });
  const { category } = await params;
  try {
    const response = await backend(`/fixed-schedule/${encodeURIComponent(category)}`, {
      method: "PUT", headers: { ...auth, "Content-Type": "application/json" }, body: await request.text(),
    });
    return Response.json(await response.json(), { status: response.status });
  } catch {
    return Response.json({ detail: "El servidor no está disponible" }, { status: 503 });
  }
}
