import { redirect } from "next/navigation";
import { authHeaders, backend } from "@/lib/backend";
import LoginForm from "./login-form";

export default async function Home() {
  const headers = await authHeaders();
  let authenticated = false;
  if (headers) {
    try {
      const response = await backend("/auth/me", { headers });
      authenticated = response.ok;
    } catch { /* Show the login screen if the backend is unavailable. */ }
  }
  if (authenticated) redirect("/dashboard");
  return <main className="login-wrap"><div className="login-card"><span className="eyebrow">FINANZAS PERSONALES</span><h1>Cash Control</h1><p>Tu dinero, claro y en un solo lugar.</p><LoginForm /></div></main>;
}
