import Link from "next/link";

import { getCurrentCycleServer } from "@/lib/cycles.server";
import { getAwardRatesServer, getPPBandsServer, getSiteEmployeesServer, getSiteSummariesServer } from "@/lib/review.server";
import { SiteReviewClient } from "@/components/site-review-client";

interface Props {
  params: Promise<{ site: string }>;
}

export default async function SiteReviewPage({ params }: Props) {
  const { site: encodedSite } = await params;
  const site = decodeURIComponent(encodedSite);

  const cycle = await getCurrentCycleServer();

  if (!cycle) {
    return (
      <div>
        <BackLink />
        <div className="mt-8 flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm font-semibold" style={{ color: "var(--neutral-700)" }}>
            No active review cycle.
          </p>
        </div>
      </div>
    );
  }

  const [employees, siteSummaries, awardRates, ppBands] = await Promise.all([
    getSiteEmployeesServer(cycle.id, site),
    getSiteSummariesServer(cycle.id),
    getAwardRatesServer(cycle.id),
    getPPBandsServer(cycle.id),
  ]);

  const approvalStatus =
    siteSummaries.find((s) => s.site.toLowerCase() === site.toLowerCase())
      ?.approval_status ?? "not_submitted";

  return (
    <div>
      {/* Back + Site header */}
      <div className="mb-1">
        <BackLink />
      </div>
      <div className="flex items-center gap-3">
        <h1
          className="text-xl font-bold tracking-tight"
          style={{ color: "var(--neutral-900)", letterSpacing: "-0.01em" }}
        >
          {site}
        </h1>
        <div
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--brand)" }} />
          {cycle.fy_label}
        </div>
        <span className="text-xs" style={{ color: "var(--neutral-400)" }}>
          Effective {cycle.effective_date}
        </span>
      </div>

      <SiteReviewClient
        cycleId={cycle.id}
        site={site}
        initialEmployees={employees}
        cpiRate={cycle.cpi_rate}
        approvalStatus={approvalStatus}
        awardRates={awardRates}
        ppBands={ppBands}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/review"
      className="inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
      style={{ color: "var(--neutral-500)" }}
    >
      <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
        <path d="M8.5 3L4 7.5l4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      All sites
    </Link>
  );
}
