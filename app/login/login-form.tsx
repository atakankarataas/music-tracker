"use client";

import { FormEvent, useState } from "react";
import styles from "./login.module.css";

export function LoginForm() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const username = form.get("username") as string;
    const password = form.get("password") as string;

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        // Full page reload ensures the cookie is sent with the request.
        // router.push() does a client-side navigation that can race
        // against cookie storage and hit the middleware before the
        // browser has persisted the Set-Cookie header.
        const next = new URLSearchParams(window.location.search).get("next");
        window.location.href = next?.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
        return;
      }

      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Giriş başarısız.");
    } catch {
      setError("Bağlantı hatası. Tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className={styles["login-form"]} onSubmit={handleSubmit}>
      {error && <p className={styles["error-msg"]}>{error}</p>}

      <div className={styles.field}>
        <label htmlFor="login-username">Kullanıcı Adı</label>
        <input
          id="login-username"
          name="username"
          type="text"
          placeholder="kullanıcı adı"
          autoComplete="username"
          autoCapitalize="off"
          required
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="login-password">Şifre</label>
        <input
          id="login-password"
          name="password"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          required
        />
      </div>

      <button
        className={styles["submit-btn"]}
        type="submit"
        disabled={loading}
      >
        {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
      </button>
    </form>
  );
}
