import { redirect } from "next/navigation";
import { LayoutClient } from "@/components/layout-client";
import { getCurrentUser } from "@/lib/auth.server";
import { getCurrentCycleServer } from "@/lib/cycles.server";
import { getApprovalsServer } from "@/lib/approvals.server";

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let pendingApprovals = 0;
  if (user.role === "hr_admin" || user.role === "senior_management") {
    const cycle = await getCurrentCycleServer();
    if (cycle) {
      const approvals = await getApprovalsServer(cycle.id);
      pendingApprovals = approvals.filter((a) => a.status === "pending").length;
    }
  }

  return <LayoutClient user={user} pendingApprovals={pendingApprovals}>{children}</LayoutClient>;
}
