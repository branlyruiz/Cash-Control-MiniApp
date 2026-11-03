import { redirect } from "next/navigation";
import { authHeaders, backend } from "@/lib/backend";
import type { Categories, DashboardData, FixedDue, Summary } from "@/lib/types";
import Dashboard from "./dashboard";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const headers = await authHeaders();
  if (!headers) redirect("/");
  const { period } = await searchParams;
  let unauthorized = false;
  try {
    const path = `/dashboard-data${period ? `?period=${encodeURIComponent(period)}` : ""}`;
    const responses = await Promise.all([
      backend("/auth/me", { headers }), backend(path, { headers }),
      backend("/categories", { headers }), backend("/summary", { headers }),
    ]);
    unauthorized = responses.some(response => response.status === 401);
    if (unauthorized) redirect("/");
    if (responses.some(response => !response.ok)) throw new Error("No se pudieron cargar los datos");
    const [user, data, categories, summary] = await Promise.all(responses.map(response => response.json()));
    const scheduleResponse = await backend(`/fixed-schedule?period=${encodeURIComponent((data as DashboardData).period)}`, { headers });
    if (!scheduleResponse.ok) throw new Error("No se pudo cargar el calendario de pagos");
    const schedule = await scheduleResponse.json();
    return <Dashboard email={user.email} data={data as DashboardData} categories={categories as Categories}
      baselinePeriod={(summary as Summary).baseline_period} schedule={schedule as FixedDue[]} />;
  } catch {
    if (unauthorized) redirect("/");
    return <main className="shell"><h1>Cash Control</h1><p>No se pudo cargar la dashboard. Comprueba que el servidor esté en ejecución y actualiza la página.</p></main>;
  }
}
