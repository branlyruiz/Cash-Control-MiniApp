import { authHeaders, backend, requireSameOrigin } from "@/lib/backend";

type Context = { params: Promise<{ kind: string }> };

async function forward(request: Request, context: Context, method: "GET" | "PATCH" | "DELETE") {
  if (method !== "GET" && !(await requireSameOrigin())) return new Response(null, { status: 403 });
  const auth = await authHeaders();
  if (!auth) return new Response(null, { status: 401 });
  const { kind } = await context.params;
  const query = new URL(request.url).searchParams;
  try {
    const response = await backend(`/concepts/${encodeURIComponent(kind)}?label=${encodeURIComponent(query.get("label") ?? "")}&period=${encodeURIComponent(query.get("period") ?? "")}`, {
      method, headers: method === "PATCH" ? { ...auth, "Content-Type": "application/json" } : auth,
      ...(method === "PATCH" ? { body: await request.text() } : {}),
    });
    return Response.json(await response.json(), { status: response.status });
  } catch {
    return Response.json({ detail: "El servidor no está disponible" }, { status: 503 });
  }
}

export async function GET(request: Request, context: Context) { return forward(request, context, "GET"); }
export async function PATCH(request: Request, context: Context) { return forward(request, context, "PATCH"); }
export async function DELETE(request: Request, context: Context) { return forward(request, context, "DELETE"); }
