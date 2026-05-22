import DownloadsClient from "@/components/downloads-client";
import { getCurrentCycleServer } from "@/lib/cycles.server";
import { getDownloadsServer } from "@/lib/downloads.server";

export default async function DownloadsPage() {
  const cycle = await getCurrentCycleServer();

  if (!cycle) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-sm font-semibold" style={{ color: "var(--neutral-700)" }}>
          No active review cycle
        </p>
      </div>
    );
  }

  const files = await getDownloadsServer(cycle.id);

  // Group by site
  const bySite: Record<string, typeof files> = {};
  for (const f of files) {
    (bySite[f.site] ??= []).push(f);
  }

  return (
    <div style={{ animation: "slideUp 0.4s ease both" }}>
      {/* Cycle badge */}
      <div className="mb-7 flex items-center gap-3">
        <div
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--brand)" }} />
          {cycle.fy_label}
        </div>
        <span className="text-xs" style={{ color: "var(--neutral-500)" }}>
          Generated on site approval — pay letters, UKG upload, regional summaries
        </span>
      </div>

      <DownloadsClient cycleId={cycle.id} bySite={bySite} />
    </div>
  );
}
