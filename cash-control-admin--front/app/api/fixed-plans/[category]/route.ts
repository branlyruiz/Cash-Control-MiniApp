import { authHeaders, backend, requireSameOrigin } from "@/lib/backend";

type Context = { params: Promise<{ category: string }> };

export async function PUT(request: Request, context: Context) {
  if (!(await requireSameOrigin())) return new Response(null, { status: 403 });
  const auth = await authHeaders();
  if (!auth) return new Response(null, { status: 401 });
  const { category } = await context.params;
  const period = new URL(request.url).searchParams.get("period") ?? "";
  try {
    const response = await backend(`/fixed-plans/${encodeURIComponent(category)}?period=${encodeURIComponent(period)}`, {
      method: "PUT", headers: { ...auth, "Content-Type": "application/json" }, body: await request.text(),
    });
    return Response.json(await response.json(), { status: response.status });
  } catch {
    return Response.json({ detail: "El servidor no está disponible" }, { status: 503 });
  }
}
