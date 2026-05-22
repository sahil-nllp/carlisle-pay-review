"use client";

/**
 * Dashboard analytics charts — rendered client-side (Recharts dependency).
 * Data is computed server-side in dashboard/page.tsx and passed as plain props.
 */
import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PieSlice {
  name: string;
  value: number;
  color: string;
}

export interface SitePayroll {
  site: string;
  current: number;  // in $'000
  proposed: number; // in $'000
}

export interface SiteIssues {
  site: string;
  belowAward: number;
  missingRate: number;
  unknownLevel: number;
}

export interface SiteCost {
  site: string;
  cost: number; // actual AUD (proposed - current)
}

export interface DashboardChartsProps {
  costBySite: SiteCost[];
  payrollBySite: SitePayroll[];
  letterSlices: PieSlice[];
  issuesBySite: SiteIssues[];
  totalPayrollCurrent: number;
  totalPayrollProposed: number;
  lettersSetCount: number;
  ratesSetCount: number;
  totalActive: number;
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtCurrency(v: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(v);
}

function fmtShort(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${v}`;
}

// ── Card wrapper ──────────────────────────────────────────────────────────────
function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "20px 24px 20px",
        boxShadow: "0 1px 3px rgba(15,15,15,0.04)",
      }}
    >
      <div className="mb-5 flex items-baseline gap-2">
        <h3 style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{title}</h3>
        {subtitle && (
          <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Legend item ───────────────────────────────────────────────────────────────
function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 10, color: "#94a3b8" }}>{label}</span>
    </div>
  );
}

// ── Letter assignment breakdown ───────────────────────────────────────────────
// Progress bar showing assigned vs total + type breakdown.
// Donuts fail badly when 95% are "No Letter".
function LetterBreakdown({ slices }: { slices: PieSlice[] }) {
  const total = slices.reduce((s, a) => s + a.value, 0);
  const noLetter = slices.find((s) => s.name === "No Letter")?.value ?? 0;
  const assigned = total - noLetter;
  const pct = total > 0 ? Math.round((assigned / total) * 100) : 0;
  const typeSlices = slices.filter((s) => s.name !== "No Letter");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Assignment progress bar */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: "#94a3b8",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Letters assigned
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#0f172a",
              fontFamily: "var(--font-mono)",
            }}
          >
            {assigned} / {total}
          </span>
        </div>
        <div
          style={{
            height: 10,
            borderRadius: 6,
            overflow: "hidden",
            display: "flex",
            background: "#f1f5f9",
          }}
        >
          {typeSlices
            .filter((s) => s.value > 0)
            .map((s) => (
              <div
                key={s.name}
                style={{
                  width: `${(s.value / total) * 100}%`,
                  background: s.color,
                  minWidth: 4,
                }}
              />
            ))}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "#94a3b8",
            marginTop: 5,
            textAlign: "right",
          }}
        >
          {pct}% of employees assigned
        </div>
      </div>

      {/* Letter type rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {typeSlices.map((s) => (
          <div
            key={s.name}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: s.color,
                  opacity: s.value === 0 ? 0.2 : 1,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: s.value === 0 ? "#cbd5e1" : "#475569",
                }}
              >
                {s.name}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {s.value > 0 && assigned > 0 && (
                <span style={{ fontSize: 10, color: "#94a3b8" }}>
                  {Math.round((s.value / assigned) * 100)}% of assigned
                </span>
              )}
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: s.value === 0 ? "#e2e8f0" : "#0f172a",
                  fontFamily: "var(--font-mono)",
                  minWidth: 26,
                  textAlign: "right",
                }}
              >
                {s.value}
              </span>
            </div>
          </div>
        ))}

        {/* Divider + unassigned row */}
        <div style={{ height: 1, background: "#f1f5f9", margin: "2px 0" }} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: "#e2e8f0",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 12, fontWeight: 500, color: "#94a3b8" }}>
              Not assigned
            </span>
          </div>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#94a3b8",
              fontFamily: "var(--font-mono)",
              minWidth: 26,
              textAlign: "right",
            }}
          >
            {noLetter}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Custom tooltips ───────────────────────────────────────────────────────────
function CostTip({ active, payload, label }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || !payload.length) return null;
  const val = Number(payload[0]?.value ?? 0);
  return (
    <div
      style={{
        background: "white",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "10px 14px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        fontSize: 12,
      }}
    >
      <p style={{ fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>{String(label)}</p>
      <p style={{ color: "#2563eb" }}>
        Cost of increase: {fmtCurrency(val)}
      </p>
    </div>
  );
}

function PayrollTip({ active, payload, label }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || !payload.length) return null;
  return (
    <div
      style={{
        background: "white",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "10px 14px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        fontSize: 12,
      }}
    >
      <p style={{ fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>{String(label)}</p>
      {payload.map((p: Record<string, unknown>) => (
        <p key={String(p.name)} style={{ color: String(p.fill), marginBottom: 2 }}>
          {String(p.name)}: {fmtCurrency(Number(p.value) * 1000)}
        </p>
      ))}
    </div>
  );
}

function IssueTip({ active, payload, label }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || !payload.length) return null;
  const total = payload.reduce(
    (s: number, p: Record<string, unknown>) => s + Number(p.value),
    0,
  );
  if (!total) return null;
  return (
    <div
      style={{
        background: "white",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "10px 14px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        fontSize: 12,
      }}
    >
      <p style={{ fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>{String(label)}</p>
      {payload
        .filter((p: Record<string, unknown>) => Number(p.value) > 0)
        .map((p: Record<string, unknown>) => (
          <p key={String(p.name)} style={{ color: String(p.fill), marginBottom: 2 }}>
            {String(p.name)}: {String(p.value)}
          </p>
        ))}
    </div>
  );
}

// ── Payroll stat pill ─────────────────────────────────────────────────────────
function StatPill({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: "14px 18px",
        boxShadow: "0 1px 3px rgba(15,15,15,0.04)",
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 800,
          color: highlight ? "#16a34a" : "#0f172a",
          fontFamily: "var(--font-mono)",
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, fontWeight: 600, color: "#16a34a", marginTop: 2 }}>{sub}</div>
      )}
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "#94a3b8",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginTop: 5,
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function DashboardCharts({
  costBySite,
  payrollBySite,
  letterSlices,
  issuesBySite,
  totalPayrollCurrent,
  totalPayrollProposed,
  lettersSetCount,
  ratesSetCount,
  totalActive,
}: DashboardChartsProps) {
  const delta = totalPayrollProposed - totalPayrollCurrent;

  const pct =
    totalPayrollCurrent > 0
      ? ((delta / totalPayrollCurrent) * 100).toFixed(1)
      : null;

  const barH = (n: number) => Math.max(160, n * 36);
  const allClear = issuesBySite.length === 0;

  return (
    <div className="mt-10 space-y-8">

      {/* ── Payroll overview stats ─────────────────────────────────────── */}
      <div>
        <div className="section-label mb-4">Payroll overview</div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatPill label="Current annual payroll" value={fmtCurrency(totalPayrollCurrent)} />
          <StatPill
            label="Proposed annual payroll"
            value={totalPayrollProposed > 0 ? fmtCurrency(totalPayrollProposed) : "—"}
          />
          <StatPill
            label="Budget increase"
            value={delta > 0 ? `+${fmtCurrency(delta)}` : "—"}
            sub={pct && delta > 0 ? `+${pct}% on current` : undefined}
            highlight={delta > 0}
          />
          <StatPill
            label="Letters assigned"
            value={`${lettersSetCount} / ${totalActive}`}
            sub={
              totalActive > 0
                ? `${Math.round((lettersSetCount / totalActive) * 100)}% complete`
                : undefined
            }
          />
        </div>
      </div>

      {/* ── Charts 2 × 2 grid ─────────────────────────────────────────── */}
      <div>
        <div className="section-label mb-4">Analytics</div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

          {/* ① Cost of increases by site */}
          <ChartCard title="Cost of Increases by Site">
            {costBySite.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center gap-3"
                style={{ height: 160 }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: "#eff6ff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                  }}
                >
                  —
                </div>
                <p style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600 }}>
                  No proposed rates set yet
                </p>
              </div>
            ) : (
              <>
                <div style={{ maxHeight: 380, overflowY: "auto" }}>
                  <ResponsiveContainer width="100%" height={barH(costBySite.length)}>
                    <BarChart
                      data={costBySite}
                      layout="vertical"
                      margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
                      barCategoryGap="40%"
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f8fafc" />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        tickFormatter={(v) =>
                          v === 0 ? "$0" : `$${new Intl.NumberFormat("en-AU").format(v)}`
                        }
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="site"
                        tick={{ fontSize: 10, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                        width={88}
                      />
                      <Tooltip content={<CostTip />} />
                      <Bar dataKey="cost" name="Cost of increase" fill="#2563eb" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex gap-4">
                  <LegendItem color="#2563eb" label="Cost of increase (AUD)" />
                </div>
              </>
            )}
          </ChartCard>

          {/* ② Annual payroll by site */}
          <ChartCard title="Annual Payroll by Site" subtitle="A$'000">
            <div style={{ maxHeight: 380, overflowY: "auto" }}>
              <ResponsiveContainer width="100%" height={barH(payrollBySite.length)}>
                <BarChart
                  data={payrollBySite}
                  layout="vertical"
                  margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
                  barCategoryGap="30%"
                  barGap={3}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f8fafc" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickFormatter={(v) => `$${v}k`}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="site"
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                    width={88}
                  />
                  <Tooltip content={<PayrollTip />} />
                  <Bar dataKey="current" name="Current" fill="#94a3b8" radius={[0, 3, 3, 0]} />
                  <Bar dataKey="proposed" name="Proposed" fill="#d32e53" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex gap-4">
              <LegendItem color="#94a3b8" label="Current" />
              <LegendItem color="#d32e53" label="Proposed" />
            </div>
          </ChartCard>

          {/* ③ Letter type distribution */}
          <ChartCard title="Letter Type Distribution">
            <LetterBreakdown slices={letterSlices} />
          </ChartCard>

          {/* ④ Outstanding issues by site */}
          <ChartCard title="Outstanding Issues by Site">
            {allClear ? (
              <div
                className="flex flex-col items-center justify-center gap-3"
                style={{ height: 160 }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: "#f0fdf4",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22,
                  }}
                >
                  ✓
                </div>
                <p style={{ fontSize: 13, color: "#16a34a", fontWeight: 600 }}>
                  All clear — no outstanding issues
                </p>
              </div>
            ) : (
              <>
                <div style={{ maxHeight: 380, overflowY: "auto" }}>
                  <ResponsiveContainer width="100%" height={barH(issuesBySite.length)}>
                    <BarChart
                      data={issuesBySite}
                      layout="vertical"
                      margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
                      barCategoryGap="30%"
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f8fafc" />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        allowDecimals={false}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="site"
                        tick={{ fontSize: 10, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                        width={88}
                      />
                      <Tooltip content={<IssueTip />} />
                      <Bar dataKey="belowAward" name="Below Award" stackId="a" fill="#ef4444" />
                      <Bar dataKey="missingRate" name="Missing Rate" stackId="a" fill="#f97316" />
                      <Bar
                        dataKey="unknownLevel"
                        name="Unknown Level"
                        stackId="a"
                        fill="#eab308"
                        radius={[0, 3, 3, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap gap-4">
                  <LegendItem color="#ef4444" label="Below Award" />
                  <LegendItem color="#f97316" label="Missing Rate" />
                  <LegendItem color="#eab308" label="Unknown Level" />
                </div>
              </>
            )}
          </ChartCard>

        </div>
      </div>
    </div>
  );
}
