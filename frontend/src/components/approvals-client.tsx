"use client";

import { useRouter } from "next/navigation";
import React, { useCallback, useState, useTransition } from "react";

import { ApiError } from "@/lib/api";
import { decideSite, type ApprovalDetail } from "@/lib/approvals";
import {
  downloadDraftLetter,
  getAwardRates,
  getSiteEmployees,
  patchEmployee,
  suppressCheck,
  unsuppressCheck,
  type AwardRateSummary,
  type CheckResult,
  type EmployeeWithCompliance,
  type SuppressionInfo,
} from "@/lib/review";
import { getPPBands, filterPPOptionsForAward, type PPBand } from "@/lib/pp-bands";
import { PPLevelPicker } from "@/components/pp-level-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Shared helpers ────────────────────────────────────────────────────────────
const NONE = "__none__";
const CHANGE_TYPES = ["CPI Increase", "% Increase", "Fixed Rate", "Per Admin PP", "No Change"];

function inputKind(ct: string): "percent" | "dollars" | "none" {
  const t = ct.toLowerCase();
  if (t === "cpi increase" || t === "% increase") return "percent";
  if (t === "fixed rate" || t === "per admin pp") return "dollars";
  return "none";
}
function isCpiLocked(ct: string) { return ct.toLowerCase() === "cpi increase"; }
function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(v);
}
function formatRate(v: number) { return `$${v.toFixed(2)}`; }
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// ── Per-employee row state ────────────────────────────────────────────────────
interface EmpRowState {
  change_type: string;
  change_input: string;
  letter_type: string;       // display-only — auto-inferred by backend
  proposed_rate: number | null;
  proposed_award: string | null;
  pp_level: string | null;
  notes: string;
  compliance: EmployeeWithCompliance["compliance"];
  saveState: "idle" | "saving" | "saved" | "error";
  error: string | null;
}

function initEmpRow(e: EmployeeWithCompliance, cpiRate: number): EmpRowState {
  return {
    change_type:    e.change_type   ?? "CPI Increase",
    change_input:   e.change_input != null ? String(e.change_input) : String(cpiRate),
    letter_type:    e.letter_type   ?? "",
    proposed_rate:  e.proposed_rate ?? null,
    proposed_award: e.proposed_award ?? null,
    pp_level:       e.pp_level      ?? null,
    notes:          e.notes         ?? "",
    compliance:     e.compliance,
    saveState: "idle",
    error: null,
  };
}

const LETTER_TYPES = ["A", "B", "C"];

type EmpRowPatch = Partial<{
  change_type: string;
  change_input: string;
  proposed_award: string | null;
  pp_level: string | null;
  letter_type: string | null;
  notes: string;
}>;

