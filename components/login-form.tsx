"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Sign in failed.");
      router.replace("/");
      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Sign in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-mark" aria-hidden="true">
          <span className="login-mark-line" />
          <span className="login-mark-line login-mark-line-alt" />
        </div>
        <div className="mb-8">
          <p className="eyebrow">Private workspace</p>
          <h1 id="login-title" className="mt-2 text-[2rem] font-semibold leading-tight text-[#17191c]">
            Fantasy Basketball Desk
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-[#646a73]">
            Your weekly category report and daily waiver recommendations.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-[#34383f]">Dashboard password</span>
            <span className="input-wrap">
              <LockKeyhole size={17} aria-hidden="true" />
              <input
                autoFocus
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                className="control-input"
                aria-describedby={error ? "login-error" : undefined}
              />
            </span>
          </label>

          {error ? (
            <p id="login-error" role="alert" className="status-error">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={submitting || !password} className="primary-button w-full">
            <span>{submitting ? "Opening dashboard..." : "Open dashboard"}</span>
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </form>
      </section>
      <p className="login-footnote">Yahoo credentials stay on the server.</p>
    </main>
  );
}
