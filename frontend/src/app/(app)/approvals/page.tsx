import { getCurrentCycleServer } from "@/lib/cycles.server";
import { getApprovalsServer } from "@/lib/approvals.server";
import { ApprovalsClient } from "@/components/approvals-client";

export default async function ApprovalsPage() {
  const cycle = await getCurrentCycleServer();

  if (!cycle) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-sm font-semibold" style={{ color: "var(--neutral-700)" }}>
          No active review cycle
        </p>
        <p className="mt-2 text-xs" style={{ color: "var(--neutral-500)" }}>
          Upload a wage model to start a cycle.
        </p>
      </div>
    );
  }

  const approvals = await getApprovalsServer(cycle.id);

  return (
    <div>
      {/* Cycle badge */}
      <div className="mb-2 flex items-center gap-3">
        <div
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--brand)" }} />
          {cycle.fy_label}
        </div>
        <span className="text-xs" style={{ color: "var(--neutral-500)" }}>
          Sites submitted for senior management sign-off
        </span>
      </div>

      <ApprovalsClient
        cycleId={cycle.id}
        cycleLabel={cycle.fy_label}
        initialApprovals={approvals}
        cpiRate={cycle.cpi_rate}
      />
    </div>
  );
}
