import Link from "next/link";

import DashboardCharts from "@/components/dashboard-charts";
import { getCurrentUser } from "@/lib/auth.server";
import {
  getCurrentCycleServer,
  getCycleEmployeesServer,
} from "@/lib/cycles.server";
import { roleLabel } from "@/lib/nav";
import { getSiteSummariesServer } from "@/lib/review.server";

export default async function DashboardPage() {
  const user = (await getCurrentUser())!;
  const cycle = await getCurrentCycleServer();

  if (!cycle) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: "var(--brand-light)" }}
        >
          <svg width="24" height="24" viewBox="0 0 15 15" fill="none">
            <path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14" stroke="var(--brand)" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="7.5" cy="7.5" r="4" stroke="var(--brand)" strokeWidth="1.5"/>
          </svg>
        </div>
        <p className="text-sm font-semibold" style={{ color: "var(--neutral-800)" }}>
          No active review cycle
        </p>
        <p className="mx-auto mt-2 max-w-sm text-xs" style={{ color: "var(--neutral-500)" }}>
          Upload the approved Wage Model Excel file to start a new cycle.
          Site managers and approvers will then be able to begin their reviews.
        </p>
        {user.role === "hr_admin" && (
          <Link
            href="/admin/upload-model"
            className="mt-6 inline-block rounded-lg px-5 py-2.5 text-sm font-semibold"
            style={{ background: "var(--brand)", color: "white" }}
          >
            Upload wage model
          </Link>
        )}
      </div>
    );
  }

  const [employees, siteSummaries] = await Promise.all([
    getCycleEmployeesServer(cycle.id),
    getSiteSummariesServer(cycle.id),
  ]);
  const active = employees.filter((e) => !e.is_departed);
  const sites = new Set(active.map((e) => e.site));
  const departed = employees.length - active.length;
  const sitesApproved = siteSummaries.filter((s) => s.approval_status === "approved").length;

  // ── Chart data (computed server-side, passed to client component) ──────────
  const costBySite = siteSummaries
    .filter((s) => s.payroll_proposed > 0)
    .map((s) => ({
      site: s.site,
      cost: Math.round(s.payroll_proposed - s.payroll_current),
    }))
    .sort((a, b) => b.cost - a.cost);

  const payrollBySite = siteSummaries
    .map((s) => ({
      site: s.site,
      current: Math.round(s.payroll_current / 1_000),
      proposed: Math.round(s.payroll_proposed / 1_000),
    }))
    .sort((a, b) => b.current - a.current);

  const letterColors: Record<string, string> = {
    "Letter A": "#3b82f6",
    "Letter B": "#8b5cf6",
    "Letter C": "#06b6d4",
    "No Letter": "#e2e8f0",
  };
  const letterCounts: Record<string, number> = {
    "Letter A": 0,
    "Letter B": 0,
    "Letter C": 0,
    "No Letter": 0,
  };
  for (const e of active) {
    const lt = e.letter_type;
    if (lt === "A") letterCounts["Letter A"]++;
    else if (lt === "B") letterCounts["Letter B"]++;
    else if (lt === "C") letterCounts["Letter C"]++;
    else letterCounts["No Letter"]++;
  }
  const letterSlices = Object.entries(letterColors).map(([name, color]) => ({
    name,
    value: letterCounts[name],
    color,
  }));

  const issuesBySite = siteSummaries
    .filter((s) => s.issues.below_award + s.issues.no_proposed_rate + s.issues.unknown_level > 0)
    .map((s) => ({
      site: s.site,
      belowAward: s.issues.below_award,
      missingRate: s.issues.no_proposed_rate,
      unknownLevel: s.issues.unknown_level,
    }));

  const totalPayrollCurrent = siteSummaries.reduce((sum, s) => sum + s.payroll_current, 0);
  const totalPayrollProposed = siteSummaries.reduce((sum, s) => sum + s.payroll_proposed, 0);
  const lettersSetCount = active.filter((e) => e.letter_type != null).length;
  const ratesSetCount = active.filter((e) => e.proposed_rate != null).length;

  return (
    <div style={{ animation: "slideUp 0.4s ease both" }}>
      {/* ── Cycle context ─────────────────────────────────────────────── */}
      <div className="mb-7 flex items-center gap-3">
        <div
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{
            background: "var(--brand-light)",
            color: "var(--brand-dark)",
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--brand)" }}
          />
          {cycle.fy_label}
        </div>
        <span className="text-xs" style={{ color: "var(--neutral-400)" }}>
          Effective {cycle.effective_date}
        </span>
        <span className="text-xs" style={{ color: "var(--neutral-300)" }}>·</span>
        <span className="text-xs" style={{ color: "var(--neutral-500)" }}>
          {user.name} — {roleLabel(user.role)}
        </span>
      </div>

      {/* ── KPI cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Active Employees" value={active.length} />
        <KpiCard label="Sites" value={sites.size} />
        <KpiCard
          label="Sites Approved"
          value={`${sitesApproved} / ${siteSummaries.length}`}
          highlight={sitesApproved === siteSummaries.length && siteSummaries.length > 0}
        />
        <KpiCard label="Departed" value={departed} dim />
      </div>

      {/* ── Quick actions (admin only) ─────────────────────────────────── */}
      {user.role === "hr_admin" && (
        <div className="mt-8">
          <div className="section-label mb-4">Quick actions</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <ActionCard
              href="/admin/upload-model"
              icon={
                <svg width="16" height="16" viewBox="0 0 15 15" fill="none">
                  <path d="M7.5 10V2M4.5 5l3-3 3 3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M2 11.5v1a1 1 0 001 1h9a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
                </svg>
              }
              title="Re-upload wage model"
              description="Replace or merge employee data with a new Excel file"
            />
            <ActionCard
              href="/review"
              icon={
                <svg width="16" height="16" viewBox="0 0 15 15" fill="none">
                  <rect x="1" y="2" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.25"/>
                  <path d="M4 6h7M4 9h4.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
                </svg>
              }
              title="Open review"
              description="Edit proposed rates site-by-site and submit for approval"
            />
            <ActionCard
              href="/downloads"
              icon={
                <svg width="16" height="16" viewBox="0 0 15 15" fill="none">
                  <path d="M7.5 1.5v8M4.5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M2 11.5v1a1 1 0 001 1h9a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
                </svg>
              }
              title="Downloads"
              description="Pay letters, regional files, UKG payroll upload"
            />
          </div>
        </div>
      )}

      {/* ── Site status table ─────────────────────────────────────────── */}
      <div className="mt-10">
        <div className="section-label mb-4">Site-by-site status</div>
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
                {["Site", "Staff", "Annual Payroll", "Status", ""].map((h, i) => (
                  <th
                    key={h + i}
                    className={`px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider ${i >= 1 && i <= 2 ? "text-right" : ""}`}
                    style={{
                      background: "var(--neutral-50)",
                      color: "var(--neutral-500)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {siteSummaries.map((s, idx) => (
                <tr
                  key={s.site}
                  style={{
                    borderBottom: idx < siteSummaries.length - 1 ? "1px solid var(--neutral-100)" : "none",
                  }}
                >
                  <td className="px-5 py-3 font-semibold text-sm" style={{ color: "var(--neutral-900)" }}>
                    {s.site}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-sm" style={{ color: "var(--neutral-700)" }}>
                    {s.staff}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-sm" style={{ color: "var(--neutral-700)", fontFamily: "var(--font-mono)" }}>
                    {formatCurrency(s.payroll_current)}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={s.approval_status} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/review/${encodeURIComponent(s.site)}`}
                      className="text-xs font-semibold transition-colors"
                      style={{ color: "var(--brand)" }}
                    >
                      Review →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Analytics charts ──────────────────────────────────────────── */}
      <DashboardCharts
        costBySite={costBySite}
        payrollBySite={payrollBySite}
        letterSlices={letterSlices}
        issuesBySite={issuesBySite}
        totalPayrollCurrent={totalPayrollCurrent}
        totalPayrollProposed={totalPayrollProposed}
        lettersSetCount={lettersSetCount}
        ratesSetCount={ratesSetCount}
        totalActive={active.length}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  highlight,
  dim,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
  dim?: boolean;
}) {
  return (
    <div className="kpi-card">
      <div
        className="text-2xl font-bold tabular-nums"
        style={{
          color: highlight ? "var(--green-600)" : dim ? "var(--neutral-400)" : "var(--neutral-900)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--neutral-500)" }}>
        {label}
      </div>
    </div>
  );
}

function ActionCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl p-5 transition-all"
      style={{
        background: "white",
        border: "1px solid var(--border)",
        boxShadow: "0 1px 3px rgba(15,15,15,0.04)",
      }}
    >
      <div
        className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg"
        style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
      >
        {icon}
      </div>
      <div className="text-sm font-semibold" style={{ color: "var(--neutral-900)" }}>
        {title}
      </div>
      <div className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--neutral-500)" }}>
        {description}
      </div>
    </Link>
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
    pending:            "Pending approval",
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
