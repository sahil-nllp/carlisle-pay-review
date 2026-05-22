import { redirect } from "next/navigation";

import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { getCurrentUser } from "@/lib/auth.server";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--background)" }}>
      <Sidebar user={user} />
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <Topbar user={user} />
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  );
}
