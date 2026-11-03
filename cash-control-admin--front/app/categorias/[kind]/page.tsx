import { notFound, redirect } from "next/navigation";
import { authHeaders, backend } from "@/lib/backend";
import type { Categories, CategoryKind, CategoryOverview, DashboardData, FixedDue, Summary } from "@/lib/types";
import CategoryView from "./view";

const kinds = ["income", "variable", "fixed", "receivable", "payable"];

export default async function CategoryPage({ params, searchParams }: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { kind } = await params;
  if (!kinds.includes(kind)) notFound();
  const headers = await authHeaders();
  if (!headers) redirect("/");
  const query = await searchParams;
  let unauthorized = false;
  try {
    const periodPath = `/dashboard-data${query.period ? `?period=${encodeURIComponent(query.period)}` : ""}`;
    const [me, periodsResponse, categoriesResponse, summaryResponse] = await Promise.all([
      backend("/auth/me", { headers }), backend(periodPath, { headers }), backend("/categories", { headers }),
      backend("/summary", { headers }),
    ]);
    unauthorized = [me, periodsResponse, categoriesResponse, summaryResponse].some(response => response.status === 401);
    if (unauthorized) redirect("/");
    if ([me, periodsResponse, categoriesResponse, summaryResponse].some(response => !response.ok)) throw new Error("No se pudo cargar la vista");
    const [user, periods, categories, summary] = await Promise.all([
      me.json(), periodsResponse.json(), categoriesResponse.json(), summaryResponse.json(),
    ]);
    const dashboard = periods as DashboardData;
    const [overviewResponse, scheduleResponse] = await Promise.all([
      backend(`/category-overview/${kind}?period=${dashboard.period}`, { headers }),
      backend(`/fixed-schedule?period=${dashboard.period}`, { headers }),
    ]);
    if (!overviewResponse.ok || !scheduleResponse.ok) throw new Error("No se pudo cargar el resumen");
    const overview = await overviewResponse.json() as CategoryOverview;
    const schedule = await scheduleResponse.json() as FixedDue[];
    return <CategoryView email={user.email} kind={kind as CategoryKind} overview={overview}
      periods={dashboard.periods} categories={categories as Categories} schedule={schedule as FixedDue[]}
      baselinePeriod={(summary as Summary).baseline_period} available={dashboard.closing.digital + dashboard.closing.cash} />;
  } catch {
    if (unauthorized) redirect("/");
    return <main className="shell"><h1>Categorías</h1><p>No se pudo cargar esta vista. Comprueba que el servidor esté en ejecución y actualiza la página.</p></main>;
  }
}
