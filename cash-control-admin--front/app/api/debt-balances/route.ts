import { authHeaders, backend } from "@/lib/backend";

export async function GET(request: Request) {
  const auth = await authHeaders();
  if (!auth) return new Response(null, { status: 401 });
  const on = new URL(request.url).searchParams.get("on");
  if (!on || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return Response.json({ detail: "Fecha inválida" }, { status: 422 });
  try {
    const response = await backend(`/debt-balances?on=${encodeURIComponent(on)}`, { headers: auth });
    return Response.json(await response.json(), { status: response.status });
  } catch {
    return Response.json({ detail: "El servidor no está disponible" }, { status: 503 });
  }
}
