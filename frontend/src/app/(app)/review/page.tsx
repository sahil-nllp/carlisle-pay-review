import Link from "next/link";

import { getCurrentUser } from "@/lib/auth.server";
import { getCurrentCycleServer } from "@/lib/cycles.server";
import { getSiteSummariesServer } from "@/lib/review.server";

export default async function ReviewPage() {
  const user = (await getCurrentUser())!;
  const cycle = await getCurrentCycleServer();

  if (!cycle) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-sm font-semibold" style={{ color: "var(--neutral-800)" }}>
          No active review cycle
        </p>
        <p className="mt-2 text-xs" style={{ color: "var(--neutral-500)" }}>
          Upload a wage model from the dashboard to start a cycle.
        </p>
      </div>
    );
  }

  const sites = await getSiteSummariesServer(cycle.id);

  const totalStaff = sites.reduce((n, s) => n + s.staff, 0);
  const totalPayrollCurrent = sites.reduce((n, s) => n + s.payroll_current, 0);
  const totalPayrollProposed = sites.reduce((n, s) => n + s.payroll_proposed, 0);
  const totalIssues = sites.reduce(
    (n, s) => n + s.issues.below_award + s.issues.no_proposed_rate + s.issues.unknown_level,
    0,
  );
  const sitesApproved = sites.filter((s) => s.approval_status === "approved").length;
  const delta = totalPayrollProposed - totalPayrollCurrent;

  return (
    <div style={{ animation: "slideUp 0.4s ease both" }}>
      {/* ── Cycle badge ───────────────────────────────────────────────── */}
      <div className="mb-7 flex items-center gap-3">
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

      {/* ── KPI row ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Total Employees" value={totalStaff} />
        <KpiCard
          label="Sites Approved"
          value={`${sitesApproved} / ${sites.length}`}
          highlight={sitesApproved === sites.length && sites.length > 0}
        />
        <KpiCard
          label="Payroll Change"
          value={totalPayrollProposed > 0 ? formatDelta(delta) : "—"}
          tone={totalPayrollProposed > 0 ? (delta > 0 ? "amber" : "green") : "neutral"}
        />
        <KpiCard
          label="Compliance Issues"
          value={totalIssues}
          tone={totalIssues > 0 ? "red" : "green"}
        />
      </div>

      {/* ── Sites table ───────────────────────────────────────────────── */}
      <div className="mt-10">
        <div className="section-label mb-4">Sites</div>
        <div
          className="overflow-hidden rounded-xl"
          style={{
            background: "white",
            border: "1px solid var(--border)",
            boxShadow: "0 1px 3px rgba(15,15,15,0.04)",
          }}
        >
          <table className="min-w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {[
                  { label: "Site", align: "left" },
                  { label: "Staff", align: "right" },
                  { label: "Current Payroll", align: "right" },
                  { label: "Proposed Payroll", align: "right" },
                  { label: "Change", align: "right" },
                  { label: "Issues", align: "center" },
                  { label: "Status", align: "left" },
                  { label: "", align: "right" },
                ].map(({ label, align }, i) => (
                  <th
                    key={label + i}
                    className={`px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-${align}`}
                    style={{ background: "var(--neutral-50)", color: "var(--neutral-500)" }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sites.map((s, idx) => {
                const siteDelta = s.payroll_proposed - s.payroll_current;
                const issueCount =
                  s.issues.below_award + s.issues.no_proposed_rate + s.issues.unknown_level;
                return (
                  <tr
                    key={s.site}
                    style={{
                      borderBottom: idx < sites.length - 1 ? "1px solid var(--neutral-100)" : "none",
                    }}
                  >
                    <td className="px-5 py-3 font-semibold" style={{ color: "var(--neutral-900)" }}>
                      {s.site}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums" style={{ color: "var(--neutral-700)" }}>
                      {s.staff}
                    </td>
                    <td
                      className="px-5 py-3 text-right tabular-nums"
                      style={{ color: "var(--neutral-700)", fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}
                    >
                      {formatCurrency(s.payroll_current)}
                    </td>
                    <td
                      className="px-5 py-3 text-right tabular-nums"
                      style={{ color: "var(--neutral-700)", fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}
                    >
                      {s.payroll_proposed > 0 ? formatCurrency(s.payroll_proposed) : <span style={{ color: "var(--neutral-300)" }}>—</span>}
                    </td>
                    <td
                      className="px-5 py-3 text-right tabular-nums font-semibold"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.8125rem",
                        color: s.payroll_proposed > 0
                          ? siteDelta > 0 ? "var(--amber-700)" : "var(--green-700)"
                          : "var(--neutral-300)",
                      }}
                    >
                      {s.payroll_proposed > 0 ? formatDelta(siteDelta) : "—"}
                    </td>
                    <td className="px-5 py-3 text-center">
                      {issueCount > 0 ? (
                        <span
                          className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                          style={{ background: "var(--red-100)", color: "var(--red-700)" }}
                        >
                          {issueCount}
                        </span>
                      ) : (
                        <span style={{ color: "var(--neutral-300)" }}>—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={s.approval_status} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/review/${encodeURIComponent(s.site)}`}
                        className="text-xs font-semibold"
                        style={{ color: "var(--brand)" }}
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  highlight,
  tone = "neutral",
  dim,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
  tone?: "neutral" | "red" | "amber" | "green";
  dim?: boolean;
}) {
  const colorMap: Record<string, string> = {
    neutral: "var(--neutral-900)",
    red:     "var(--red-600)",
    amber:   "var(--amber-600)",
    green:   "var(--green-600)",
  };
  return (
    <div className="kpi-card">
      <div
        className="text-2xl font-bold tabular-nums"
        style={{
          color: highlight ? "var(--green-600)" : dim ? "var(--neutral-400)" : colorMap[tone],
          fontFamily: "var(--font-mono)",
        }}
      >
        {value}
      </div>
      <div
        className="mt-1 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--neutral-500)" }}
      >
        {label}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    not_submitted:      { bg: "var(--neutral-100)", color: "var(--neutral-600)" },
    pending:            { bg: "var(--amber-100)",   color: "var(--amber-700)"   },
    approved:           { bg: "var(--green-100)",   color: "var(--green-700)"   },
    changes_requested:  { bg: "var(--red-100)",     color: "var(--red-700)"     },
  };
  const labels: Record<string, string> = {
    not_submitted:      "Not submitted",
    pending:            "Pending",
    approved:           "Approved",
    changes_requested:  "Changes requested",
  };
  const s = styles[status] ?? styles.not_submitted;
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ background: s.bg, color: s.color }}
    >
      {labels[status] ?? status}
    </span>
  );
}

function formatCurrency(v: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(v);
}

function formatDelta(v: number): string {
  const abs = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Math.abs(v));
  return v >= 0 ? `+${abs}` : `-${abs}`;
}