// ─────────────────────────────────────────────────────────────────────────────
export function ApprovalsClient({
  cycleId,
  cycleLabel,
  initialApprovals,
  cpiRate = 0,
}: {
  cycleId: number;
  cycleLabel: string;
  initialApprovals: ApprovalDetail[];
  cpiRate?: number;
}) {
  const router = useRouter();
  const [approvals, setApprovals] = useState(initialApprovals);
  const [decideState, setDecideState] = useState<Record<string, {
    comment: string; pending: boolean; error: string | null;
  }>>({});

  function getDs(site: string) {
    return decideState[site] ?? { comment: "", pending: false, error: null };
  }
  function setDs(site: string, patch: Partial<ReturnType<typeof getDs>>) {
    setDecideState((prev) => ({ ...prev, [site]: { ...getDs(site), ...patch } }));
  }

  const [, startTransition] = useTransition();
  function handleApprove(site: string) {
    const ds = getDs(site);
    setDs(site, { pending: true, error: null });
    startTransition(async () => {
      try {
        const res = await decideSite(cycleId, site, { decision: "approve", comment: ds.comment || null });
        setApprovals((prev) => prev.map((a) => a.site === site ? { ...a, status: res.status } : a));
        setDs(site, { pending: false, comment: "" });
        router.refresh();
      } catch (err) {
        setDs(site, { pending: false, error: err instanceof ApiError ? err.message : "Action failed" });
      }
    });
  }

  const pending  = approvals.filter((a) => a.status === "pending");
  const decided  = approvals.filter((a) => a.status !== "pending");
  const approved = approvals.filter((a) => a.status === "approved").length;
  const changed  = approvals.filter((a) => a.status === "changes_requested").length;

  return (
    <div className="mt-6 space-y-8" style={{ animation: "slideUp 0.4s ease both" }}>
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Total submitted"   value={approvals.length} />
        <KpiCard label="Pending decision"  value={pending.length}  tone={pending.length > 0 ? "amber" : "neutral"} />
        <KpiCard label="Approved"          value={approved}        tone={approved > 0 ? "green" : "neutral"} />
        <KpiCard label="Changes requested" value={changed}         tone={changed > 0 ? "red" : "neutral"} />
      </div>

      {approvals.length === 0 && (
        <div className="rounded-xl p-12 text-center" style={{ background: "white", border: "1px solid var(--border)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--neutral-700)" }}>Nothing submitted yet</p>
          <p className="mt-1 text-xs" style={{ color: "var(--neutral-500)" }}>
            Sites will appear here once regional managers submit them.
          </p>
        </div>
      )}

      {pending.length > 0 && (
        <section>
          <div className="section-label mb-4">Awaiting decision</div>
          <div className="space-y-4">
            {pending.map((a) => (
              <ApprovalCard
                key={a.site}
                approval={a}
                cycleId={cycleId}
                cycleLabel={cycleLabel}
                cpiRate={cpiRate}
                ds={getDs(a.site)}
                onCommentChange={(v) => setDs(a.site, { comment: v })}
                onApprove={() => handleApprove(a.site)}
              />
            ))}
          </div>
        </section>
      )}

      {decided.length > 0 && (
        <section>
          <div className="section-label mb-4">Decided</div>
          <div className="overflow-hidden rounded-xl" style={{ background: "white", border: "1px solid var(--border)" }}>
            <table className="min-w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Site", "Staff", "Proposed Payroll", "Status", "Decided by", "Notes"].map((h, i) => (
                    <th key={h} className={`px-5 py-3 text-[11px] font-semibold uppercase tracking-wider ${i === 1 || i === 2 ? "text-right" : "text-left"}`}
                      style={{ background: "var(--neutral-50)", color: "var(--neutral-500)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {decided.map((a, idx) => (
                  <tr key={a.site} style={{ borderBottom: idx < decided.length - 1 ? "1px solid var(--neutral-100)" : "none" }}>
                    <td className="px-5 py-3 font-semibold" style={{ color: "var(--neutral-900)" }}>{a.site}</td>
                    <td className="px-5 py-3 text-right tabular-nums" style={{ color: "var(--neutral-700)" }}>{a.staff}</td>
                    <td className="px-5 py-3 text-right tabular-nums" style={{ color: "var(--neutral-700)", fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}>
                      {formatCurrency(a.payroll_proposed)}
                    </td>
                    <td className="px-5 py-3"><StatusBadge status={a.status} /></td>
                    <td className="px-5 py-3 text-sm" style={{ color: "var(--neutral-700)" }}>
                      {a.decided_by ?? "—"}
                      {a.decided_at && <span className="ml-1 text-xs" style={{ color: "var(--neutral-400)" }}>{formatDate(a.decided_at)}</span>}
                    </td>
                    <td className="px-5 py-3 text-xs italic" style={{ color: "var(--neutral-500)" }}>{a.decision_notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Approval card — site summary + inline employee table + decision panel
// ─────────────────────────────────────────────────────────────────────────────
const TABLE_COL_COUNT = 14; // Emp#, Name, Age, Status, Current Award, Proposed Award, PP Level, Current Rate, Change Type, Input, Proposed Rate, Letter, Notes, Actions

function ApprovalCard({
  approval: a, cycleId, cycleLabel, cpiRate, ds,
  onCommentChange, onApprove,
}: {
  approval: ApprovalDetail;
  cycleId: number;
  cycleLabel: string;
  cpiRate: number;
  ds: { comment: string; pending: boolean; error: string | null };
  onCommentChange: (v: string) => void;
  onApprove: () => void;
}) {
  const [expanded, setExpanded]           = useState(false);
  const [employees, setEmployees]         = useState<EmployeeWithCompliance[] | null>(null);
  const [rows, setRows]                   = useState<Record<number, EmpRowState>>({});
  const [awardRates, setAwardRates]       = useState<AwardRateSummary[]>([]);
  const [ppBands, setPPBands]             = useState<PPBand[]>([]);
  const [expandedEmpId, setExpandedEmpId] = useState<number | null>(null);
  const [editingEmpId, setEditingEmpId]   = useState<number | null>(null);
  const [loading, setLoading]             = useState(false);
  const [loadErr, setLoadErr]             = useState<string | null>(null);

  const payrollDelta = a.payroll_proposed - a.payroll_current;

  async function handleExpand() {
    if (!expanded && !employees) {
      setLoading(true);
      setLoadErr(null);
      try {
        const [data, rates, bands] = await Promise.all([
          getSiteEmployees(cycleId, a.site),
          getAwardRates(cycleId),
          getPPBands(cycleId),
        ]);
        const active = data.filter((e) => !e.is_departed);
        setEmployees(active);
        setRows(Object.fromEntries(active.map((e) => [e.id, initEmpRow(e, cpiRate)])));
        setAwardRates(rates);
        setPPBands(bands);
      } catch (err) {
        setLoadErr(err instanceof ApiError ? err.message : "Failed to load employees");
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  }

  const handleEmpUpdated = useCallback((updated: EmployeeWithCompliance) => {
    setEmployees((prev) => prev ? prev.map((e) => e.id === updated.id ? updated : e) : prev);
    setRows((prev) => ({
      ...prev,
      [updated.id]: {
        ...prev[updated.id],
        change_type:    updated.change_type   ?? "CPI Increase",
        change_input:   updated.change_input != null ? String(updated.change_input) : String(cpiRate),
        letter_type:    updated.letter_type   ?? "",
        proposed_rate:  updated.proposed_rate ?? null,
        proposed_award: updated.proposed_award ?? null,
        pp_level:       updated.pp_level      ?? null,
        notes:          updated.notes         ?? "",
        compliance:     updated.compliance,
      },
    }));
  }, [cpiRate]);

  const saveSeqRef = React.useRef<Record<number, number>>({});

  const saveRow = useCallback(
    async (emp: EmployeeWithCompliance, patch: EmpRowPatch) => {
      const seq = (saveSeqRef.current[emp.id] ?? 0) + 1;
      saveSeqRef.current[emp.id] = seq;

      setRows((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], saveState: "saving", error: null } }));
      try {
        const row = rows[emp.id];
        const changeType  = patch.change_type  ?? row?.change_type  ?? "";
        const changeInput = patch.change_input  ?? row?.change_input ?? String(cpiRate);

        const proposedAwardPatch = "proposed_award" in patch ? { proposed_award: patch.proposed_award ?? "" } : {};
        const ppLevelPatch       = "pp_level" in patch       ? { pp_level: patch.pp_level ?? "" }             : {};
        const letterTypePatch    = "letter_type" in patch    ? { letter_type: patch.letter_type ?? null }      : {};

        const updated = await patchEmployee(emp.id, {
          change_type:  changeType  || null,
          change_input: inputKind(changeType) === "none" ? null : (parseFloat(changeInput) || null),
          ...proposedAwardPatch,
          ...ppLevelPatch,
          ...letterTypePatch,
          notes: (patch.notes ?? row?.notes) || null,
        });

        if (saveSeqRef.current[emp.id] !== seq) return;

        setRows((prev) => ({
          ...prev,
          [emp.id]: {
            ...prev[emp.id],
            change_type:    updated.change_type   ?? "CPI Increase",
            change_input:   updated.change_input  != null ? String(updated.change_input) : String(cpiRate),
            letter_type:    updated.letter_type   ?? "",
            proposed_rate:  updated.proposed_rate ?? null,
            proposed_award: updated.proposed_award ?? null,
            pp_level:       updated.pp_level      ?? null,
            notes:          updated.notes         ?? "",
            compliance:     updated.compliance,
            saveState: "saved",
            error: null,
          },
        }));
        setEmployees((prev) => prev ? prev.map((e) => e.id === emp.id ? { ...e, proposed_rate: updated.proposed_rate } : e) : prev);
        setTimeout(() => setRows((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], saveState: "idle" } })), 1500);
      } catch (err) {
        if (saveSeqRef.current[emp.id] !== seq) return;
        setRows((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], saveState: "error", error: err instanceof ApiError ? err.message : "Save failed" } }));
      }
    },
    [rows, cpiRate],
  );

  // ── Live issue counts ──────────────────────────────────────────────────────
  let liveFailCount: number;
  let liveWarnCount: number;
  if (employees !== null) {
    liveFailCount = employees.reduce((n, emp) => n + (rows[emp.id]?.compliance.checks.some((c) => c.status === "fail") ? 1 : 0), 0);
    liveWarnCount = employees.reduce((n, emp) => n + (rows[emp.id]?.compliance.checks.some((c) => c.status === "warn") ? 1 : 0), 0);
  } else {
    liveFailCount = a.hard_issues;
    liveWarnCount = a.warn_count;
  }

  // ── Approval readiness gate ────────────────────────────────────────────────
  const approvalBlockers: string[] = [];
  if (employees === null) {
    if (a.hard_issues > 0)
      approvalBlockers.push(`${a.hard_issues} hard compliance failure${a.hard_issues !== 1 ? "s" : ""}`);
    if (a.warn_count > 0)
      approvalBlockers.push(`${a.warn_count} unresolved warning${a.warn_count !== 1 ? "s" : ""} — expand employees to mark as noted`);
  } else {
    const missingRate = employees.filter((e) => !rows[e.id]?.proposed_rate).length;
    if (liveFailCount > 0) approvalBlockers.push(`${liveFailCount} employee${liveFailCount !== 1 ? "s" : ""} with hard compliance failures`);
    if (liveWarnCount > 0) approvalBlockers.push(`${liveWarnCount} unresolved warning${liveWarnCount !== 1 ? "s" : ""} — mark as noted or fix first`);
    if (missingRate > 0)   approvalBlockers.push(`${missingRate} missing proposed rate`);
  }
  const approvalReady = approvalBlockers.length === 0;

  const TABLE_HEADERS = [
    { label: "",               align: "center" }, // Actions (Edit/Done) — first
    { label: "Emp #",          align: "left"   },
    { label: "Name",           align: "left"   },
    { label: "Age",            align: "center" },
    { label: "Status",         align: "center" },
    { label: "Current Award",  align: "left"   },
    { label: "Proposed Award", align: "left"   },
    { label: "PP Level",       align: "left"   },
    { label: "Current Rate",   align: "right"  },
    { label: "Change Type",    align: "left"   },
    { label: "Input",          align: "right"  },
    { label: "Proposed Rate",  align: "right"  },
    { label: "Letter",         align: "center" },
    { label: "Notes",          align: "left"   },
  ];

  return (
    <div className="overflow-hidden rounded-xl"
      style={{ background: "white", border: "1px solid var(--amber-100)", boxShadow: "0 1px 3px rgba(15,15,15,0.04)" }}
    >
      <div className="h-0.5" style={{ background: "var(--amber-500)" }} />

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-base font-bold" style={{ color: "var(--neutral-900)" }}>{a.site}</div>
            <div className="mt-0.5 text-xs" style={{ color: "var(--neutral-500)" }}>
              {cycleLabel}
              {a.submitted_by && ` · Submitted by ${a.submitted_by}`}
              {a.submitted_at && ` on ${formatDate(a.submitted_at)}`}
            </div>
          </div>
          {liveFailCount > 0 && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: "var(--red-100)", color: "var(--red-700)" }}>
              ✗ {liveFailCount} fail{liveFailCount !== 1 ? "s" : ""}
            </span>
          )}
          {liveWarnCount > 0 && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: "var(--amber-100)", color: "var(--amber-700)" }}>
              ⚠ {liveWarnCount} warning{liveWarnCount !== 1 ? "s" : ""}
            </span>
          )}
          {employees !== null && liveFailCount === 0 && liveWarnCount === 0 && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: "var(--green-100)", color: "var(--green-700)" }}>
              ✓ All clear
            </span>
          )}
        </div>
        <StatusBadge status={a.status} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-px" style={{ background: "var(--neutral-100)", borderTop: "1px solid var(--neutral-100)" }}>
        <StatCell label="Staff" value={String(a.staff)} />
        <StatCell label="Current payroll" value={formatCurrency(a.payroll_current)} />
        <StatCell label="Proposed payroll" value={`${formatCurrency(a.payroll_proposed)} (${payrollDelta >= 0 ? "+" : ""}${formatCurrency(payrollDelta)})`} positive={payrollDelta > 0} />
      </div>

      {a.submission_notes && (
        <div className="px-5 py-3 text-xs" style={{ borderTop: "1px solid var(--neutral-100)", color: "var(--neutral-600)" }}>
          <span className="font-semibold" style={{ color: "var(--neutral-700)" }}>Submission notes: </span>{a.submission_notes}
        </div>
      )}

      {/* Expand toggle */}
      <div style={{ borderTop: "1px solid var(--neutral-100)" }}>
        <button
          onClick={handleExpand}
          className="flex w-full items-center justify-between px-5 py-3 text-sm font-semibold hover:bg-neutral-50 transition-colors"
          style={{ color: "var(--neutral-700)" }}
        >
          <span className="flex items-center gap-2">
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: "50%", background: "var(--neutral-100)", fontSize: 11 }}>
              {expanded ? "▲" : "▼"}
            </span>
            {expanded ? "Hide employees" : "Review & edit employees"}
          </span>
          {loading && <span className="text-xs" style={{ color: "var(--neutral-400)" }}>Loading…</span>}
        </button>
      </div>

      {/* ── Employee table ──────────────────────────────────────────────────── */}
      {expanded && (
        <div style={{ borderTop: "1px solid var(--neutral-100)" }}>
          {loadErr && <div className="px-5 py-4 text-sm" style={{ color: "var(--red-600)" }}>{loadErr}</div>}

          {employees && employees.length > 0 && (
            <div className="overflow-x-auto" style={{ maxHeight: "520px", overflowY: "auto" }}>
              <table className="min-w-full">
                <thead>
                  <tr>
                    {TABLE_HEADERS.map(({ label, align }) => (
                      <th key={label || "__actions"}
                        className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap"
                        style={{ textAlign: align as "left" | "right" | "center", background: "#0f172a", color: "rgba(255,255,255,0.65)", position: "sticky", top: 0, zIndex: 10 }}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => {
                    const row = rows[emp.id];
                    if (!row) return null;
                    return (
                      <React.Fragment key={emp.id}>
                        <ApprovalEmpRow
                          emp={emp}
                          row={row}
                          cpiRate={cpiRate}
                          awardRates={awardRates}
                          ppBands={ppBands}
                          isExpanded={expandedEmpId === emp.id}
                          isEditing={editingEmpId === emp.id}
                          onToggleExpand={() => setExpandedEmpId((prev) => prev === emp.id ? null : emp.id)}
                          onStartEdit={() => setEditingEmpId(emp.id)}
                          onStopEdit={() => setEditingEmpId(null)}
                          onChange={(field, value) => setRows((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], [field]: value } }))}
                          onSave={(patch) => saveRow(emp, patch)}
                        />
                        {expandedEmpId === emp.id && (
                          <tr>
                            <td colSpan={TABLE_COL_COUNT} className="px-5 py-4"
                              style={{ borderBottom: "1px solid var(--neutral-100)", background: "var(--neutral-50)" }}
                            >
                              <CompliancePanel
                                emp={emp}
                                compliance={row.compliance}
                                locked={false}
                                onUpdate={handleEmpUpdated}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {employees && employees.length === 0 && (
            <div className="px-5 py-6 text-center text-sm" style={{ color: "var(--neutral-500)" }}>No active employees.</div>
          )}
        </div>
      )}

      {/* ── Decision panel ──────────────────────────────────────────────────── */}
      <div className="px-5 py-4" style={{ borderTop: "1px solid var(--neutral-100)" }}>
        <div className="space-y-3">
          {!approvalReady && (
            <div className="rounded-lg px-4 py-3 space-y-1.5" style={{ background: "#fef2f2", border: "1px solid #fecaca" }}>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#dc2626" }}>
                Cannot approve — resolve before signing off:
              </p>
              {approvalBlockers.map((b, i) => (
                <div key={i} className="flex items-start gap-2 text-xs" style={{ color: "#b91c1c" }}>
                  <span className="mt-px shrink-0">✗</span><span>{b}</span>
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--neutral-600)" }}>
              Decision comment (optional)
            </label>
            <textarea
              rows={2}
              value={ds.comment}
              onChange={(e) => onCommentChange(e.target.value)}
              placeholder="Add a note visible to the regional manager…"
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{ border: "1px solid var(--neutral-200)", color: "var(--neutral-900)", outline: "none", resize: "vertical" }}
            />
          </div>

          {ds.error && <p className="text-xs font-medium" style={{ color: "var(--red-600)" }}>{ds.error}</p>}

          <div className="flex items-center gap-2">
            <div className="relative" title={!approvalReady ? approvalBlockers.join(" · ") : undefined}>
              <button
                onClick={onApprove}
                disabled={ds.pending || !approvalReady}
                className="rounded-lg px-5 py-2 text-sm font-semibold transition-colors"
                style={{
                  background: approvalReady ? "var(--green-700)" : "var(--neutral-100)",
                  color: approvalReady ? "white" : "var(--neutral-400)",
                  cursor: approvalReady ? "pointer" : "not-allowed",
                  opacity: ds.pending ? 0.5 : 1,
                }}
              >
                {ds.pending ? "Saving…" : "✓ Approve"}
              </button>
              {!approvalReady && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                  style={{ background: "var(--red-500)", color: "white" }}>
                  {approvalBlockers.length}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Employee row — view mode by default, full edit mode when activated
// ─────────────────────────────────────────────────────────────────────────────
function ApprovalEmpRow({
  emp, row, cpiRate, awardRates, ppBands,
  isExpanded, isEditing,
  onToggleExpand, onStartEdit, onStopEdit, onChange, onSave,
}: {
  emp: EmployeeWithCompliance;
  row: EmpRowState;
  cpiRate: number;
  awardRates: AwardRateSummary[];
  ppBands: PPBand[];
  isExpanded: boolean;
  isEditing: boolean;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onChange: (field: keyof EmpRowState, value: string) => void;
  onSave: (patch: EmpRowPatch) => void;
}) {
  const overall        = row.compliance.overall;
  const hasAwardChange = Boolean(row.proposed_award && row.proposed_award !== emp.current_award);
  const hasPPSelected  = Boolean(row.pp_level);
  const effectiveAward = row.proposed_award || emp.current_award;
  const rateHasFail    = row.compliance.checks.some((c) => c.label === "Award floor" && c.status === "fail");
  const kind           = inputKind(row.change_type);
  const cpiLocked      = isCpiLocked(row.change_type);
  const mono           = { fontFamily: "var(--font-mono)" };

  const rowBg     = overall === "fail" ? "var(--red-50)" : overall === "warn" ? "#fffbeb" : isEditing ? "#f8fafc" : "white";
  const rowAccent = overall === "fail" ? "var(--red-500)" : overall === "warn" ? "var(--amber-400)" : isEditing ? "#c7d2fe" : "transparent";
  const tdV = "px-3 py-3 align-top";
  const tdE = "px-3 py-4 align-top";
  const td  = isEditing ? tdE : tdV;

  return (
    <tr style={{ borderBottom: "1px solid var(--neutral-100)", background: rowBg, borderLeft: `3px solid ${rowAccent}` }}>

      {/* Actions — first column */}
      <td className="px-2 py-3 text-center align-middle" style={{ minWidth: 60 }}>
        {isEditing ? (
          <button onClick={onStopEdit}
            className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: "#0f172a", color: "white" }}>
            Done
          </button>
        ) : (
          <button onClick={onStartEdit}
            className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: "var(--neutral-100)", color: "var(--neutral-600)", border: "1px solid var(--neutral-200)" }}>
            ✏ Edit
          </button>
        )}
      </td>

      {/* Emp # */}
      <td className="px-3 py-3 align-middle" style={{ minWidth: 72 }}>
        <span className="text-xs tabular-nums" style={{ color: "#64748b", ...mono }}>#{emp.emp_num}</span>
      </td>

      {/* Name */}
      <td className="px-3 py-3 align-middle" style={{ minWidth: 130 }}>
        <div className="font-semibold" style={{ color: "#0f172a", fontSize: "0.8125rem" }}>
          {emp.first_name} {emp.last_name}
        </div>
      </td>

      {/* Age */}
      <td className="px-3 py-3 text-center align-middle text-xs" style={{ color: "var(--neutral-600)" }}>
        {emp.age ?? <span style={{ color: "var(--neutral-300)" }}>—</span>}
      </td>

      {/* Status */}
      <td className="px-3 py-3 text-center align-middle" style={{ minWidth: 80 }}>
        {row.saveState === "saving" ? (
          <span className="text-[11px]" style={{ color: "#94a3b8" }}>Saving…</span>
        ) : row.saveState === "saved" ? (
          <span className="text-[11px] font-semibold" style={{ color: "var(--green-600)" }}>✓ Saved</span>
        ) : row.saveState === "error" ? (
          <span className="text-[11px]" style={{ color: "var(--red-600)" }} title={row.error ?? ""}>Error</span>
        ) : (
          <button onClick={onToggleExpand} className="focus:outline-none">
            <OverallBadge overall={overall} checks={row.compliance.checks} isExpanded={isExpanded} />
          </button>
        )}
      </td>

      {/* Current Award */}
      <td className={`${td}`} style={{ minWidth: 180 }}>
        <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#0f172a" }}>
          {emp.current_award ?? <span style={{ color: "#cbd5e1" }}>—</span>}
        </div>
        {(emp.pp_level || (row.compliance.band_min != null && row.compliance.band_max != null)) && (
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
            {[
              emp.pp_level,
              row.compliance.band_min != null && row.compliance.band_max != null
                ? `${formatRate(row.compliance.band_min)}–${formatRate(row.compliance.band_max)}`
                : null,
            ].filter(Boolean).join(" · ")}
          </div>
        )}
      </td>

      {/* Proposed Award */}
      <td className={`${td}`} style={{ minWidth: 200 }}>
        {isEditing && awardRates.length > 0 ? (
          <>
            <Select
              value={row.proposed_award || emp.current_award || NONE}
              onValueChange={(v) => {
                const sel = v === NONE ? "" : v;
                const isSame = !sel || sel === emp.current_award;
                if (isSame) {
                  onChange("proposed_award", ""); onChange("pp_level", "");
                  onChange("change_type", "No Change"); onChange("change_input", "0");
                  onSave({ proposed_award: "", pp_level: "", change_type: "No Change", change_input: "0" });
                } else {
                  onChange("proposed_award", sel); onChange("pp_level", "");
                  onChange("change_type", "No Change"); onChange("change_input", "0");
                  onSave({ proposed_award: sel, pp_level: "", change_type: "No Change", change_input: "0" });
                }
              }}
            >
              <SelectTrigger className="h-7 w-full text-xs px-2"
                style={hasAwardChange
                  ? { borderColor: "#6ee7b7", background: "#f0fdf4", color: "#065f46", fontWeight: 700 }
                  : { borderColor: "var(--neutral-200)", color: "var(--neutral-500)" }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {awardRates.map((r) => (
                  <SelectItem key={r.award_level} value={r.award_level} className="text-xs">
                    <span>{r.award_level}</span>
                    {r.hourly_rate != null && <span style={{ color: "#94a3b8", marginLeft: 8 }}>{formatRate(r.hourly_rate)}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasAwardChange && <div style={{ fontSize: 10, color: "#065f46", marginTop: 3 }}>↑ from {emp.current_award ?? "—"}</div>}
            {!hasAwardChange && row.compliance.next_level && (() => {
              const sugRate = awardRates.find((r) => r.award_level === row.compliance.next_level)?.hourly_rate;
              return (
                <button
                  onClick={() => {
                    const s = row.compliance.next_level!;
                    onChange("proposed_award", s); onChange("pp_level", "");
                    onChange("change_type", "No Change"); onChange("change_input", "0");
                    onSave({ proposed_award: s, pp_level: "", change_type: "No Change", change_input: "0" });
                  }}
                  className="mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-semibold"
                  style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8" }}
                >
                  <span className="mt-px">↑</span>
                  <div style={{ textAlign: "left" }}>
                    <div>Suggest: {row.compliance.next_level}</div>
                    {sugRate != null && <div style={{ color: "#93c5fd", fontWeight: 400 }}>{formatRate(sugRate)}</div>}
                  </div>
                </button>
              );
            })()}
          </>
        ) : (
          hasAwardChange ? (
            <div>
              <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#065f46" }}>{row.proposed_award}</span>
              <div style={{ fontSize: 10, color: "#065f46", marginTop: 2 }}>↑ from {emp.current_award ?? "—"}</div>
            </div>
          ) : (
            <span style={{ fontSize: 12, color: "#94a3b8" }}>—</span>
          )
        )}
      </td>

      {/* PP Level */}
      <td className={`${td}`} style={{ minWidth: 200, opacity: effectiveAward ? 1 : 0.4 }}>
        {isEditing ? (
          <>
            <PPLevelPicker
              ppBands={ppBands}
              effectiveAward={effectiveAward}
              value={row.pp_level}
              locked={!effectiveAward}
              onSelect={(conv) => { onChange("pp_level", conv ?? ""); onSave({ pp_level: conv }); }}
            />
            {row.proposed_rate != null && (() => {
              const hasCeilingWarn = row.compliance.checks.some((c) => c.label === "PP band ceiling" && c.status === "warn");
              if (!hasCeilingWarn) return null;
              const filtered = filterPPOptionsForAward(ppBands, effectiveAward);
              const better = filtered.find((b) => b.convention !== row.pp_level && (b.band_max === null || b.band_max >= row.proposed_rate!));
              if (!better) return null;
              return (
                <button
                  onClick={() => { onChange("pp_level", better.convention); onSave({ pp_level: better.convention }); }}
                  className="mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-semibold"
                  style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#b45309" }}
                >
                  <span className="mt-px">↑</span>
                  <div style={{ textAlign: "left" }}>
                    <div>Switch to: {better.carlisle_label ?? better.convention}</div>
                    <div style={{ color: "#fbbf24", fontWeight: 400 }}>
                      {better.band_max != null ? `${formatRate(better.band_min!)}–${formatRate(better.band_max)}` : `${formatRate(better.band_min!)}+`}
                    </div>
                  </div>
                </button>
              );
            })()}
          </>
        ) : (
          row.pp_level ? (
            <span className="text-xs" style={{ color: "#334155" }}>{row.pp_level}</span>
          ) : (
            <span style={{ fontSize: 12, color: "#94a3b8" }}>—</span>
          )
        )}
      </td>

      {/* Current Rate */}
      <td className="px-3 py-3 text-right align-middle" style={{ minWidth: 95 }}>
        <span className="text-sm font-semibold" style={{ ...mono, color: "#334155" }}>
          {emp.current_rate != null ? formatRate(emp.current_rate) : "—"}
        </span>
        {row.compliance.award_minimum != null && (
          <div className="mt-0.5 text-[10px]" style={{ color: "#64748b" }}>min {formatRate(row.compliance.award_minimum)}</div>
        )}
      </td>

      {/* Change Type */}
      <td className="px-3 py-3 align-middle" style={{ minWidth: 145, opacity: hasPPSelected ? 1 : 0.4 }}>
        {isEditing ? (
          <Select
            value={row.change_type || NONE}
            onValueChange={(v) => {
              const val = v === NONE ? "" : v;
              const vl = val.toLowerCase();
              const ppBandMin = vl === "per admin pp" ? (ppBands.find((b) => b.convention === row.pp_level)?.band_min ?? null) : null;
              const newInput =
                vl === "cpi increase" ? String(cpiRate)
                : vl === "per admin pp" ? String(ppBandMin ?? emp.current_rate ?? "")
                : vl === "fixed rate"  ? String(emp.current_rate ?? "")
                : row.change_input;
              onChange("change_type", val);
              onChange("change_input", newInput);
              onSave({ change_type: val, change_input: newInput });
            }}
            disabled={!hasPPSelected}
          >
            <SelectTrigger className="h-7 w-full text-xs px-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE} className="text-xs italic" style={{ color: "var(--neutral-400)" }}>— select —</SelectItem>
              {CHANGE_TYPES.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs" style={{ color: row.change_type ? "#334155" : "#94a3b8" }}>
            {row.change_type || "—"}
          </span>
        )}
      </td>

      {/* Input */}
      <td className="px-3 py-3 text-right align-middle" style={{ minWidth: 84, opacity: hasPPSelected ? 1 : 0.4 }}>
        {isEditing ? (
          kind === "none" ? (
            <span style={{ color: "var(--neutral-300)" }}>—</span>
          ) : (
            <div className="flex items-center justify-end gap-0.5">
              {kind === "dollars" && <span className="text-[11px]" style={{ color: "var(--neutral-400)" }}>$</span>}
              <input
                type="number" step="0.01" min="0"
                value={row.change_input}
                readOnly={cpiLocked || !hasPPSelected}
                onChange={(e) => !cpiLocked && hasPPSelected && onChange("change_input", e.target.value)}
                onBlur={(e) => { if (!cpiLocked && hasPPSelected) onSave({ change_input: e.target.value }); }}
                className="w-16 rounded border px-1.5 py-1 text-right text-xs tabular-nums focus:outline-none"
                style={{ borderColor: "var(--neutral-200)", background: cpiLocked ? "var(--neutral-50)" : "white", color: "var(--neutral-800)", ...mono }}
              />
              {kind === "percent" && <span className="text-[11px]" style={{ color: "var(--neutral-400)" }}>%</span>}
            </div>
          )
        ) : (
          <span className="text-xs tabular-nums" style={{ ...mono, color: row.change_input && row.change_input !== "0" ? "#334155" : "#94a3b8" }}>
            {kind === "percent" ? `${row.change_input}%` : kind === "dollars" ? formatRate(parseFloat(row.change_input) || 0) : "—"}
          </span>
        )}
      </td>

      {/* Proposed Rate */}
      <td className="px-3 py-3 text-right align-middle" style={{ minWidth: 110 }}>
        <div style={{ ...mono, fontWeight: 800, fontSize: "0.9375rem", color: rateHasFail ? "#dc2626" : row.proposed_rate != null ? "#0f172a" : "#cbd5e1" }}>
          {row.proposed_rate != null ? formatRate(row.proposed_rate) : "—"}
        </div>
        {row.proposed_rate && emp.current_rate && (() => {
          const pct = ((row.proposed_rate - emp.current_rate) / emp.current_rate) * 100;
          const up = pct >= 0;
          return (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 2, background: up ? "#dcfce7" : "#fee2e2", color: up ? "#166534" : "#dc2626", borderRadius: 4, padding: "1px 5px", fontSize: 10, fontWeight: 700, marginTop: 2 }}>
              {up ? "↑" : "↓"}{Math.abs(pct).toFixed(1)}%
            </div>
          );
        })()}
      </td>

      {/* Letter */}
      <td className="px-3 py-3 text-center align-middle" style={{ minWidth: 80 }}>
        {isEditing ? (
          <div className="flex flex-col items-center gap-1">
            <Select
              value={row.letter_type || NONE}
              onValueChange={(v) => {
                const val = v === NONE ? "" : v;
                onChange("letter_type", val);
                onSave({ letter_type: val || null });
              }}
            >
              <SelectTrigger className="h-7 w-16 text-xs px-2 mx-auto"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE} className="text-xs italic" style={{ color: "var(--neutral-400)" }}>—</SelectItem>
                {LETTER_TYPES.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
              </SelectContent>
            </Select>
            {row.letter_type && row.compliance.overall === "ok" && row.proposed_rate && (
              <button
                onClick={() => downloadDraftLetter(emp.id).catch((err) => alert(err instanceof Error ? err.message : String(err)))}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold"
                style={{ background: "#f0f9ff", border: "1px solid #bae6fd", color: "#0369a1" }}
              >
                📄 Draft
              </button>
            )}
          </div>
        ) : (
          row.letter_type ? (
            <div className="flex flex-col items-center gap-1">
              <span className="inline-flex items-center justify-center rounded-md text-xs font-bold"
                style={{ width: 28, height: 28, background: "#f1f5f9", border: "1px solid #cbd5e1", color: "#334155" }}>
                {row.letter_type}
              </span>
              {["A", "B", "C"].includes(row.letter_type) && row.compliance.overall === "ok" && row.proposed_rate && (
                <button
                  onClick={() => downloadDraftLetter(emp.id).catch((err) => alert(err instanceof Error ? err.message : String(err)))}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold"
                  style={{ background: "#f0f9ff", border: "1px solid #bae6fd", color: "#0369a1" }}
                >
                  📄 Draft
                </button>
              )}
            </div>
          ) : (
            <span style={{ color: "var(--neutral-300)", fontSize: 12 }}>—</span>
          )
        )}
      </td>

      {/* Notes */}
      <td className="px-3 py-3 align-middle" style={{ minWidth: 140 }}>
        {isEditing ? (
          <input
            type="text"
            value={row.notes}
            onChange={(e) => onChange("notes", e.target.value)}
            onBlur={(e) => onSave({ notes: e.target.value })}
            placeholder="Add notes…"
            className="w-full rounded border px-2 py-1 text-xs focus:outline-none"
            style={{ borderColor: "var(--neutral-200)", color: "var(--neutral-700)", background: "white" }}
          />
        ) : (
          row.notes ? (
            <span className="text-[11px] leading-snug" style={{ color: "#475569" }}>{row.notes}</span>
          ) : (
            <span style={{ fontSize: 12, color: "var(--neutral-300)" }}>—</span>
          )
        )}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Compliance panel — all checks at once, no toggle
// ─────────────────────────────────────────────────────────────────────────────
function CompliancePanel({
  emp, compliance, locked, onUpdate,
}: {
  emp: EmployeeWithCompliance;
  compliance: EmployeeWithCompliance["compliance"];
  locked: boolean;
  onUpdate: (updated: EmployeeWithCompliance) => void;
}) {
  const ORDER: Record<string, number> = { fail: 0, warn: 1, suppressed: 2, ok: 3 };
  const sorted = [...compliance.checks].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "#0f172a" }}>Compliance — MA000027</span>
        {compliance.award_minimum != null && (
          <span className="text-xs" style={{ color: "#64748b" }}>
            Award floor: <strong style={{ color: "#0f172a" }}>{formatRate(compliance.award_minimum)}</strong>
          </span>
        )}
        {compliance.band_min != null && compliance.band_max != null && (
          <span className="text-xs" style={{ color: "#64748b" }}>
            PP band: <strong style={{ color: "#0f172a" }}>{formatRate(compliance.band_min)} – {formatRate(compliance.band_max)}</strong>
          </span>
        )}
      </div>
      <div className="space-y-2">
        {sorted.map((check) => (
          <CheckCard key={check.label} check={check}
            suppInfo={compliance.suppressions.find((s) => s.check_label === check.label)}
            empId={emp.id} locked={locked} onUpdate={onUpdate}
          />
        ))}
      </div>
    </div>
  );
}

function CheckCard({
  check, suppInfo, empId, locked, onUpdate,
}: {
  check: CheckResult;
  suppInfo: SuppressionInfo | undefined;
  empId: number;
  locked: boolean;
  onUpdate: (updated: EmployeeWithCompliance) => void;
}) {
  const [working, setWorking]       = useState(false);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason]         = useState("");
  const [apiError, setApiError]     = useState<string | null>(null);

  const isSuppressed  = check.status === "suppressed";
  const canSuppress   = check.status === "warn" && !locked &&
    !["Pay progression", "PP band minimum"].includes(check.label);
  const canUnsuppress = isSuppressed && !locked;

  const statusStyles = {
    ok:         { border: "var(--green-100)",   bg: "var(--green-50)",   label: "var(--green-700)",   detail: "var(--green-600)"   },
    warn:       { border: "var(--amber-200)",   bg: "var(--amber-50)",   label: "var(--amber-800)",   detail: "var(--amber-700)"   },
    fail:       { border: "var(--red-100)",     bg: "var(--red-50)",     label: "var(--red-700)",     detail: "var(--red-600)"     },
    suppressed: { border: "var(--neutral-200)", bg: "var(--neutral-50)", label: "var(--neutral-500)", detail: "var(--neutral-400)" },
  }[check.status];

  async function handleSuppress() {
    setWorking(true); setApiError(null);
    try {
      const updated = await suppressCheck(empId, check.label, reason || undefined);
      onUpdate(updated); setShowReason(false); setReason("");
    } catch (err) { setApiError(err instanceof ApiError ? err.message : "Failed"); }
    finally { setWorking(false); }
  }
  async function handleUnsuppress() {
    setWorking(true); setApiError(null);
    try { const updated = await unsuppressCheck(empId, check.label); onUpdate(updated); }
    catch (err) { setApiError(err instanceof ApiError ? err.message : "Failed"); }
    finally { setWorking(false); }
  }

  if (check.status === "ok" || check.status === "suppressed") {
    return (
      <div className="rounded-md px-3 py-2" style={{ background: statusStyles.bg, border: `1px solid ${statusStyles.border}` }}>
        <div className="flex items-center gap-1.5">
          <StatusIcon status={check.status} />
          <span className="text-xs font-semibold" style={{ color: statusStyles.label }}>{check.label}</span>
        </div>
        <div className="mt-0.5 text-[11px] leading-snug" style={{ color: statusStyles.detail }}>{check.detail}</div>
        {isSuppressed && suppInfo && (
          <div className="mt-1 text-[11px]" style={{ color: "#64748b" }}>
            Noted by {suppInfo.suppressed_by_name} on {new Date(suppInfo.suppressed_at).toLocaleDateString("en-AU")}
            {suppInfo.reason && ` — "${suppInfo.reason}"`}
          </div>
        )}
        {canUnsuppress && (
          <button onClick={handleUnsuppress} disabled={working} className="mt-1 text-[11px] underline" style={{ color: "#64748b" }}>
            {working ? "Undoing…" : "Undo"}
          </button>
        )}
      </div>
    );
  }

  const accent = check.status === "fail"
    ? { color: "#dc2626", bg: "#fef2f2", border: "#fecaca" }
    : { color: "#d97706", bg: "#fffbeb", border: "#fde68a" };

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${accent.border}`, background: accent.bg }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${accent.border}` }}>
        <StatusIcon status={check.status} />
        <span className="text-xs font-bold flex-1" style={{ color: accent.color }}>{check.label}</span>
        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: accent.color, color: "white" }}>{check.status}</span>
      </div>
      <div className="px-3 py-2.5 space-y-2">
        <p className="text-xs leading-snug" style={{ color: accent.color }}>{check.detail}</p>
        {check.recommendation && (
          <div className="rounded px-2.5 py-1.5 text-xs leading-snug" style={{ background: "white", border: `1px solid ${accent.border}`, color: "#374151" }}>
            <span className="font-semibold" style={{ color: "#0f172a" }}>Fix: </span>{check.recommendation}
          </div>
        )}
        {apiError && <p className="text-[11px]" style={{ color: "#dc2626" }}>{apiError}</p>}
        {canSuppress && !showReason && (
          <button onClick={() => setShowReason(true)} disabled={working}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            style={{ background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" }}>
            <span>✓</span> Mark as noted
          </button>
        )}
        {canSuppress && showReason && (
          <div className="space-y-1.5">
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSuppress(); if (e.key === "Escape") { setShowReason(false); setReason(""); } }}
              placeholder="Reason for noting (optional)" autoFocus
              className="w-full rounded-md border px-2.5 py-1.5 text-xs focus:outline-none"
              style={{ borderColor: "#cbd5e1", background: "white", color: "#374151" }}
            />
            <div className="flex gap-2">
              <button onClick={handleSuppress} disabled={working}
                className="rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                style={{ background: "#0f172a", color: "white" }}>
                {working ? "Saving…" : "Confirm"}
              </button>
              <button onClick={() => { setShowReason(false); setReason(""); }} className="text-xs" style={{ color: "#64748b" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Presentational helpers
// ─────────────────────────────────────────────────────────────────────────────
function OverallBadge({ overall, checks, isExpanded }: { overall: string; checks: CheckResult[]; isExpanded: boolean }) {
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const supp  = checks.filter((c) => c.status === "suppressed").length;
  const s = ({ fail: { bg: "var(--red-100)", color: "var(--red-700)" }, warn: { bg: "var(--amber-100)", color: "var(--amber-700)" }, ok: { bg: "var(--green-100)", color: "var(--green-700)" } } as Record<string,{bg:string;color:string}>)[overall] ?? { bg: "var(--neutral-100)", color: "var(--neutral-600)" };
  const label = overall === "fail" ? `✗ ${fails} issue${fails !== 1 ? "s" : ""}` : overall === "warn" ? `⚠ ${warns} warn${warns !== 1 ? "s" : ""}` : supp > 0 ? `✓ OK · ${supp} noted` : "✓ OK";
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap" style={{ background: s.bg, color: s.color }}>
      {label}
      <svg viewBox="0 0 16 16" fill="currentColor" className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}>
        <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
      </svg>
    </span>
  );
}

function StatusIcon({ status }: { status: CheckResult["status"] }) {
  const m = { ok: { color: "var(--green-600)", icon: "✓" }, warn: { color: "var(--amber-600)", icon: "⚠" }, fail: { color: "var(--red-600)", icon: "✗" }, suppressed: { color: "var(--neutral-400)", icon: "–" } };
  const { color, icon } = m[status];
  return <span className="mt-0.5 shrink-0 text-xs" aria-label={status} style={{ color }}>{icon}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const s: Record<string, { bg: string; color: string }> = {
    pending: { bg: "var(--amber-100)", color: "var(--amber-700)" },
    approved: { bg: "var(--green-100)", color: "var(--green-700)" },
    changes_requested: { bg: "var(--red-100)", color: "var(--red-700)" },
  };
  const labels: Record<string, string> = { pending: "Pending approval", approved: "Approved", changes_requested: "Changes requested" };
  const st = s[status] ?? { bg: "var(--neutral-100)", color: "var(--neutral-600)" };
  return <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: st.bg, color: st.color }}>{labels[status] ?? status}</span>;
}

function StatCell({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="px-5 py-3" style={{ background: "white" }}>
      <div className="text-sm font-semibold tabular-nums" style={{ color: positive ? "var(--amber-700)" : "var(--neutral-800)", fontFamily: label !== "Staff" ? "var(--font-mono)" : undefined, fontSize: label !== "Staff" ? "0.8125rem" : undefined }}>
        {value}
      </div>
      <div className="mt-0.5 text-xs" style={{ color: "var(--neutral-500)" }}>{label}</div>
    </div>
  );
}

function KpiCard({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "amber" | "red" | "green" }) {
  const c: Record<string, string> = { neutral: "var(--neutral-900)", amber: "var(--amber-600)", red: "var(--red-600)", green: "var(--green-600)" };
  return (
    <div className="kpi-card">
      <div className="text-2xl font-bold tabular-nums" style={{ color: c[tone], fontFamily: "var(--font-mono)" }}>{value}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--neutral-500)" }}>{label}</div>
    </div>
  );
}
