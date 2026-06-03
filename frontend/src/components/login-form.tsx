"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api";
import { login, verifyOtp } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const INPUT_CLS = cn(
  "h-10 border-[var(--neutral-200)] bg-white text-[var(--neutral-900)] placeholder:text-[var(--neutral-400)]",
  "focus-visible:border-[var(--brand)] focus-visible:ring-[var(--brand-light)]",
  "text-sm",
);

// ─────────────────────────────────────────────────────────────────────────────
//  Root — owns step state, passes minimal callbacks down
// ─────────────────────────────────────────────────────────────────────────────
export function LoginForm() {
  const [step, setStep]       = useState<"credentials" | "otp">("credentials");
  const [otpEmail, setOtpEmail] = useState("");

  if (step === "otp") {
    return (
      <OtpStep
        email={otpEmail}
        onBack={() => setStep("credentials")}
      />
    );
  }

  return (
    <CredentialsStep
      onSuccess={(email) => { setOtpEmail(email); setStep("otp"); }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Step 1 — email + password
// ─────────────────────────────────────────────────────────────────────────────
function CredentialsStep({ onSuccess }: { onSuccess: (email: string) => void }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login({ email, password });
      if (res.otp_required) {
        onSuccess(res.email);
      } else {
        // OTP disabled — session cookie already set by backend, go straight in
        router.refresh();
        router.replace("/dashboard");
      }
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="email"
          className="text-xs font-semibold tracking-wide uppercase"
          style={{ color: "var(--neutral-700)", letterSpacing: "0.06em" }}>
          Email address
        </Label>
        <Input
          id="email" type="email" autoComplete="email" required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@carlislehealth.com.au"
          className={INPUT_CLS}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password"
          className="text-xs font-semibold tracking-wide uppercase"
          style={{ color: "var(--neutral-700)", letterSpacing: "0.06em" }}>
          Password
        </Label>
        <Input
          id="password" type="password" autoComplete="current-password" required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className={INPUT_CLS}
        />
      </div>

      {error && <ErrorBox message={error} />}

      <Button
        type="submit" disabled={loading}
        className="w-full h-10 text-sm font-semibold transition-all"
        style={{ background: loading ? "var(--neutral-300)" : "var(--brand)", color: "white", borderRadius: "7px" }}
      >
        {loading ? <Spinner label="Sending code…" /> : "Sign in"}
      </Button>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Step 2 — 6-digit OTP.  Owns ALL submission logic so one ref guards both
//  the auto-submit and any manual button/Enter press.
// ─────────────────────────────────────────────────────────────────────────────
function OtpStep({ email, onBack }: { email: string; onBack: () => void }) {
  const router = useRouter();
  const [code, setCode]       = useState(["", "", "", "", "", ""]);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const inputRefs    = useRef<(HTMLInputElement | null)[]>([]);
  // Single gate: true while a request is in-flight. Prevents double-submit
  // from the auto-submit effect + Enter/button firing simultaneously.
  const inFlightRef  = useRef(false);

  // Auto-focus first box on mount
  useEffect(() => { inputRefs.current[0]?.focus(); }, []);

  // ── OTP submit ────────────────────────────────────────────────────────────
  async function submit(digits: string[]) {
    const fullCode = digits.join("");
    if (fullCode.length < 6) return;
    if (inFlightRef.current) return;           // already in flight — drop
    inFlightRef.current = true;
    setError(null);
    setLoading(true);
    try {
      const { user } = await verifyOtp(email, fullCode);
      router.refresh();
      router.replace(user.role === "payroll" ? "/downloads" : "/dashboard");
    } catch (err) {
      setError(extractError(err));
      setCode(["", "", "", "", "", ""]);       // clear for re-entry
      setTimeout(() => inputRefs.current[0]?.focus(), 0);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }

  // ── Digit input handlers ──────────────────────────────────────────────────
  function handleChange(idx: number, val: string) {
    // Handle paste of full code
    if (val.length > 1) {
      const digits = val.replace(/\D/g, "").slice(0, 6).split("");
      const next = ["", "", "", "", "", ""];
      digits.forEach((d, i) => { next[i] = d; });
      setCode(next);
      inputRefs.current[Math.min(digits.length, 5)]?.focus();
      // If we got all 6 digits from paste, submit immediately
      if (digits.length === 6) submit(next);
      return;
    }
    const digit = val.replace(/\D/g, "");
    const next = [...code];
    next[idx] = digit;
    setCode(next);
    if (digit && idx < 5) inputRefs.current[idx + 1]?.focus();
    // Auto-submit when last box is filled via keyboard
    if (digit && idx === 5) submit(next);
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !code[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    }
  }

  const fullCode = code.join("");
  const ready    = fullCode.length === 6 && !loading;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(code); }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="text-center">
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl text-xl"
          style={{ background: "var(--brand-light, #e0e7ff)" }}
        >
          ✉️
        </div>
        <p className="text-sm font-medium" style={{ color: "var(--neutral-700)" }}>
          We sent a 6-digit code to
        </p>
        <p className="text-sm font-bold" style={{ color: "var(--neutral-900)" }}>
          {email}
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--neutral-400)" }}>
          Valid for 10 minutes. Check your inbox (and spam).
        </p>
      </div>

      {/* 6-digit inputs */}
      <div className="flex justify-center gap-2">
        {code.map((digit, idx) => (
          <input
            key={idx}
            ref={(el) => { inputRefs.current[idx] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={digit}
            onChange={(e) => handleChange(idx, e.target.value)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            onFocus={(e) => e.target.select()}
            disabled={loading}
            className="h-12 w-10 rounded-lg border text-center text-lg font-bold tabular-nums focus:outline-none disabled:opacity-50"
            style={{
              borderColor: digit ? "var(--brand)" : "var(--neutral-200)",
              background: digit ? "#f0f4ff" : "white",
              color: "var(--neutral-900)",
              caretColor: "var(--brand)",
              transition: "border-color 0.15s, background 0.15s",
            }}
          />
        ))}
      </div>

      {error && <ErrorBox message={error} />}

      <Button
        type="submit"
        disabled={!ready}
        className="w-full h-10 text-sm font-semibold transition-all"
        style={{
          background: ready ? "var(--brand)" : "var(--neutral-200)",
          color: ready ? "white" : "var(--neutral-400)",
          borderRadius: "7px",
        }}
      >
        {loading ? <Spinner label="Verifying…" /> : "Verify code"}
      </Button>

      <div className="text-center">
        <button
          type="button"
          onClick={onBack}
          className="text-xs underline"
          style={{ color: "var(--neutral-400)" }}
        >
          ← Back to sign in
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────
function ErrorBox({ message }: { message: string }) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm"
      style={{ background: "var(--red-50)", border: "1px solid var(--red-100)", color: "var(--red-700)" }}
    >
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="mt-0.5 shrink-0">
        <path d="M7.5 1C3.91 1 1 3.91 1 7.5S3.91 14 7.5 14 14 11.09 14 7.5 11.09 1 7.5 1zm.75 9.75h-1.5v-1.5h1.5v1.5zm0-3h-1.5V4.25h1.5v3.5z" fill="currentColor"/>
      </svg>
      {message}
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2">
      <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
      {label}
    </span>
  );
}

function extractError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body;
    if (body && typeof body === "object" && "detail" in body)
      return String((body as { detail: unknown }).detail);
    return "Request failed";
  }
  return "Could not reach the server";
}
