"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import type { User } from "@/lib/types";

// Site-specific review pages (/review/[site]) auto-collapse the sidebar
function isSiteReview(pathname: string) {
  return /^\/review\/.+/.test(pathname) || pathname === "/approvals";
}

export function LayoutClient({ user, pendingApprovals = 0, children }: { user: User; pendingApprovals?: number; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);

  // Auto-close on site review pages; restore on others
  useEffect(() => {
    if (isSiteReview(pathname)) {
      setOpen(false);
    } else {
      setOpen(true);
    }
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--background)" }}>
      {/* Sidebar with slide transition */}
      <div
        style={{
          width: open ? 240 : 0,
          minWidth: open ? 240 : 0,
          overflow: "hidden",
          transition: "width 0.2s ease, min-width 0.2s ease",
          flexShrink: 0,
          height: "100%",
        }}
      >
        <div style={{ width: 240, height: "100%" }}>
          <Sidebar user={user} pendingApprovals={pendingApprovals} />
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <Topbar user={user} sidebarOpen={open} onToggleSidebar={() => setOpen((v) => !v)} />
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  );
}
