"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { logout } from "@/lib/auth";
import { roleLabel, NAV_ITEMS } from "@/lib/nav";
import type { User } from "@/lib/types";

function getPageTitle(pathname: string): string {
  // Exact or prefix match against nav items (longest match wins)
  const sorted = [...NAV_ITEMS].sort((a, b) => b.href.length - a.href.length);
  const match = sorted.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  );
  return match?.label ?? "Pay Review";
}

export function Topbar({ user }: { user: User }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);

  async function onLogout() {
    setLoggingOut(true);
    try {
      await logout();
      router.refresh();
      router.replace("/login");
    } finally {
      setLoggingOut(false);
    }
  }

  const pageTitle = getPageTitle(pathname);

  return (
    <header
      className="flex h-14 shrink-0 items-center justify-between px-8"
      style={{
        background: "var(--background)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* Page title */}
      <h1
        className="text-base font-semibold tracking-tight"
        style={{ color: "var(--neutral-900)", letterSpacing: "-0.01em" }}
      >
        {pageTitle}
      </h1>

      {/* Right: user info + sign out */}
      <div className="flex items-center gap-4">
        {/* User pill */}
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-1.5"
          style={{
            background: "var(--neutral-100)",
            border: "1px solid var(--border)",
          }}
        >
          <div className="text-xs" style={{ color: "var(--neutral-500)" }}>
            <span className="font-medium" style={{ color: "var(--neutral-800)" }}>
              {user.name || user.email}
            </span>
            <span className="mx-1.5" style={{ color: "var(--neutral-300)" }}>·</span>
            <span>{roleLabel(user.role)}</span>
            {user.site && (
              <>
                <span className="mx-1.5" style={{ color: "var(--neutral-300)" }}>·</span>
                <span>{user.site}</span>
              </>
            )}
          </div>
        </div>

        {/* Sign out */}
        <button
          onClick={onLogout}
          disabled={loggingOut}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60"
          style={{
            color: "var(--neutral-600)",
            border: "1px solid var(--border)",
            background: "white",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "var(--neutral-50)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--neutral-900)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "white";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--neutral-600)";
          }}
        >
          {loggingOut ? (
            <>
              <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Signing out…
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
                <path d="M13 7.5H6M10.5 5l2.5 2.5-2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 2H2.5A1.5 1.5 0 001 3.5v8A1.5 1.5 0 002.5 13H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Sign out
            </>
          )}
        </button>
      </div>
    </header>
  );
}
