"use client";

import { useRouter } from "next/navigation";
import React, { useCallback, useMemo, useState, useTransition } from "react";

import { ApiError } from "@/lib/api";
import {
  bulkAssignLetters,
  bulkSuggest,
  downloadDraftLetter,
  downloadDraftLettersZip,
  getSiteEmployees,
  patchEmployee,
  submitSite,
  suppressCheck,
  unsuppressCheck,
  type CheckResult,
  type EmployeePatch,
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

// Sentinel for "no selection" (Radix Select doesn't handle empty string)
const NONE = "__none__";

const CHANGE_TYPES = [
  "CPI Increase",
  "% Increase",
  "Fixed Rate",
  "Per Admin PP",
  "No Change",
];

const LETTER_TYPES = ["A", "B", "C"];

// Whether the change type takes a % input, $ input, or no input
function inputKind(ct: string): "percent" | "dollars" | "none" {
  const t = ct.toLowerCase();
  if (t === "cpi increase") return "percent";   // locked to cycle CPI
  if (t === "% increase")   return "percent";   // user-editable %
  if (t === "fixed rate" || t === "per admin pp") return "dollars";
  return "none"; // No Change
}

function isCpiLocked(ct: string) {
  return ct.toLowerCase() === "cpi increase";
}

// ── Types ────────────────────────────────────────────────────────────────────
type SaveState = "idle" | "saving" | "saved" | "error";

interface RowState {
  change_type: string;
  change_input: string;       // raw string for the input field
  proposed_award: string | null;  // accepted next-level; null = not accepted
  letter_type: string;
  notes: string;
  proposed_rate: number | null;  // display-only; updated from server response
  saveState: SaveState;
  error: string | null;
  compliance: EmployeeWithCompliance["compliance"];
}

function initRow(e: EmployeeWithCompliance, cpiRate: number): RowState {
  return {
    change_type: e.change_type ?? "CPI Increase",
    change_input:
      e.change_input != null
        ? String(e.change_input)
        : String(cpiRate),
    proposed_award: e.proposed_award ?? null,
    letter_type: e.letter_type ?? "",
    notes: e.notes ?? "",
    proposed_rate: e.proposed_rate ?? null,
    saveState: "idle",
    error: null,
    compliance: e.compliance,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
export function SiteReviewClient({
  cycleId,
  site,
  initialEmployees,
  cpiRate,
  approvalStatus = "not_submitted",
}: {
  cycleId: number;
  site: string;
  initialEmployees: EmployeeWithCompliance[];
  cpiRate: number;
  approvalStatus?: string;
}) {
  const locked = approvalStatus === "pending" || approvalStatus === "approved";
  const router = useRouter();
  const [employees, setEmployees] = useState<EmployeeWithCompliance[]>(
    initialEmployees,
  );
  const [rows, setRows] = useState<Record<number, RowState>>(
    () =>
      Object.fromEntries(
        initialEmployees.map((e) => [e.id, initRow(e, cpiRate)]),
      ),
  );
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isSuggesting, startSuggesting] = useTransition();
  const [isAssigningLetters, startAssigningLetters] = useTransition();
  const [isSubmitting, startSubmitting] = useTransition();
  const [submitResult, setSubmitResult] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);
  const [showDeparted, setShowDeparted] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isDraftZipping, setIsDraftZipping] = useState(false);

  // Called when suppress / unsuppress returns a fresh employee record
  const handleEmployeeUpdated = useCallback(
    (updated: EmployeeWithCompliance) => {
      setEmployees((prev) =>
        prev.map((e) => (e.id === updated.id ? updated : e)),
      );
      setRows((prev) => ({
        ...prev,
        [updated.id]: {
          ...prev[updated.id],
          change_type: updated.change_type ?? "CPI Increase",
          change_input:
            updated.change_input != null
              ? String(updated.change_input)
              : String(cpiRate),
          proposed_award: updated.proposed_award ?? null,
          letter_type: updated.letter_type ?? "",
          notes: updated.notes ?? "",
          proposed_rate: updated.proposed_rate ?? null,
          compliance: updated.compliance,
        },
      }));
    },
    [cpiRate],
  );

  const departed = useMemo(
    () => employees.filter((e) => e.is_departed),
    [employees],
  );
  const active = useMemo(
    () => employees.filter((e) => !e.is_departed),
    [employees],
  );

  // ── Table summary badges ─────────────────────────────────────────────────
  const tableSummary = useMemo(() => {
    let belowAward    = 0;  // proposed rate < award floor (fail)
    let levelPending  = 0;  // system suggested level change, not yet accepted
    let missingRate   = 0;  // no proposed rate set at all
    let unresolvedWarn = 0; // has warn-level issues not suppressed
    let noLetter      = 0;  // rate is set but no letter assigned
    let draftReady    = 0;  // letter assigned + compliance clean + rate set

    for (const emp of active) {
      const row = rows[emp.id];
      if (!row) continue;
      if (row.compliance.checks.some((c) => c.label === "Award floor" && c.status === "fail"))
        belowAward++;
      if (row.compliance.next_level && !row.proposed_award)
        levelPending++;
      if (!row.proposed_rate)
        missingRate++;
      if (row.compliance.overall === "warn")
        unresolvedWarn++;
      if (row.proposed_rate && !row.letter_type)
        noLetter++;
      if (
        row.letter_type && ["A", "B", "C"].includes(row.letter_type) &&
        row.compliance.overall === "ok" && row.proposed_rate
      )
        draftReady++;
    }
    return { belowAward, levelPending, missingRate, unresolvedWarn, noLetter, draftReady };
  }, [active, rows]);

  // ── Submit readiness ─────────────────────────────────────────────────────
  const submitReadiness = useMemo(() => {
    let unresolvedCompliance = 0; // fail or warn (not suppressed)
    let missingLetters       = 0; // no letter_type assigned
    let pendingLevelChanges  = 0; // next_level suggested but not accepted
    let missingRates         = 0; // no proposed_rate

    for (const emp of active) {
      const row = rows[emp.id];
      if (!row) continue;
      if (row.compliance.overall === "fail" || row.compliance.overall === "warn")
        unresolvedCompliance++;
      if (!row.letter_type)
        missingLetters++;
      if (row.compliance.next_level && !row.proposed_award)
        pendingLevelChanges++;
      if (!row.proposed_rate)
        missingRates++;
    }

    const blockers: string[] = [];
    if (missingRates > 0)
      blockers.push(`${missingRates} employee${missingRates !== 1 ? "s" : ""} missing a proposed rate`);
    if (unresolvedCompliance > 0)
      blockers.push(`${unresolvedCompliance} unresolved compliance issue${unresolvedCompliance !== 1 ? "s" : ""}`);
    if (pendingLevelChanges > 0)
      blockers.push(`${pendingLevelChanges} suggested level change${pendingLevelChanges !== 1 ? "s" : ""} not yet accepted`);
    if (missingLetters > 0)
      blockers.push(`${missingLetters} employee${missingLetters !== 1 ? "s" : ""} without a letter`);

    return { ready: blockers.length === 0, blockers };
  }, [active, rows]);

  // ── Letter-assignment readiness ──────────────────────────────────────────
  // The button is enabled only when every active employee:
  //   1. has a proposed rate set, AND
  //   2. has no unresolved compliance issues (overall === "ok", which includes
  //      suppressed checks being treated as resolved)
  const letterReadiness = useMemo(() => {
    let missingRates      = 0;
    let unresolvedIssues  = 0;
    let pendingLevelChanges = 0;
    for (const emp of active) {
      const row = rows[emp.id];
      if (!row) continue;
      if (!row.proposed_rate) missingRates++;
      if (row.compliance.overall !== "ok") unresolvedIssues++;
      if (row.compliance.next_level && !row.proposed_award) pendingLevelChanges++;
    }
    const ready = missingRates === 0 && unresolvedIssues === 0 && pendingLevelChanges === 0;
    return { missingRates, unresolvedIssues, pendingLevelChanges, ready };
  }, [active, rows]);

  // ── Summary stats ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let payrollCurrent = 0;
    let payrollProposed = 0;
    let issues = 0;
    for (const emp of active) {
      const row = rows[emp.id];
      const hours = emp.hours_per_week ?? 0;
      payrollCurrent += (emp.current_rate ?? 0) * hours * 52;
      payrollProposed += (row?.proposed_rate ?? 0) * hours * 52;
      if (row && row.compliance.overall === "fail") issues += 1;
    }
    return { payrollCurrent, payrollProposed, issues };
  }, [active, rows]);

  // ── Patch single employee ─────────────────────────────────────────────────
  const saveRow = useCallback(
    async (
      emp: EmployeeWithCompliance,
      patch: Partial<Pick<RowState, "change_type" | "change_input" | "letter_type" | "notes">>,
    ) => {
      const row = rows[emp.id];
      if (!row) return;
      setRows((prev) => ({
        ...prev,
        [emp.id]: { ...prev[emp.id], saveState: "saving", error: null },
      }));
      try {
        const changeType = patch.change_type ?? row.change_type;
        const changeInputRaw = patch.change_input ?? row.change_input;
        const changeInput =
          inputKind(changeType) === "none"
            ? null
            : parseFloat(changeInputRaw) || null;

        // proposed_award: undefined means "don't touch it"; "" means "clear it"
        const proposedAwardPatch: Pick<EmployeePatch, "proposed_award"> | Record<never, never> =
          "proposed_award" in patch
            ? { proposed_award: (patch.proposed_award as string | null | undefined) ?? null }
            : {};

        const updated = await patchEmployee(emp.id, {
          change_type: changeType || null,
          change_input: changeInput,
          ...proposedAwardPatch,
          letter_type: (patch.letter_type ?? row.letter_type) || null,
          notes: (patch.notes ?? row.notes) || null,
        });

        setRows((prev) => ({
          ...prev,
          [emp.id]: {
            ...prev[emp.id],
            change_type: updated.change_type ?? "CPI Increase",
            change_input:
              updated.change_input != null
                ? String(updated.change_input)
                : String(cpiRate),
            proposed_award: updated.proposed_award ?? null,
            letter_type: updated.letter_type ?? "",
            notes: updated.notes ?? "",
            proposed_rate: updated.proposed_rate ?? null,
            saveState: "saved",
            error: null,
            compliance: updated.compliance,
          },
        }));

        // Update the base employee record so stats stay in sync
        setEmployees((prev) =>
          prev.map((e) =>
            e.id === emp.id
              ? { ...e, proposed_rate: updated.proposed_rate }
              : e,
          ),
        );

        setTimeout(() => {
          setRows((prev) => ({
            ...prev,
            [emp.id]: { ...prev[emp.id], saveState: "idle" },
          }));
        }, 2000);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "Save failed";
        setRows((prev) => ({
          ...prev,
          [emp.id]: { ...prev[emp.id], saveState: "error", error: msg },
        }));
      }
    },
    [rows, cpiRate],
  );

  // ── Auto-assign letters ──────────────────────────────────────────────────
  function handleAssignLetters() {
    startAssigningLetters(async () => {
      try {
        const res = await bulkAssignLetters(cycleId, site);
        const data = await getSiteEmployees(cycleId, site);
        setEmployees(data);
        setRows(Object.fromEntries(data.map((e) => [e.id, initRow(e, cpiRate)])));
        alert(`Letters assigned: ${res.updated} updated, ${res.skipped} skipped.`);
      } catch (err) {
        alert(
          "Letter assignment failed: " +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    });
  }

  // ── Auto-suggest rates ───────────────────────────────────────────────────
  function handleSuggest() {
    startSuggesting(async () => {
      try {
        const res = await bulkSuggest(cycleId, site);
        const data = await getSiteEmployees(cycleId, site);
        setEmployees(data);
        setRows(Object.fromEntries(data.map((e) => [e.id, initRow(e, cpiRate)])));
        router.refresh();
        alert(
          `Auto-suggest complete: ${res.updated} rates set, ${res.skipped} skipped.`,
        );
      } catch (err) {
        alert(
          "Auto-suggest failed: " +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    });
  }

  // ── Submit for approval ──────────────────────────────────────────────────
  function handleSubmit() {
    startSubmitting(async () => {
      try {
        const res = await submitSite(cycleId, site);
        setSubmitResult({
          status: "success",
          message:
            res.issues_count > 0
              ? `Submitted for approval with ${res.issues_count} compliance issue(s) remaining.`
              : "Site submitted for approval — no compliance issues.",
        });
        router.refresh();
      } catch (err) {
        setSubmitResult({
          status: "error",
          message:
            err instanceof ApiError ? err.message : "Submission failed",
        });
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="mt-6 space-y-5">
      {/* ── KPI row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <div className="kpi-card">
          <div
            className="text-xl font-bold tabular-nums"
            style={{ color: "var(--neutral-900)", fontFamily: "var(--font-mono)" }}
          >
            {active.length}
          </div>
          <div
            className="mt-1 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--neutral-500)" }}
          >
            Active staff
          </div>
        </div>
        <div className="kpi-card">
          <div
            className="text-xl font-bold tabular-nums"
            style={{ color: "var(--neutral-900)", fontFamily: "var(--font-mono)" }}
          >
            {formatCurrency(stats.payrollCurrent)}
          </div>
          <div
            className="mt-1 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--neutral-500)" }}
          >
            Current payroll
          </div>
        </div>
        <div className="kpi-card">
          <div
            className="text-xl font-bold tabular-nums"
            style={{ color: "var(--neutral-900)", fontFamily: "var(--font-mono)" }}
          >
            {stats.payrollProposed > 0
              ? formatCurrency(stats.payrollProposed)
              : "—"}
          </div>
          <div
            className="mt-1 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--neutral-500)" }}
          >
            Proposed payroll
          </div>
        </div>
        <div className="kpi-card">
          <div
            className="text-xl font-bold tabular-nums"
            style={{
              color:
                stats.issues > 0 ? "var(--red-600)" : "var(--green-600)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {stats.issues}
          </div>
          <div
            className="mt-1 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--neutral-500)" }}
          >
            Hard issues
          </div>
        </div>

        {/* Budget increase */}
        {(() => {
          const delta = stats.payrollProposed - stats.payrollCurrent;
          const pct   = stats.payrollCurrent > 0 ? (delta / stats.payrollCurrent) * 100 : 0;
          const hasProposed = stats.payrollProposed > 0;
          return (
            <div className="kpi-card">
              <div
                className="text-xl font-bold tabular-nums"
                style={{
                  fontFamily: "var(--font-mono)",
                  color: !hasProposed ? "var(--neutral-300)" : delta > 0 ? "#16a34a" : delta < 0 ? "#dc2626" : "var(--neutral-900)",
                }}
              >
                {!hasProposed ? "—" : `${delta >= 0 ? "+" : ""}${formatCurrency(delta)}`}
              </div>
              {hasProposed && (
                <div
                  className="mt-0.5 text-xs font-semibold tabular-nums"
                  style={{ color: delta >= 0 ? "#16a34a" : "#dc2626" }}
                >
                  {delta >= 0 ? "+" : ""}{pct.toFixed(1)}% on current
                </div>
              )}
              <div
                className="mt-1 text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--neutral-500)" }}
              >
                Budget increase
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Lock banner ───────────────────────────────────────────────────── */}
      {locked && (
        <div
          className="flex items-center gap-3 rounded-xl px-5 py-3.5 text-sm font-medium"
          style={
            approvalStatus === "approved"
              ? {
                  background: "var(--green-50)",
                  border: "1px solid var(--green-100)",
                  color: "var(--green-700)",
                }
              : {
                  background: "var(--amber-100)",
                  border: "1px solid var(--amber-500)",
                  color: "var(--amber-700)",
                }
          }
        >
          <span>{approvalStatus === "approved" ? "✅" : "🔒"}</span>
          <span>
            {approvalStatus === "approved"
              ? "This site has been approved — all fields are locked."
              : "This site is pending approval — all fields are locked. Go to Approvals to action it."}
          </span>
        </div>
      )}

      {/* ── Action bar ────────────────────────────────────────────────────── */}
      {!locked && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleSuggest}
            disabled={isSuggesting}
            className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 transition-colors"
            style={{ background: "var(--neutral-900)", color: "white" }}
          >
            {isSuggesting
              ? "Suggesting…"
              : `Auto-suggest rates (CPI ${cpiRate}%)`}
          </button>
          <div
            title={
              !letterReadiness.ready
                ? [
                    letterReadiness.missingRates > 0 && `${letterReadiness.missingRates} missing proposed rate`,
                    letterReadiness.unresolvedIssues > 0 && `${letterReadiness.unresolvedIssues} unresolved compliance issue${letterReadiness.unresolvedIssues !== 1 ? "s" : ""}`,
                    letterReadiness.pendingLevelChanges > 0 && `${letterReadiness.pendingLevelChanges} level change${letterReadiness.pendingLevelChanges !== 1 ? "s" : ""} not yet accepted`,
                  ].filter(Boolean).join(" · ")
                : undefined
            }
            className="relative"
          >
            <button
              onClick={handleAssignLetters}
              disabled={isAssigningLetters || !letterReadiness.ready}
              className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
              style={{
                border: `1px solid ${letterReadiness.ready ? "var(--border)" : "var(--neutral-200)"}`,
                background: letterReadiness.ready ? "white" : "var(--neutral-50)",
                color: letterReadiness.ready ? "var(--neutral-700)" : "var(--neutral-400)",
                cursor: letterReadiness.ready ? "pointer" : "not-allowed",
              }}
            >
              {isAssigningLetters ? "Assigning…" : "Auto-assign letters"}
            </button>
            {!letterReadiness.ready && (
              <span
                className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                style={{ background: "var(--amber-400)", color: "white" }}
              >
                {letterReadiness.missingRates + letterReadiness.unresolvedIssues + letterReadiness.pendingLevelChanges}
              </span>
            )}
          </div>
          <div
            className="relative"
            title={
              !submitReadiness.ready
                ? submitReadiness.blockers.join(" · ")
                : undefined
            }
          >
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !submitReadiness.ready}
              className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
              style={{
                border: `1px solid ${submitReadiness.ready ? "var(--brand)" : "var(--neutral-200)"}`,
                background: submitReadiness.ready ? "var(--brand)" : "var(--neutral-50)",
                color: submitReadiness.ready ? "white" : "var(--neutral-400)",
                cursor: submitReadiness.ready ? "pointer" : "not-allowed",
                opacity: isSubmitting ? 0.5 : 1,
              }}
            >
              {isSubmitting ? "Submitting…" : "Submit for approval"}
            </button>
            {!submitReadiness.ready && (
              <span
                className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                style={{ background: "var(--red-500)", color: "white" }}
              >
                {submitReadiness.blockers.length}
              </span>
            )}
          </div>
          <span
            className="text-xs"
            style={{ color: "var(--neutral-500)" }}
          >
            Changes save automatically. Click a status badge to see compliance
            details.
          </span>
        </div>
      )}

      {/* ── Submit result banner ──────────────────────────────────────────── */}
      {submitResult && (
        <div
          className="flex items-center justify-between rounded-xl px-5 py-3.5 text-sm"
          style={
            submitResult.status === "success"
              ? {
                  background: "var(--green-50)",
                  border: "1px solid var(--green-100)",
                  color: "var(--green-700)",
                }
              : {
                  background: "var(--red-50)",
                  border: "1px solid var(--red-100)",
                  color: "var(--red-700)",
                }
          }
        >
          <span className="font-medium">{submitResult.message}</span>
          <button
            onClick={() => setSubmitResult(null)}
            className="ml-4 text-xs underline opacity-70"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Summary badges ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {tableSummary.belowAward > 0 && (
          <SummaryBadge icon="✗" count={tableSummary.belowAward} label="below award minimum" bg="#fee2e2" color="#dc2626" border="#fecaca" />
        )}
        {tableSummary.missingRate > 0 && (
          <SummaryBadge icon="—" count={tableSummary.missingRate} label="missing proposed rate" bg="#fff7ed" color="#c2410c" border="#fed7aa" />
        )}
        {tableSummary.levelPending > 0 && (
          <SummaryBadge icon="↑" count={tableSummary.levelPending} label="level upgrade pending" bg="#eff6ff" color="#1d4ed8" border="#bfdbfe" />
        )}
        {tableSummary.unresolvedWarn > 0 && (
          <SummaryBadge icon="⚠" count={tableSummary.unresolvedWarn} label="unresolved warnings" bg="#fffbeb" color="#b45309" border="#fde68a" />
        )}
        {tableSummary.noLetter > 0 && (
          <SummaryBadge icon="✉" count={tableSummary.noLetter} label="no letter assigned" bg="#f8fafc" color="#475569" border="#cbd5e1" />
        )}
        {tableSummary.belowAward === 0 && tableSummary.missingRate === 0 &&
         tableSummary.levelPending === 0 && tableSummary.unresolvedWarn === 0 && (
          <SummaryBadge icon="✓" count={active.length} label="all employees ready" bg="#f0fdf4" color="#16a34a" border="#bbf7d0" />
        )}
      </div>

      {/* ── Review table ──────────────────────────────────────────────────── */}
      <div
        className="overflow-x-auto rounded-xl"
        style={{
          background: "white",
          border: "1px solid var(--border)",
          boxShadow: "0 1px 3px rgba(15,15,15,0.04)",
          maxHeight: "calc(100vh - 260px)",
          overflowY: "auto",
        }}
      >
        <table className="min-w-full">
          <thead>
            {/* ── Toolbar row — lives inside thead so it spans the full table width ── */}
            <tr>
              <th
                colSpan={11 + (showHistory ? 5 : 0)}
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 30,
                  background: "white",
                  borderBottom: "1px solid var(--neutral-100)",
                  padding: 0,
                }}
              >
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--neutral-400)" }}>
                    {active.length} active employees
                  </span>
                  <div className="flex items-center gap-2">
                    {tableSummary.draftReady > 0 && (
                      <button
                        onClick={async () => {
                          setIsDraftZipping(true);
                          try {
                            await downloadDraftLettersZip(cycleId, site);
                          } catch (err) {
                            alert("Download failed: " + (err instanceof Error ? err.message : String(err)));
                          } finally {
                            setIsDraftZipping(false);
                          }
                        }}
                        disabled={isDraftZipping}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                        style={{ background: "#0369a1", color: "white" }}
                      >
                        {isDraftZipping
                          ? "Zipping…"
                          : `⬇ ${tableSummary.draftReady} draft${tableSummary.draftReady !== 1 ? "s" : ""}`}
                      </button>
                    )}
                    <button
                      onClick={() => setShowHistory((v) => !v)}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                      style={{
                        background: showHistory ? "var(--neutral-900)" : "var(--neutral-100)",
                        color: showHistory ? "white" : "var(--neutral-600)",
                      }}
                    >
                      <span>{showHistory ? "▲" : "▼"}</span>
                      Last year (FY25→FY26)
                    </button>
                  </div>
                </div>
              </th>
            </tr>
            {/* ── Column headers ── */}
            <tr>
              {/* Base columns */}
              <Th align="left"  >Emp #</Th>
              <Th align="left"  >Name</Th>
              <Th align="center">Age</Th>
              <Th align="center">Status</Th>
              <Th align="left"  >FY26 Award Level</Th>
              <Th align="right" >Current Rate</Th>
              <Th align="left"  >Change Type</Th>
              <Th align="right" >Input</Th>
              <Th align="right" >Proposed Rate</Th>
              <Th align="center">Letter</Th>
              <Th align="left"  >Notes</Th>
              {/* History columns */}
              {showHistory && <>
                <Th align="center" history>Level Changed?</Th>
                <Th align="center" history>Rate Changed?</Th>
                <Th align="center" history>Above Award Min?</Th>
                <Th align="center" history>Above Band Min?</Th>
                <Th align="center" history>Below Band Max?</Th>
              </>}
            </tr>
          </thead>
          <tbody>
            {active.map((emp) => {
              const row = rows[emp.id];
              if (!row) return null;
              return (
                <>
                  <ReviewRow
                    key={emp.id}
                    emp={emp}
                    row={row}
                    cpiRate={cpiRate}
                    locked={locked}
                    isExpanded={expandedId === emp.id}
                    showHistory={showHistory}
                    onToggleExpand={() =>
                      setExpandedId((prev) =>
                        prev === emp.id ? null : emp.id,
                      )
                    }
                    onChange={(field, value) =>
                      setRows((prev) => ({
                        ...prev,
                        [emp.id]: { ...prev[emp.id], [field]: value },
                      }))
                    }
                    onSave={(patch) => saveRow(emp, patch)}
                  />
                  {expandedId === emp.id && (
                    <tr key={`${emp.id}-panel`}>
                      <td
                        colSpan={11 + (showHistory ? 5 : 0)}
                        className="px-5 py-4"
                        style={{
                          borderBottom: "1px solid var(--neutral-100)",
                          background: "var(--neutral-50)",
                        }}
                      >
                        <CompliancePanel
                          emp={emp}
                          compliance={row.compliance}
                          locked={locked}
                          onUpdate={handleEmployeeUpdated}
                        />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Departed employees toggle ─────────────────────────────────────── */}
      {departed.length > 0 && (
        <div>
          <button
            onClick={() => setShowDeparted((v) => !v)}
            className="text-xs underline"
            style={{ color: "var(--neutral-500)" }}
          >
            {showDeparted ? "Hide" : "Show"} {departed.length} departed
            employee{departed.length !== 1 ? "s" : ""}
          </button>
          {showDeparted && (
            <div
              className="mt-3 overflow-x-auto rounded-xl opacity-60"
              style={{
                background: "white",
                border: "1px solid var(--border)",
              }}
            >
              <table className="min-w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Emp #", "Name", "Current rate"].map((h, i) => (
                      <th
                        key={h}
                        className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-wider ${i === 2 ? "text-right" : "text-left"}`}
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
                  {departed.map((emp, idx) => (
                    <tr
                      key={emp.id}
                      style={{
                        borderBottom:
                          idx < departed.length - 1
                            ? "1px solid var(--neutral-100)"
                            : "none",
                      }}
                    >
                      <td
                        className="px-3 py-2 text-xs tabular-nums"
                        style={{ color: "var(--neutral-500)" }}
                      >
                        {emp.emp_num}
                      </td>
                      <td
                        className="px-3 py-2"
                        style={{ color: "var(--neutral-500)" }}
                      >
                        {emp.first_name} {emp.last_name}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        style={{ color: "var(--neutral-500)" }}
                      >
                        {emp.current_rate != null
                          ? formatRate(emp.current_rate)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Table header cell helper
// ─────────────────────────────────────────────────────────────────────────────
function Th({
  children,
  align = "left",
  history = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  history?: boolean;
}) {
  return (
    <th
      className={`px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider leading-tight`}
      style={{
        textAlign: align,
        background: "#0f172a",
        color: history ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.65)",
        borderLeft: history ? "1px solid rgba(255,255,255,0.1)" : undefined,
        whiteSpace: "nowrap",
        position: "sticky",
        top: "44px",
        zIndex: 10,
      }}
    >
      {children}
    </th>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Row component
// ─────────────────────────────────────────────────────────────────────────────
type RowPatch = Partial<
  Pick<RowState, "change_type" | "change_input" | "proposed_award" | "letter_type" | "notes">
>;

function ReviewRow({
  emp,
  row,
  cpiRate,
  locked,
  isExpanded,
  showHistory,
  onToggleExpand,
  onChange,
  onSave,
}: {
  emp: EmployeeWithCompliance;
  row: RowState;
  cpiRate: number;
  locked: boolean;
  isExpanded: boolean;
  showHistory: boolean;
  onToggleExpand: () => void;
  onChange: (field: keyof RowState, value: string) => void;
  onSave: (patch: RowPatch) => void;
}) {
  const overall = row.compliance.overall;
  const rateHasFail = row.compliance.checks.some(
    (c) => c.label === "Award floor" && c.status === "fail",
  );
  const kind = inputKind(row.change_type);
  const cpiLocked = isCpiLocked(row.change_type);

  // Left-border accent + row tint by compliance status
  const rowAccent =
    overall === "fail" ? "var(--red-500)"
    : overall === "warn" ? "var(--amber-400)"
    : "transparent";
  const rowBg =
    overall === "fail" ? "var(--red-50)"
    : overall === "warn" ? "#fffbeb"
    : isExpanded ? "var(--neutral-50)"
    : "white";

  // Annual cost helpers
  const hours = emp.hours_per_week ?? 0;
  const annualCurrent = emp.current_rate ? emp.current_rate * hours * 52 : null;
  const annualProposed = row.proposed_rate ? row.proposed_rate * hours * 52 : null;

  const tdBase = "px-3 py-4 align-top text-sm";
  const mono = { fontFamily: "var(--font-mono)" };

  return (
    <tr
      style={{
        borderBottom: "1px solid var(--neutral-100)",
        background: rowBg,
        borderLeft: `3px solid ${rowAccent}`,
      }}
    >
      {/* ── Emp # ───────────────────────────────────────────────────────── */}
      <td className={`${tdBase} pl-4`} style={{ minWidth: 72, whiteSpace: "nowrap" }}>
        <span className="tabular-nums text-xs" style={{ color: "#64748b", ...mono }}>
          #{emp.emp_num}
        </span>
      </td>
      {/* ── Name ────────────────────────────────────────────────────────── */}
      <td className={tdBase} style={{ minWidth: 130 }}>
        <div className="font-semibold" style={{ color: "#0f172a", fontSize: "0.8125rem" }}>
          {emp.first_name} {emp.last_name}
        </div>
      </td>

      {/* ── Age ────────────────────────────────────────────────────────── */}
      <td className={`${tdBase} text-center`} style={{ color: "var(--neutral-600)" }}>
        {emp.age ?? <span style={{ color: "var(--neutral-300)" }}>—</span>}
      </td>

      {/* ── Status (compliance badge — early so reviewer can scan fast) ── */}
      <td className={`${tdBase} text-center`} style={{ minWidth: 80 }}>
        {row.saveState === "saving" ? (
          <span className="text-[11px]" style={{ color: "var(--neutral-400)" }}>Saving…</span>
        ) : row.saveState === "saved" ? (
          <span className="text-[11px] font-semibold" style={{ color: "var(--green-600)" }}>✓ Saved</span>
        ) : row.saveState === "error" ? (
          <div className="text-[11px]" style={{ color: "var(--red-600)" }}>Error</div>
        ) : (
          <button onClick={onToggleExpand} className="focus:outline-none">
            <OverallBadge
              overall={row.compliance.overall}
              checks={row.compliance.checks}
              isExpanded={isExpanded}
            />
          </button>
        )}
        {row.error && (
          <div className="mt-0.5 text-[11px]" style={{ color: "var(--red-600)" }}>{row.error}</div>
        )}
      </td>

      {/* ── FY26 Award Level + level change decision ───────────────────── */}
      <td className={tdBase} style={{ minWidth: 240 }}>
        {/* Current level label */}
        <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#0f172a", letterSpacing: "-0.01em" }}>
          {emp.fy26_award ?? <span style={{ color: "#cbd5e1" }}>—</span>}
        </div>
        {/* PP level + band range as subtle meta */}
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
          {[emp.pp_level, row.compliance.band_min != null && row.compliance.band_max != null
            ? `band ${formatRate(row.compliance.band_min)}–${formatRate(row.compliance.band_max)}`
            : null].filter(Boolean).join(" · ")}
        </div>

        {/* ── Accepted level change ── */}
        {row.proposed_award ? (
          <div style={{
            marginTop: 8, display: "flex", alignItems: "center", gap: 6,
            background: "#eff6ff", border: "1px solid #bfdbfe",
            borderRadius: 8, padding: "5px 8px",
          }}>
            <span style={{ fontSize: 10, color: "#64748b" }}>→</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8", flex: 1 }}>
              {row.proposed_award}
            </span>
          </div>
        ) : row.compliance.next_level && !locked ? (
          /* ── Unaccepted suggestion ── */
          <div style={{
            marginTop: 8, display: "flex", alignItems: "center", gap: 6,
            background: "#f8fafc", border: "1.5px dashed #cbd5e1",
            borderRadius: 8, padding: "5px 8px",
          }}>
            <span style={{ fontSize: 10, color: "#64748b" }}>Suggest →</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#475569", flex: 1 }}>
              {row.compliance.next_level}
            </span>
            <button
              onClick={() => onSave({ proposed_award: row.compliance.next_level! })}
              style={{
                background: "#0f172a", color: "white",
                borderRadius: 5, padding: "2px 10px",
                fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              Accept
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 6, fontSize: 11, color: "#64748b" }}>No level change</div>
        )}
      </td>

      {/* ── Current rate ────────────────────────────────────────────────── */}
      <td className={`${tdBase} text-right`} style={{ minWidth: 100 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "0.875rem", color: "#334155" }}>
          {emp.current_rate != null ? formatRate(emp.current_rate) : "—"}
        </div>
        {annualCurrent && (
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
            {formatAnnual(annualCurrent)}/yr
          </div>
        )}
        {row.compliance.award_minimum != null && (
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
            min {formatRate(row.compliance.award_minimum)}
          </div>
        )}
      </td>

      {/* ── Change type ─────────────────────────────────────────────────── */}
      <td className={`${tdBase}`} style={{ minWidth: 145 }}>
        <Select
          value={row.change_type || NONE}
          onValueChange={(v) => {
            const val = v === NONE ? "" : v;
            const vl = val.toLowerCase();
            const newInput =
              vl === "cpi increase"
                ? String(cpiRate)
                : vl === "fixed rate" || vl === "per admin pp"
                  ? String(emp.current_rate ?? "")
                  : row.change_input;
            onChange("change_type", val);
            onChange("change_input", newInput);
            onSave({ change_type: val, change_input: newInput });
          }}
          disabled={locked}
        >
          <SelectTrigger className="h-7 w-full text-xs px-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE} className="text-xs italic" style={{ color: "var(--neutral-400)" }}>
              — select —
            </SelectItem>
            {CHANGE_TYPES.map((t) => (
              <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>

      {/* ── Input ───────────────────────────────────────────────────────── */}
      <td className={`${tdBase} text-right`} style={{ minWidth: 84 }}>
        {kind === "none" ? (
          <span style={{ color: "var(--neutral-300)" }}>—</span>
        ) : (
          <div className="flex items-center justify-end gap-0.5">
            {kind === "dollars" && (
              <span className="text-[11px]" style={{ color: "var(--neutral-400)" }}>$</span>
            )}
            <input
              type="number"
              step="0.01"
              min="0"
              value={row.change_input}
              readOnly={cpiLocked}
              onChange={(e) => !cpiLocked && onChange("change_input", e.target.value)}
              onBlur={(e) => { if (!cpiLocked) onSave({ change_input: e.target.value }); }}
              disabled={locked}
              className="w-16 rounded border px-1.5 py-1 text-right text-xs tabular-nums focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                borderColor: "var(--neutral-200)",
                background: cpiLocked ? "var(--neutral-50)" : "white",
                color: "var(--neutral-800)",
                ...mono,
                cursor: cpiLocked ? "default" : "text",
              }}
            />
            {kind === "percent" && (
              <span className="text-[11px]" style={{ color: "var(--neutral-400)" }}>%</span>
            )}
          </div>
        )}
      </td>

      {/* ── Proposed rate ───────────────────────────────────────────────── */}
      <td className={`${tdBase} text-right`} style={{ minWidth: 120 }}>
        <div style={{
          fontFamily: "var(--font-mono)", fontWeight: 800,
          fontSize: "1rem", letterSpacing: "-0.02em",
          color: rateHasFail ? "#dc2626" : row.proposed_rate != null ? "#0f172a" : "#cbd5e1",
        }}>
          {row.proposed_rate != null ? formatRate(row.proposed_rate) : "—"}
        </div>
        {annualProposed && (
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
            {formatAnnual(annualProposed)}/yr
          </div>
        )}
        {row.proposed_rate && emp.current_rate && (() => {
          const pct = ((row.proposed_rate - emp.current_rate) / emp.current_rate) * 100;
          const up = pct >= 0;
          return (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 2,
              background: up ? "#dcfce7" : "#fee2e2",
              color: up ? "#166534" : "#dc2626",
              borderRadius: 4, padding: "1px 6px",
              fontSize: 11, fontWeight: 700, marginTop: 4,
            }}>
              {up ? "↑" : "↓"}{Math.abs(pct).toFixed(1)}%
            </div>
          );
        })()}
      </td>

      {/* ── Letter ──────────────────────────────────────────────────────── */}
      <td className={`${tdBase} text-center`}>
        <Select
          value={row.letter_type || NONE}
          onValueChange={(v) => {
            const val = v === NONE ? "" : v;
            onChange("letter_type", val);
            onSave({ letter_type: val });
          }}
          disabled={locked}
        >
          <SelectTrigger className="h-7 w-16 text-xs px-2 mx-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE} className="text-xs italic" style={{ color: "var(--neutral-400)" }}>
              —
            </SelectItem>
            {LETTER_TYPES.map((t) => (
              <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Draft PDF download — only when letter assigned and compliance clean */}
        {row.letter_type && ["A", "B", "C"].includes(row.letter_type) &&
         row.compliance.overall === "ok" && row.proposed_rate && (
          <button
            onClick={() =>
              downloadDraftLetter(emp.id).catch((err) =>
                alert(err instanceof Error ? err.message : String(err)),
              )
            }
            className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold"
            style={{
              background: "#f0f9ff",
              border: "1px solid #bae6fd",
              color: "#0369a1",
            }}
          >
            📄 Draft
          </button>
        )}
      </td>

      {/* ── Notes ───────────────────────────────────────────────────────── */}
      <td className={tdBase} style={{ minWidth: 160 }}>
        <input
          type="text"
          value={row.notes}
          onChange={(e) => onChange("notes", e.target.value)}
          onBlur={(e) => onSave({ notes: e.target.value })}
          placeholder="Add notes…"
          disabled={locked}
          className="w-full rounded border px-2 py-1 text-xs focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            borderColor: "var(--neutral-200)",
            color: "var(--neutral-700)",
            background: "white",
          }}
        />
      </td>

      {/* ── History columns ─────────────────────────────────────────────── */}
      {showHistory && <>
        <HistCell value={emp.hist_award_level_changed} />
        <HistCell value={emp.hist_rate_changed} />
        <HistCell value={emp.hist_above_award_rate} />
        <HistCell value={emp.hist_above_pp_rate} />
        <HistCell value={emp.hist_above_pp_max} />
      </>}
    </tr>
  );
}

function HistCell({ value }: { value: boolean | null | undefined }) {
  return (
    <td
      className="px-3 py-4 text-center align-top text-sm"
    >
      {value === null || value === undefined ? (
        <span style={{ color: "var(--neutral-600)" }}>—</span>
      ) : value ? (
        <span
          className="inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-bold"
          style={{ background: "#14532d", color: "#86efac" }}
        >
          Yes
        </span>
      ) : (
        <span
          className="inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-bold"
          style={{ background: "#450a0a", color: "#fca5a5" }}
        >
          No
        </span>
      )}
    </td>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Compliance panel
// ─────────────────────────────────────────────────────────────────────────────
function CompliancePanel({
  emp,
  compliance,
  locked,
  onUpdate,
}: {
  emp: EmployeeWithCompliance;
  compliance: EmployeeWithCompliance["compliance"];
  locked: boolean;
  onUpdate: (updated: EmployeeWithCompliance) => void;
}) {
  const [showPassing, setShowPassing] = useState(false);

  // Sort: fail → warn → suppressed → ok
  const ORDER: Record<string, number> = { fail: 0, warn: 1, suppressed: 2, ok: 3 };
  const sorted = [...compliance.checks].sort(
    (a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9),
  );
  const actionChecks = sorted.filter((c) => c.status === "fail" || c.status === "warn");
  const passChecks   = sorted.filter((c) => c.status === "ok" || c.status === "suppressed");

  return (
    <div>
      {/* Header row */}
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

      {/* Needs-attention checks (fail + warn) */}
      {actionChecks.length > 0 && (
        <div className="space-y-2 mb-3">
          {actionChecks.map((check) => (
            <CheckCard
              key={check.label}
              check={check}
              suppInfo={compliance.suppressions.find((s) => s.check_label === check.label)}
              empId={emp.id}
              locked={locked}
              onUpdate={onUpdate}
            />
          ))}
        </div>
      )}

      {/* Passing checks — collapsed by default */}
      {passChecks.length > 0 && (
        <div>
          <button
            onClick={() => setShowPassing((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium"
            style={{ color: "#64748b" }}
          >
            <span
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
              style={{ background: "#dcfce7", color: "#166534" }}
            >
              {passChecks.length}
            </span>
            {showPassing ? "Hide" : "Show"} passing checks
            <span style={{ fontSize: 10 }}>{showPassing ? "▲" : "▼"}</span>
          </button>
          {showPassing && (
            <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {passChecks.map((check) => (
                <CheckCard
                  key={check.label}
                  check={check}
                  suppInfo={compliance.suppressions.find((s) => s.check_label === check.label)}
                  empId={emp.id}
                  locked={locked}
                  onUpdate={onUpdate}
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
  check,
  suppInfo,
  empId,
  locked,
  onUpdate,
}: {
  check: CheckResult;
  suppInfo: SuppressionInfo | undefined;
  empId: number;
  locked: boolean;
  onUpdate: (updated: EmployeeWithCompliance) => void;
}) {
  const [working, setWorking] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  const [apiError, setApiError] = useState<string | null>(null);

  const isSuppressed = check.status === "suppressed";
  const canSuppress = check.status === "warn" && !locked && check.label !== "Pay progression";
  const canUnsuppress = isSuppressed && !locked;

  const statusStyles = {
    ok: {
      border: "var(--green-100)",
      bg: "var(--green-50)",
      label: "var(--green-700)",
      detail: "var(--green-600)",
    },
    warn: {
      border: "var(--amber-200)",
      bg: "var(--amber-50)",
      label: "var(--amber-800)",
      detail: "var(--amber-700)",
    },
    fail: {
      border: "var(--red-100)",
      bg: "var(--red-50)",
      label: "var(--red-700)",
      detail: "var(--red-600)",
    },
    suppressed: {
      border: "var(--neutral-200)",
      bg: "var(--neutral-50)",
      label: "var(--neutral-500)",
      detail: "var(--neutral-400)",
    },
  }[check.status];

  async function handleSuppress() {
    setWorking(true);
    setApiError(null);
    try {
      const updated = await suppressCheck(empId, check.label, reason || undefined);
      onUpdate(updated);
      setShowReason(false);
      setReason("");
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setWorking(false);
    }
  }

  async function handleUnsuppress() {
    setWorking(true);
    setApiError(null);
    try {
      const updated = await unsuppressCheck(empId, check.label);
      onUpdate(updated);
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setWorking(false);
    }
  }

  // For fail/warn: full-width card with left accent bar
  // For ok/suppressed: compact card (smaller, less visual weight)
  const isCompact = check.status === "ok" || check.status === "suppressed";

  if (isCompact) {
    return (
      <div
        className="rounded-md px-3 py-2"
        style={{ background: statusStyles.bg, border: `1px solid ${statusStyles.border}` }}
      >
        <div className="flex items-center gap-1.5">
          <StatusIcon status={check.status} />
          <span className="text-xs font-semibold" style={{ color: statusStyles.label }}>{check.label}</span>
        </div>
        <div className="mt-0.5 text-[11px] leading-snug" style={{ color: statusStyles.detail }}>
          {check.detail}
        </div>
        {isSuppressed && suppInfo && (
          <div className="mt-1 text-[11px]" style={{ color: "#64748b" }}>
            Noted by {suppInfo.suppressed_by_name} on {new Date(suppInfo.suppressed_at).toLocaleDateString("en-AU")}
            {suppInfo.reason && ` — "${suppInfo.reason}"`}
          </div>
        )}
        {canUnsuppress && (
          <button onClick={handleUnsuppress} disabled={working}
            className="mt-1 text-[11px] underline" style={{ color: "#64748b" }}>
            {working ? "Undoing…" : "Undo"}
          </button>
        )}
      </div>
    );
  }

  // Fail / Warn — prominent full-width card
  const accentColor = check.status === "fail" ? "#dc2626" : "#d97706";
  const accentBg    = check.status === "fail" ? "#fef2f2" : "#fffbeb";
  const accentBorder= check.status === "fail" ? "#fecaca" : "#fde68a";

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: `1px solid ${accentBorder}`, background: accentBg }}
    >
      {/* Top bar with label */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: `1px solid ${accentBorder}` }}
      >
        <StatusIcon status={check.status} />
        <span className="text-xs font-bold flex-1" style={{ color: accentColor }}>
          {check.label}
        </span>
        <span
          className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
          style={{ background: accentColor, color: "white" }}
        >
          {check.status}
        </span>
      </div>

      {/* Detail + recommendation */}
      <div className="px-3 py-2.5 space-y-2">
        <p className="text-xs leading-snug" style={{ color: accentColor }}>
          {check.detail}
        </p>

        {check.recommendation && (
          <div
            className="rounded px-2.5 py-1.5 text-xs leading-snug"
            style={{
              background: "white",
              border: `1px solid ${accentBorder}`,
              color: "#374151",
            }}
          >
            <span className="font-semibold" style={{ color: "#0f172a" }}>Fix: </span>
            {check.recommendation}
          </div>
        )}

        {/* Suppression action */}
        {apiError && (
          <p className="text-[11px]" style={{ color: "#dc2626" }}>{apiError}</p>
        )}

        {canSuppress && !showReason && (
          <button
            onClick={() => setShowReason(true)}
            disabled={working}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
            style={{ background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" }}
          >
            <span>✓</span> Mark as noted
          </button>
        )}

        {canSuppress && showReason && (
          <div className="space-y-1.5">
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSuppress();
                if (e.key === "Escape") { setShowReason(false); setReason(""); }
              }}
              placeholder="Reason for noting (optional)"
              autoFocus
              className="w-full rounded-md border px-2.5 py-1.5 text-xs focus:outline-none"
              style={{ borderColor: "#cbd5e1", background: "white", color: "#374151" }}
            />
            <div className="flex gap-2">
              <button
                onClick={handleSuppress}
                disabled={working}
                className="rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                style={{ background: "#0f172a", color: "white" }}
              >
                {working ? "Saving…" : "Confirm"}
              </button>
              <button
                onClick={() => { setShowReason(false); setReason(""); }}
                className="text-xs"
                style={{ color: "#64748b" }}
              >
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
//  Small presentational helpers
// ─────────────────────────────────────────────────────────────────────────────
function StatusIcon({ status }: { status: CheckResult["status"] }) {
  const map = {
    ok:         { color: "var(--green-600)",   icon: "✓" },
    warn:       { color: "var(--amber-600)",   icon: "⚠" },
    fail:       { color: "var(--red-600)",     icon: "✗" },
    suppressed: { color: "var(--neutral-400)", icon: "–" },
  };
  const { color, icon } = map[status];
  return (
    <span
      className="mt-0.5 shrink-0 text-xs"
      aria-label={status}
      style={{ color }}
    >
      {icon}
    </span>
  );
}

function OverallBadge({
  overall,
  checks,
  isExpanded,
}: {
  overall: "ok" | "warn" | "fail";
  checks: CheckResult[];
  isExpanded: boolean;
}) {
  const fails      = checks.filter((c) => c.status === "fail").length;
  const warns      = checks.filter((c) => c.status === "warn").length;
  const suppressed = checks.filter((c) => c.status === "suppressed").length;

  const styles = {
    fail: { bg: "var(--red-100)",    color: "var(--red-700)"    },
    warn: { bg: "var(--amber-100)",  color: "var(--amber-700)"  },
    ok:   { bg: "var(--green-100)",  color: "var(--green-700)"  },
  }[overall];

  const label =
    overall === "fail"
      ? `✗ ${fails} issue${fails !== 1 ? "s" : ""}`
      : overall === "warn"
        ? `⚠ ${warns} warning${warns !== 1 ? "s" : ""}`
        : suppressed > 0
          ? `✓ OK · ${suppressed} noted`
          : "✓ OK";

  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap"
      style={{ background: styles.bg, color: styles.color }}
    >
      {label}
      <ChevronIcon expanded={isExpanded} />
    </span>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
    >
      <path
        fillRule="evenodd"
        d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Summary badge
// ─────────────────────────────────────────────────────────────────────────────
function SummaryBadge({
  icon, count, label, bg, color, border,
}: {
  icon: string; count: number; label: string;
  bg: string; color: string; border: string;
}) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold"
      style={{ background: bg, color, border: `1px solid ${border}` }}
    >
      <span className="text-[13px] leading-none">{icon}</span>
      <span className="tabular-nums font-bold">{count}</span>
      <span style={{ fontWeight: 500 }}>{label}</span>
    </div>
  );
}

function formatCurrency(v: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(v);
}

function formatRate(v: number): string {
  return `$${v.toFixed(2)}`;
}

/** Format an annual dollar amount as a short string: $171k, $2.3M, etc. */
function formatAnnual(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}
