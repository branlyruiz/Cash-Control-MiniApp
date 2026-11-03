import { redirect } from "next/navigation";
import { authHeaders, backend } from "@/lib/backend";
import type { Categories, Debt, DebtPayment, Movement, Summary } from "@/lib/types";
import Records from "./records";

export default async function MovimientosPage() {
  const headers = await authHeaders();
  if (!headers) redirect("/");
  let unauthorized = false;
  try {
    const responses = await Promise.all([
      backend("/auth/me", { headers }), backend("/summary", { headers }),
      backend("/transactions", { headers }), backend("/debts", { headers }), backend("/categories", { headers }),
      backend("/debt-payments", { headers }),
    ]);
    unauthorized = responses.some(response => response.status === 401);
    if (unauthorized) redirect("/");
    if (responses.some(response => !response.ok)) throw new Error("No se pudieron cargar los registros");
    const [user, summary, movements, debts, categories, payments] = await Promise.all(responses.map(response => response.json()));
    return <Records email={user.email} summary={summary as Summary} movements={movements as Movement[]}
      debts={debts as Debt[]} payments={payments as DebtPayment[]} categories={categories as Categories} />;
  } catch {
    if (unauthorized) redirect("/");
    return <main className="shell"><h1>Movimientos</h1><p>No se pudieron cargar los registros. Comprueba que el servidor esté en ejecución y actualiza la página.</p></main>;
  }
}
