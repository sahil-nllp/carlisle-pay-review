import { getCurrentCycleServer } from "@/lib/cycles.server";
import { CycleSettingsClient } from "@/components/cycle-settings-client";

export default async function CycleSettingsPage() {
  const cycle = await getCurrentCycleServer();

  return (
    <div style={{ animation: "slideUp 0.4s ease both" }}>
      {/* Cycle badge (only when a cycle exists) */}
      {cycle && (
        <div className="mb-6 flex items-center gap-3">
          <div
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--brand)" }} />
            {cycle.fy_label}
          </div>
          <span className="text-xs" style={{ color: "var(--neutral-500)" }}>
            Letter dates, signatory details, super rates — used in generated pay letters.
          </span>
        </div>
      )}
      <CycleSettingsClient cycle={cycle} />
    </div>
  );
}
