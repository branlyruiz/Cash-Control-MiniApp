import { backend } from "@/lib/backend";

export async function GET() {
  try {
    const response = await backend("/auth/setup-status");
    return Response.json(await response.json(), { status: response.status });
  } catch {
    return Response.json({ detail: "El servidor no está disponible" }, { status: 503 });
  }
}
