"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function AppNav({ email, active }: { email: string; active: "dashboard" | "movimientos" | "historico" | "categorias" }) {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }
  return <header className="app-nav">
    <Link href="/dashboard" className="app-brand"><span className="brand-mark">₵</span><span>Cash Control</span></Link>
    <nav aria-label="Secciones principales">
      <Link href="/dashboard" aria-current={active === "dashboard" ? "page" : undefined}>Dashboard</Link>
      <Link href="/categorias/income" aria-current={active === "categorias" ? "page" : undefined}>Categorías</Link>
      <Link href="/movimientos" aria-current={active === "movimientos" ? "page" : undefined}>Movimientos</Link>
      <Link href="/historico" aria-current={active === "historico" ? "page" : undefined}>Balance</Link>
    </nav>
    <div className="nav-user"><span>{email}</span><button type="button" onClick={logout}>Salir</button></div>
  </header>;
}
