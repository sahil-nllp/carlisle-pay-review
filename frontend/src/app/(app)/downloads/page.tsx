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

      {/* ── Compliance Notes Report ─────────────────────────────────── */}
      <div className="mb-8">
        <div className="section-label mb-4">Reports</div>
        <div
          className="flex items-center justify-between rounded-xl px-5 py-4"
          style={{ background: "white", border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(15,15,15,0.04)" }}
        >
          <div className="flex items-center gap-4">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: "var(--amber-50)" }}
            >
              <svg width="16" height="16" viewBox="0 0 15 15" fill="none">
                <rect x="1.5" y="1.5" width="12" height="12" rx="1.5" stroke="var(--amber-600)" strokeWidth="1.25"/>
                <path d="M4 5h7M4 8h5M4 11h3" stroke="var(--amber-600)" strokeWidth="1.25" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ color: "var(--neutral-900)" }}>
                Compliance Notes Report
              </div>
              <div className="mt-0.5 text-xs" style={{ color: "var(--neutral-400)" }}>
                All "marked as noted" compliance warnings with reasons, reviewer, and date — across all sites
              </div>
            </div>
          </div>
          <a
            href={`/api/v1/cycles/${cycle.id}/compliance-notes-report`}
            download={`compliance-notes-${cycle.fy_label}.xlsx`}
            className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors"
            style={{ background: "var(--amber-600)", color: "white" }}
          >
            <svg width="11" height="11" viewBox="0 0 15 15" fill="none">
              <path d="M7.5 1.5v8M4.5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 11.5v1a1 1 0 001 1h9a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Download Excel
          </a>
        </div>
      </div>

      <div className="section-label mb-4">Site files</div>
      <DownloadsClient cycleId={cycle.id} bySite={bySite} />
    </div>
  );
}
