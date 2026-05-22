"use client";

import { useRouter } from "next/navigation";
import React, { useCallback, useState, useTransition } from "react";

import { ApiError } from "@/lib/api";
import { decideSite, type ApprovalDetail } from "@/lib/approvals";
import {
  downloadDraftLetter,
  getSiteEmployees,
  patchEmployee,
  suppressCheck,
  unsuppressCheck,
  type CheckResult,
  type EmployeeWithCompliance,
  type SuppressionInfo,
} from "@/lib/review";
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
const LETTER_TYPES = ["A", "B", "C"];

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
  letter_type: string;
  proposed_rate: number | null;
  compliance: EmployeeWithCompliance["compliance"];
  saveState: "idle" | "saving" | "saved" | "error";
  error: string | null;
}

function initEmpRow(e: EmployeeWithCompliance, cpiRate: number): EmpRowState {
  return {
    change_type:   e.change_type  ?? "CPI Increase",
    change_input:  e.change_input != null ? String(e.change_input) : String(cpiRate),
    letter_type:   e.letter_type  ?? "",
    proposed_rate: e.proposed_rate ?? null,
    compliance:    e.compliance,
    saveState: "idle",
    error: null,
  };
}

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

      {/* Empty state */}
      {approvals.length === 0 && (
        <div className="rounded-xl p-12 text-center" style={{ background: "white", border: "1px solid var(--border)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--neutral-700)" }}>Nothing submitted yet</p>
          <p className="mt-1 text-xs" style={{ color: "var(--neutral-500)" }}>
            Sites will appear here once regional managers submit them.
          </p>
        </div>
      )}

      {/* Pending */}
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

      {/* Decided */}
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
//  Approval card — site summary + inline employee editor + decision panel
// ─────────────────────────────────────────────────────────────────────────────
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
  const [expanded, setExpanded]         = useState(false);
  const [employees, setEmployees]       = useState<EmployeeWithCompliance[] | null>(null);
  const [rows, setRows]                 = useState<Record<number, EmpRowState>>({});
  const [expandedEmpId, setExpandedEmpId] = useState<number | null>(null);
  const [loading, setLoading]           = useState(false);
  const [loadErr, setLoadErr]           = useState<string | null>(null);

  const payrollDelta = a.payroll_proposed - a.payroll_current;

  async function handleExpand() {
    if (!expanded && !employees) {
      setLoading(true);
      setLoadErr(null);
      try {
        const data = await getSiteEmployees(cycleId, a.site);
        const active = data.filter((e) => !e.is_departed);
        setEmployees(active);
        setRows(Object.fromEntries(active.map((e) => [e.id, initEmpRow(e, cpiRate)])));
      } catch (err) {
        setLoadErr(err instanceof ApiError ? err.message : "Failed to load employees");
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  }

  // Called when compliance suppress/unsuppress updates a record
  const handleEmpUpdated = useCallback((updated: EmployeeWithCompliance) => {
    setEmployees((prev) => prev ? prev.map((e) => e.id === updated.id ? updated : e) : prev);
    setRows((prev) => ({
      ...prev,
      [updated.id]: {
        ...prev[updated.id],
        change_type:   updated.change_type  ?? "CPI Increase",
        change_input:  updated.change_input != null ? String(updated.change_input) : String(cpiRate),
        letter_type:   updated.letter_type  ?? "",
        proposed_rate: updated.proposed_rate ?? null,
        compliance:    updated.compliance,
      },
    }));
  }, [cpiRate]);

  const saveRow = useCallback(
    async (emp: EmployeeWithCompliance, patch: { change_type?: string; change_input?: string; letter_type?: string }) => {
      setRows((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], saveState: "saving", error: null } }));
      try {
        const row = rows[emp.id];
        const changeType  = patch.change_type  ?? row?.change_type  ?? "CPI Increase";
        const changeInput = patch.change_input  ?? row?.change_input ?? String(cpiRate);
        const letterType  = patch.letter_type   ?? row?.letter_type  ?? "";

        const updated = await patchEmployee(emp.id, {
          change_type:  changeType  || null,
          change_input: inputKind(changeType) === "none" ? null : (parseFloat(changeInput) || null),
          letter_type:  letterType  || null,
        });

        setRows((prev) => ({
          ...prev,
          [emp.id]: {
            ...prev[emp.id],
            change_type:   updated.change_type  ?? "CPI Increase",
            change_input:  updated.change_input != null ? String(updated.change_input) : String(cpiRate),
            letter_type:   updated.letter_type  ?? "",
            proposed_rate: updated.proposed_rate ?? null,
            compliance:    updated.compliance,
            saveState: "saved",
            error: null,
          },
        }));
        setEmployees((prev) => prev ? prev.map((e) => e.id === emp.id ? { ...e, proposed_rate: updated.proposed_rate } : e) : prev);
        setTimeout(() => setRows((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], saveState: "idle" } })), 1500);
      } catch (err) {
        setRows((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], saveState: "error", error: err instanceof ApiError ? err.message : "Save failed" } }));
      }
    },
    [rows, cpiRate],
  );

  // ── Live issue counts (updates as SM edits — no refresh needed) ────────────
  // When employees are loaded we count directly from rows; otherwise fall back
  // to the stale summary from the server.
  let liveFailCount: number;
  let liveWarnCount: number;
  if (employees !== null) {
    liveFailCount = employees.reduce((n, emp) => {
      const row = rows[emp.id];
      return n + (row?.compliance.checks.some((c) => c.status === "fail") ? 1 : 0);
    }, 0);
    liveWarnCount = employees.reduce((n, emp) => {
      const row = rows[emp.id];
      return n + (row?.compliance.checks.some((c) => c.status === "warn") ? 1 : 0);
    }, 0);
  } else {
    liveFailCount = a.hard_issues;
    liveWarnCount = a.warn_count;
  }

  // ── Approval readiness gate ────────────────────────────────────────────────
  // Computed from live `rows` state so any edit immediately updates the gate.
  // If employees haven't been loaded yet we fall back to the stale hard_issues
  // count from the ApprovalDetail summary.
  const approvalBlockers: string[] = [];
  if (employees === null) {
    // Not yet expanded — use server-computed counts as gate
    if (a.hard_issues > 0)
      approvalBlockers.push(`${a.hard_issues} hard compliance failure${a.hard_issues !== 1 ? "s" : ""}`);
    if (a.warn_count > 0)
      approvalBlockers.push(`${a.warn_count} unresolved warning${a.warn_count !== 1 ? "s" : ""} — expand employees to mark as noted`);
  } else {
    // Use the already-computed live counts; also check rate + letter completeness
    let missingRate = 0, missingLetter = 0;
    for (const emp of employees) {
      const row = rows[emp.id];
      if (!row) continue;
      if (!row.proposed_rate) missingRate++;
      if (!row.letter_type)   missingLetter++;
    }
    if (liveFailCount > 0)   approvalBlockers.push(`${liveFailCount} employee${liveFailCount !== 1 ? "s" : ""} with hard compliance failures`);
    if (liveWarnCount > 0)   approvalBlockers.push(`${liveWarnCount} unresolved warning${liveWarnCount !== 1 ? "s" : ""} — mark as noted or fix first`);
    if (missingRate > 0)     approvalBlockers.push(`${missingRate} missing proposed rate`);
    if (missingLetter > 0)   approvalBlockers.push(`${missingLetter} missing letter type`);
  }
  const approvalReady = approvalBlockers.length === 0;

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

      {/* ── Inline employee table ─────────────────────────────────────────── */}
      {expanded && (
        <div style={{ borderTop: "1px solid var(--neutral-100)" }}>
          {loadErr && <div className="px-5 py-4 text-sm" style={{ color: "var(--red-600)" }}>{loadErr}</div>}

          {employees && employees.length > 0 && (
            <div className="overflow-x-auto" style={{ maxHeight: "480px", overflowY: "auto" }}>
              <table className="min-w-full">
                <thead>
                  <tr>
                    {[
                      { label: "Emp #",         align: "left"   },
                      { label: "Name",          align: "left"   },
                      { label: "Status",        align: "center" },
                      { label: "FY26 Award",    align: "left"   },
                      { label: "Current Rate",  align: "right"  },
                      { label: "Change Type",   align: "left"   },
                      { label: "Input",         align: "right"  },
                      { label: "Proposed Rate", align: "right"  },
                      { label: "Letter",        align: "center" },
                    ].map(({ label, align }) => (
                      <th key={label}
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
                    const isEmpExpanded = expandedEmpId === emp.id;
                    return (
                      <React.Fragment key={emp.id}>
                        <ApprovalEmpRow
                          emp={emp}
                          row={row}
                          cpiRate={cpiRate}
                          isExpanded={isEmpExpanded}
                          onToggleExpand={() => setExpandedEmpId((prev) => prev === emp.id ? null : emp.id)}
                          onChange={(field, value) => setRows((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], [field]: value } }))}
                          onSave={(patch) => saveRow(emp, patch)}
                        />
                        {isEmpExpanded && (
                          <tr>
                            <td colSpan={9} className="px-5 py-4"
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

      {/* ── Decision panel ─────────────────────────────────────────────────── */}
      <div className="px-5 py-4" style={{ borderTop: "1px solid var(--neutral-100)" }}>
        <div className="space-y-3">

          {/* Blockers list — shown when approval is gated */}
          {!approvalReady && (
            <div className="rounded-lg px-4 py-3 space-y-1.5"
              style={{ background: "#fef2f2", border: "1px solid #fecaca" }}>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#dc2626" }}>
                Cannot approve — resolve before signing off:
              </p>
              {approvalBlockers.map((b, i) => (
                <div key={i} className="flex items-start gap-2 text-xs" style={{ color: "#b91c1c" }}>
                  <span className="mt-px shrink-0">✗</span>
                  <span>{b}</span>
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
                <span
                  className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                  style={{ background: "var(--red-500)", color: "white" }}
                >
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
//  Inline employee row (editable)
// ─────────────────────────────────────────────────────────────────────────────
function ApprovalEmpRow({
  emp, row, cpiRate, isExpanded, onToggleExpand, onChange, onSave,
}: {
  emp: EmployeeWithCompliance;
  row: EmpRowState;
  cpiRate: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onChange: (field: keyof EmpRowState, value: string) => void;
  onSave: (patch: { change_type?: string; change_input?: string; letter_type?: string }) => void;
}) {
  const overall      = row.compliance.overall;
  const rateHasFail  = row.compliance.checks.some((c) => c.label === "Award floor" && c.status === "fail");
  const kind         = inputKind(row.change_type);
  const cpiLocked    = isCpiLocked(row.change_type);
  const mono         = { fontFamily: "var(--font-mono)" };

  const rowBg     = overall === "fail" ? "var(--red-50)" : overall === "warn" ? "#fffbeb" : "white";
  const rowAccent = overall === "fail" ? "var(--red-500)" : overall === "warn" ? "var(--amber-400)" : "transparent";

  return (
    <tr style={{ borderBottom: "1px solid var(--neutral-100)", background: rowBg, borderLeft: `3px solid ${rowAccent}` }}>
      {/* Emp # */}
      <td className="px-3 py-3 pl-4 align-middle" style={{ minWidth: 70 }}>
        <span className="text-xs tabular-nums" style={{ color: "#64748b", ...mono }}>#{emp.emp_num}</span>
      </td>

      {/* Name */}
      <td className="px-3 py-3 align-middle" style={{ minWidth: 130, whiteSpace: "nowrap" }}>
        <div className="text-sm font-semibold" style={{ color: "#0f172a" }}>{emp.first_name} {emp.last_name}</div>
      </td>

      {/* Status — clickable badge that opens compliance panel */}
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

      {/* FY26 Award */}
      <td className="px-3 py-3 align-middle" style={{ minWidth: 200 }}>
        <div className="text-sm font-semibold" style={{ color: "#0f172a" }}>
          {emp.fy26_award ?? <span style={{ color: "#cbd5e1" }}>—</span>}
        </div>
        {emp.proposed_award && (
          <div className="mt-0.5 text-[11px]" style={{ color: "#1d4ed8" }}>→ {emp.proposed_award}</div>
        )}
        {row.compliance.award_minimum != null && (
          <div className="mt-0.5 text-[11px]" style={{ color: "#64748b" }}>min {formatRate(row.compliance.award_minimum)}</div>
        )}
      </td>

      {/* Current rate */}
      <td className="px-3 py-3 text-right align-middle" style={{ minWidth: 95 }}>
        <span className="text-sm font-semibold" style={{ ...mono, color: "#334155" }}>
          {emp.current_rate != null ? formatRate(emp.current_rate) : "—"}
        </span>
      </td>

      {/* Change type */}
      <td className="px-3 py-3 align-middle" style={{ minWidth: 145 }}>
        <Select value={row.change_type || NONE}
          onValueChange={(v) => {
            const val = v === NONE ? "" : v;
            const newInput = val.toLowerCase() === "cpi increase" ? String(cpiRate) : row.change_input;
            onChange("change_type", val);
            onChange("change_input", newInput);
            onSave({ change_type: val, change_input: newInput });
          }}
        >
          <SelectTrigger className="h-7 w-full text-xs px-2"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE} className="text-xs italic" style={{ color: "var(--neutral-400)" }}>— select —</SelectItem>
            {CHANGE_TYPES.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </td>

      {/* Input */}
      <td className="px-3 py-3 text-right align-middle" style={{ minWidth: 84 }}>
        {kind === "none" ? (
          <span style={{ color: "var(--neutral-300)" }}>—</span>
        ) : (
          <div className="flex items-center justify-end gap-0.5">
            {kind === "dollars" && <span className="text-[11px]" style={{ color: "var(--neutral-400)" }}>$</span>}
            <input type="number" step="0.01" min="0"
              value={row.change_input}
              readOnly={cpiLocked}
              onChange={(e) => !cpiLocked && onChange("change_input", e.target.value)}
              onBlur={(e) => { if (!cpiLocked) onSave({ change_input: e.target.value }); }}
              className="w-16 rounded border px-1.5 py-1 text-right text-xs tabular-nums focus:outline-none"
              style={{ borderColor: "var(--neutral-200)", background: cpiLocked ? "var(--neutral-50)" : "white", color: "var(--neutral-800)", ...mono, cursor: cpiLocked ? "default" : "text" }}
            />
            {kind === "percent" && <span className="text-[11px]" style={{ color: "var(--neutral-400)" }}>%</span>}
          </div>
        )}
      </td>

      {/* Proposed rate */}
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
      <td className="px-3 py-3 text-center align-middle">
        <Select value={row.letter_type || NONE}
          onValueChange={(v) => { const val = v === NONE ? "" : v; onChange("letter_type", val); onSave({ letter_type: val }); }}
        >
          <SelectTrigger className="h-7 w-16 text-xs px-2 mx-auto"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE} className="text-xs italic" style={{ color: "var(--neutral-400)" }}>—</SelectItem>
            {LETTER_TYPES.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
          </SelectContent>
        </Select>
        {row.letter_type && ["A", "B", "C"].includes(row.letter_type) &&
         row.compliance.overall === "ok" && row.proposed_rate && (
          <button
            onClick={() =>
              downloadDraftLetter(emp.id).catch((err) =>
                alert(err instanceof Error ? err.message : String(err)),
              )
            }
            className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold"
            style={{ background: "#f0f9ff", border: "1px solid #bae6fd", color: "#0369a1" }}
          >
            📄 Draft
          </button>
        )}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Compliance panel (same logic as site-review-client)
// ─────────────────────────────────────────────────────────────────────────────
function CompliancePanel({
  emp, compliance, locked, onUpdate,
}: {
  emp: EmployeeWithCompliance;
  compliance: EmployeeWithCompliance["compliance"];
  locked: boolean;
  onUpdate: (updated: EmployeeWithCompliance) => void;
}) {
  const [showPassing, setShowPassing] = useState(false);
  const ORDER: Record<string, number> = { fail: 0, warn: 1, suppressed: 2, ok: 3 };
  const sorted = [...compliance.checks].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));
  const actionChecks = sorted.filter((c) => c.status === "fail" || c.status === "warn");
  const passChecks   = sorted.filter((c) => c.status === "ok"   || c.status === "suppressed");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "#0f172a" }}>
          Compliance — MA000027
        </span>
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

      {actionChecks.length > 0 && (
        <div className="space-y-2 mb-3">
          {actionChecks.map((check) => (
            <CheckCard key={check.label} check={check}
              suppInfo={compliance.suppressions.find((s) => s.check_label === check.label)}
              empId={emp.id} locked={locked} onUpdate={onUpdate}
            />
          ))}
        </div>
      )}

      {passChecks.length > 0 && (
        <div>
          <button onClick={() => setShowPassing((v) => !v)} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "#64748b" }}>
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold" style={{ background: "#dcfce7", color: "#166534" }}>
              {passChecks.length}
            </span>
            {showPassing ? "Hide" : "Show"} passing checks
            <span style={{ fontSize: 10 }}>{showPassing ? "▲" : "▼"}</span>
          </button>
          {showPassing && (
            <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {passChecks.map((check) => (
                <CheckCard key={check.label} check={check}
                  suppInfo={compliance.suppressions.find((s) => s.check_label === check.label)}
                  empId={emp.id} locked={locked} onUpdate={onUpdate}
                />
              ))}
            </div>
          )}
        </div>
      )}
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
  const canSuppress   = check.status === "warn" && !locked;
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

  const isCompact = check.status === "ok" || check.status === "suppressed";

  if (isCompact) {
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

  const accentColor  = check.status === "fail" ? "#dc2626" : "#d97706";
  const accentBg     = check.status === "fail" ? "#fef2f2" : "#fffbeb";
  const accentBorder = check.status === "fail" ? "#fecaca" : "#fde68a";

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${accentBorder}`, background: accentBg }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${accentBorder}` }}>
        <StatusIcon status={check.status} />
        <span className="text-xs font-bold flex-1" style={{ color: accentColor }}>{check.label}</span>
        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: accentColor, color: "white" }}>
          {check.status}
        </span>
      </div>
      <div className="px-3 py-2.5 space-y-2">
        <p className="text-xs leading-snug" style={{ color: accentColor }}>{check.detail}</p>
        {check.recommendation && (
          <div className="rounded px-2.5 py-1.5 text-xs leading-snug" style={{ background: "white", border: `1px solid ${accentBorder}`, color: "#374151" }}>
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
              <button onClick={() => { setShowReason(false); setReason(""); }} className="text-xs" style={{ color: "#64748b" }}>
                Cancel
              </button>
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
  const fails      = checks.filter((c) => c.status === "fail").length;
  const warns      = checks.filter((c) => c.status === "warn").length;
  const suppressed = checks.filter((c) => c.status === "suppressed").length;
  const styles = {
    fail: { bg: "var(--red-100)",   color: "var(--red-700)"   },
    warn: { bg: "var(--amber-100)", color: "var(--amber-700)" },
    ok:   { bg: "var(--green-100)", color: "var(--green-700)" },
  }[overall as "fail" | "warn" | "ok"] ?? { bg: "var(--neutral-100)", color: "var(--neutral-600)" };
  const label =
    overall === "fail" ? `✗ ${fails} issue${fails !== 1 ? "s" : ""}`
    : overall === "warn" ? `⚠ ${warns} warn${warns !== 1 ? "s" : ""}`
    : suppressed > 0 ? `✓ OK · ${suppressed} noted`
    : "✓ OK";
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
      style={{ background: styles.bg, color: styles.color }}>
      {label}
      <svg viewBox="0 0 16 16" fill="currentColor" className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}>
        <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
      </svg>
    </span>
  );
}

function StatusIcon({ status }: { status: CheckResult["status"] }) {
  const map = { ok: { color: "var(--green-600)", icon: "✓" }, warn: { color: "var(--amber-600)", icon: "⚠" }, fail: { color: "var(--red-600)", icon: "✗" }, suppressed: { color: "var(--neutral-400)", icon: "–" } };
  const { color, icon } = map[status];
  return <span className="mt-0.5 shrink-0 text-xs" aria-label={status} style={{ color }}>{icon}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    pending:           { bg: "var(--amber-100)",  color: "var(--amber-700)" },
    approved:          { bg: "var(--green-100)",  color: "var(--green-700)" },
    changes_requested: { bg: "var(--red-100)",    color: "var(--red-700)"   },
  };
  const labels: Record<string, string> = {
    pending: "Pending approval", approved: "Approved", changes_requested: "Changes requested",
  };
  const s = styles[status] ?? { bg: "var(--neutral-100)", color: "var(--neutral-600)" };
  return (
    <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: s.bg, color: s.color }}>
      {labels[status] ?? status}
    </span>
  );
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
  const colorMap: Record<string, string> = { neutral: "var(--neutral-900)", amber: "var(--amber-600)", red: "var(--red-600)", green: "var(--green-600)" };
  return (
    <div className="kpi-card">
      <div className="text-2xl font-bold tabular-nums" style={{ color: colorMap[tone], fontFamily: "var(--font-mono)" }}>{value}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--neutral-500)" }}>{label}</div>
    </div>
  );
}
