import { authHeaders, backend, requireSameOrigin } from "@/lib/backend";

type Context = { params: Promise<{ entry_type: string; entry_id: string }> };

async function forward(request: Request, context: Context, method: "PATCH" | "DELETE") {
  if (!(await requireSameOrigin())) return new Response(null, { status: 403 });
  const auth = await authHeaders();
  if (!auth) return new Response(null, { status: 401 });
  const { entry_type, entry_id } = await context.params;
  try {
    const response = await backend(`/concept-entries/${encodeURIComponent(entry_type)}/${encodeURIComponent(entry_id)}`, {
      method, headers: method === "PATCH" ? { ...auth, "Content-Type": "application/json" } : auth,
      ...(method === "PATCH" ? { body: await request.text() } : {}),
    });
    return Response.json(await response.json(), { status: response.status });
  } catch {
    return Response.json({ detail: "El servidor no está disponible" }, { status: 503 });
  }
}

export async function PATCH(request: Request, context: Context) { return forward(request, context, "PATCH"); }
export async function DELETE(request: Request, context: Context) { return forward(request, context, "DELETE"); }
