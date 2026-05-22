"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { visibleNavItems, roleLabel, type NavItem } from "@/lib/nav";
import type { User } from "@/lib/types";

/* ── tiny SVG icons ─────────────────────────────────────────────────── */
const icons: Record<string, React.ReactNode> = {
  "/dashboard": (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <rect x="1" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.25"/>
      <rect x="8.5" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.25"/>
      <rect x="1" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.25"/>
      <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.25"/>
    </svg>
  ),
  "/review": (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <rect x="1" y="2" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M4 6h7M4 9h4.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  ),
  "/approvals": (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M4.5 7.5l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  "/downloads": (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M7.5 1.5v8M4.5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 11.5v1a1 1 0 001 1h9a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  ),
  "/admin/upload-model": (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M7.5 10V2M4.5 5l3-3 3 3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 11.5v1a1 1 0 001 1h9a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  ),
  "/admin/cycle-settings": (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M2.93 2.93l1.06 1.06M11 11l1.07 1.07M2.93 12.07l1.06-1.06M11 4l1.07-1.07" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  ),
  "/admin/users": (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="5.5" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M1 13c0-2.485 2.015-4.5 4.5-4.5S10 10.515 10 13" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
      <path d="M11.5 6.5V11M9 8.75h5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  ),
  "/admin/audit": (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <rect x="1.5" y="1.5" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M4 5h7M4 8h5M4 11h3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  ),
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

export function Sidebar({ user }: { user: User }) {
  const pathname = usePathname();
  const items = visibleNavItems(user.role);
  const mainItems = items.filter((i) => i.group === "main");
  const adminItems = items.filter((i) => i.group === "admin");

  return (
    <aside
      className="flex w-[240px] shrink-0 flex-col"
      style={{
        background: "var(--sidebar)",
        borderRight: "1px solid var(--sidebar-border)",
      }}
    >
      {/* ── Brand ─────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-5 py-5"
        style={{ borderBottom: "1px solid var(--sidebar-border)" }}
      >
        <Image
          src="/carlisle-logo.svg"
          alt="Carlisle Health"
          width={130}
          height={31}
          priority
          className="brightness-0 invert"
        />
      </div>

      {/* ── Navigation ────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        <NavGroup items={mainItems} pathname={pathname} />
        {adminItems.length > 0 && (
          <NavGroup title="Admin" items={adminItems} pathname={pathname} />
        )}
      </nav>

      {/* ── User footer ───────────────────────────────── */}
      <div
        className="px-4 py-4 flex items-center gap-3"
        style={{ borderTop: "1px solid var(--sidebar-border)" }}
      >
        {/* Avatar */}
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
          style={{ background: "var(--brand)", color: "#ffffff" }}
        >
          {getInitials(user.name || user.email)}
        </div>
        {/* Info */}
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-sm font-semibold"
            style={{ color: "var(--sidebar-foreground)" }}
          >
            {user.name || user.email}
          </div>
          <div className="text-[11px] truncate" style={{ color: "var(--neutral-500)" }}>
            {roleLabel(user.role)}
          </div>
        </div>
      </div>
    </aside>
  );
}

function NavGroup({
  title,
  items,
  pathname,
}: {
  title?: string;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <div>
      {title && (
        <div className="section-label px-3 mb-2" style={{ color: "var(--neutral-600)" }}>
          {title}
        </div>
      )}
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${active ? "nav-item-active" : ""}`}
                style={
                  active
                    ? undefined
                    : {
                        color: "var(--neutral-400)",
                      }
                }
                onMouseEnter={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLAnchorElement).style.color = "var(--sidebar-foreground)";
                    (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.05)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLAnchorElement).style.color = "var(--neutral-400)";
                    (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
                  }
                }}
              >
                <span className="shrink-0 opacity-80">{icons[item.href]}</span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
