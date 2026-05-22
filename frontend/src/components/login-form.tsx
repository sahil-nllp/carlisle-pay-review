"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@/lib/api";
import { login } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login({ email, password });
      router.refresh();
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        const detail =
          typeof err.body === "object" && err.body && "detail" in err.body
            ? String((err.body as { detail: unknown }).detail)
            : "Login failed";
        setError(detail);
      } else {
        setError("Could not reach the server");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--neutral-700)", letterSpacing: "0.06em" }}>
          Email address
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@carlislehealth.com.au"
          className={cn(
            "h-10 border-[var(--neutral-200)] bg-white text-[var(--neutral-900)] placeholder:text-[var(--neutral-400)]",
            "focus-visible:border-[var(--brand)] focus-visible:ring-[var(--brand-light)]",
            "text-sm"
          )}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password" className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--neutral-700)", letterSpacing: "0.06em" }}>
          Password
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className={cn(
            "h-10 border-[var(--neutral-200)] bg-white text-[var(--neutral-900)] placeholder:text-[var(--neutral-400)]",
            "focus-visible:border-[var(--brand)] focus-visible:ring-[var(--brand-light)]",
            "text-sm"
          )}
        />
      </div>

      {error && (
        <div
          className="flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm"
          style={{
            background: "var(--red-50)",
            border: "1px solid var(--red-100)",
            color: "var(--red-700)",
          }}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="mt-0.5 shrink-0">
            <path d="M7.5 1C3.91 1 1 3.91 1 7.5S3.91 14 7.5 14 14 11.09 14 7.5 11.09 1 7.5 1zm.75 9.75h-1.5v-1.5h1.5v1.5zm0-3h-1.5V4.25h1.5v3.5z" fill="currentColor"/>
          </svg>
          {error}
        </div>
      )}

      <Button
        type="submit"
        disabled={loading}
        className="w-full h-10 text-sm font-semibold transition-all"
        style={{
          background: loading ? "var(--neutral-300)" : "var(--brand)",
          color: "white",
          borderRadius: "7px",
        }}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Signing in…
          </span>
        ) : (
          "Sign in"
        )}
      </Button>
    </form>
  );
}
