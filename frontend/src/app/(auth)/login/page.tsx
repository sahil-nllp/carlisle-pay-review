import { redirect } from "next/navigation";
import Image from "next/image";

import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth.server";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <main className="flex min-h-screen" style={{ background: "var(--neutral-50)" }}>

      {/* ── Left: dark brand panel ────────────────────────────────────── */}
      <div
        className="login-brand-panel hidden md:flex w-[420px] xl:w-[480px] shrink-0 flex-col justify-between p-10 xl:p-12"
      >
        {/* Logo */}
        <div style={{ animation: "fadeIn 0.6s ease both" }}>
          <Image
            src="/carlisle-logo.svg"
            alt="Carlisle Health"
            width={180}
            height={43}
            priority
            className="brightness-0 invert"
          />
        </div>

        {/* Central copy */}
        <div style={{ animation: "slideUp 0.7s ease 0.15s both" }}>
          <div
            className="mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-widest uppercase"
            style={{
              background: "rgba(211,46,83,0.15)",
              color: "var(--brand)",
              border: "1px solid rgba(211,46,83,0.25)",
            }}
          >
            Pay Review Platform
          </div>
          <h1
            className="text-4xl xl:text-5xl font-bold leading-[1.1] tracking-tight mb-4"
            style={{ color: "#ffffff" }}
          >
            Annual Pay<br />
            <span style={{ color: "var(--brand)" }}>Review</span>
          </h1>
          <p className="text-sm leading-relaxed max-w-[280px]" style={{ color: "var(--neutral-400)" }}>
            Compliance-checked salary review, document generation, and multi-site approval — all in one place.
          </p>
        </div>

        {/* Footer stats */}
        <div
          className="flex items-center gap-6"
          style={{ animation: "fadeIn 0.8s ease 0.3s both" }}
        >
          {[
            { label: "Award-compliant", value: "MA000027" },
            { label: "Sites managed", value: "Multi-site" },
            { label: "Cycle", value: "FY 2026-27" },
          ].map((stat) => (
            <div key={stat.label}>
              <div
                className="text-xs font-semibold mb-0.5"
                style={{ color: "var(--neutral-400)", letterSpacing: "0.04em" }}
              >
                {stat.label}
              </div>
              <div
                className="text-sm font-semibold"
                style={{
                  color: "var(--neutral-200)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: form panel ─────────────────────────────────────────── */}
      <div
        className="flex flex-1 flex-col items-center justify-center px-6 py-12"
        style={{ background: "var(--neutral-50)" }}
      >
        {/* Mobile-only logo */}
        <div className="md:hidden mb-10" style={{ animation: "fadeIn 0.5s ease both" }}>
          <Image
            src="/carlisle-logo.svg"
            alt="Carlisle Health"
            width={160}
            height={38}
            priority
          />
        </div>

        <div
          className="w-full max-w-[400px]"
          style={{ animation: "slideUp 0.55s ease 0.05s both" }}
        >
          {/* Heading */}
          <div className="mb-8">
            <h2
              className="text-2xl font-bold tracking-tight mb-1"
              style={{ color: "var(--neutral-950)", letterSpacing: "-0.02em" }}
            >
              Welcome back
            </h2>
            <p className="text-sm" style={{ color: "var(--neutral-500)" }}>
              Sign in with your Carlisle Health account to continue.
            </p>
          </div>

          {/* Card */}
          <div
            className="rounded-xl p-7"
            style={{
              background: "white",
              border: "1px solid var(--neutral-150)",
              boxShadow: "0 1px 3px rgba(15,15,15,0.05), 0 8px 24px rgba(15,15,15,0.04)",
            }}
          >
            <LoginForm />
          </div>

          {/* Footer */}
          <p
            className="mt-6 text-center text-xs"
            style={{ color: "var(--neutral-400)" }}
          >
            Need access?{" "}
            <span style={{ color: "var(--brand)", fontWeight: 600 }}>Contact HR</span>
          </p>
        </div>
      </div>

    </main>
  );
}
