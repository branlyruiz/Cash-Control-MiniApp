"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [setup, setSetup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/setup-status").then(r => r.json()).then(data => {
      if (typeof data.needs_setup === "boolean") setSetup(data.needs_setup);
    }).catch(() => setError("No se pudo conectar con el servidor."));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const payload = JSON.stringify({ email, password });
      if (setup) {
        const created = await fetch("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
        if (!created.ok) throw new Error((await created.json()).detail ?? "No se pudo crear la cuenta");
      }
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
      if (!response.ok) throw new Error((await response.json()).detail ?? "No se pudo iniciar sesión");
      router.replace("/dashboard"); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ocurrió un error"); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="form">
    <h2>{setup ? "Crear usuario inicial" : "Iniciar sesión"}</h2>
    <label>Correo<input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
    <label>Contraseña<input type="password" required minLength={12} value={password} onChange={e => setPassword(e.target.value)} autoComplete={setup ? "new-password" : "current-password"} /></label>
    {setup && <small>Usa al menos 12 caracteres.</small>}
    {error && <p className="error" role="alert">{error}</p>}
    <button disabled={busy}>{busy ? "Espera…" : setup ? "Crear cuenta" : "Entrar"}</button>
  </form>;
}
