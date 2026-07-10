"use client";

import { useRouter } from "next/navigation";
import React, { useCallback, useMemo, useState, useTransition } from "react";

import { ApiError } from "@/lib/api";
import {
  downloadDraftLetter,
  downloadDraftLettersZip,
  downloadDraftRegionalExcel,
  downloadDraftUkgUpload,
  getSiteEmployees,
  patchEmployee,
  submitSite,
  suppressCheck,
  unsuppressCheck,
  type AwardRateSummary,
  type CheckResult,
  type EmployeePatch,
  type EmployeeWithCompliance,
  type SuppressionInfo,
} from "@/lib/review";
import { type PPBand } from "@/lib/pp-bands";
import { PPLevelPicker } from "@/components/pp-level-picker";
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
  "Bring to Award Level",
  "No Change",
];

// Display label overrides — internal values stay unchanged (stored in DB)
const CHANGE_TYPE_LABELS: Record<string, string> = {
  "CPI Increase": "Award Increase",
  "Per Admin PP": "Per PP",
};

// Whether the change type takes a % input, $ input, or no input
function inputKind(ct: string): "percent" | "dollars" | "none" {
  const t = ct.toLowerCase();
  if (t === "cpi increase") return "percent";   // locked to cycle CPI
  if (t === "% increase")   return "percent";   // user-editable %
  if (t === "fixed rate" || t === "per admin pp" || t === "bring to award level") return "dollars";
  return "none"; // No Change
}

function isCpiLocked(ct: string) {
  const t = ct.toLowerCase();
  return t === "cpi increase" || t === "per admin pp" || t === "bring to award level";
}

// ── Types ────────────────────────────────────────────────────────────────────
type SaveState = "idle" | "saving" | "saved" | "error";

interface RowState {
  change_type: string;
  change_input: string;           // raw string for the input field
  proposed_award: string | null;  // reviewer-selected award; null = unchanged
  pp_level: string | null;        // reviewer-selected PP convention
  letter_type: string;
  notes: string;
  proposed_rate: number | null;   // display-only; updated from server response
  is_excluded: boolean;
  saveState: SaveState;
  error: string | null;
  compliance: EmployeeWithCompliance["compliance"];
}

function initRow(e: EmployeeWithCompliance, _cpiRate?: number): RowState {
  return {
    change_type: e.change_type ?? "No Change",
    change_input:
      e.change_input != null
        ? String(e.change_input)
        : "0",
    proposed_award: e.proposed_award ?? null,
    pp_level: e.pp_level ?? null,
    letter_type: e.letter_type ?? "",
    notes: e.notes ?? "",
    proposed_rate: e.proposed_rate ?? null,
    is_excluded: e.is_excluded ?? false,
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
  readOnly = false,
  awardRates = [],
  ppBands = [],
}: {
  cycleId: number;
  site: string;
  initialEmployees: EmployeeWithCompliance[];
  cpiRate: number;
  approvalStatus?: string;
  readOnly?: boolean;
  awardRates?: AwardRateSummary[];
  ppBands?: PPBand[];
}) {
  const locked = readOnly || approvalStatus === "pending" || approvalStatus === "approved";
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
  type Filter = "belowAward" | "missingRate" | "unresolvedWarn" | "noLetter" | null;
  const [activeFilter, setActiveFilter] = useState<Filter>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  type SortKey = "emp_num" | "name" | "current_rate" | "proposed_rate";
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleFilter = (f: Filter) => setActiveFilter((prev) => prev === f ? null : f);
  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }
  function sortArrow(key: SortKey) {
    if (sortKey !== key) return <span style={{ opacity: 0.3, marginLeft: 3 }}>↕</span>;
    return <span style={{ marginLeft: 3 }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
  }
  // Track the latest save ID per employee — used to discard stale in-flight responses
  const saveSeqRef = React.useRef<Record<number, number>>({});
  const [isSubmitting, startSubmitting] = useTransition();
  const [submitResult, setSubmitResult] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);
  const [showDeparted, setShowDeparted] = useState(false);
  const [isDraftZipping, setIsDraftZipping] = useState(false);
  const [isUkgDraftDownloading, setIsUkgDraftDownloading] = useState(false);
  const [isRegionalDraftDownloading, setIsRegionalDraftDownloading] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

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
          change_type: updated.change_type ?? "No Change",
          change_input:
            updated.change_input != null
              ? String(updated.change_input)
              : "0",
          proposed_award: updated.proposed_award ?? null,
          pp_level: updated.pp_level ?? null,
          letter_type: updated.letter_type ?? "",
          notes: updated.notes ?? "",
          proposed_rate: updated.proposed_rate ?? null,
          is_excluded: updated.is_excluded ?? false,
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
  // Distinct employee categories present in this site, for the filter dropdown
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const emp of active) if (emp.category) set.add(emp.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [active]);

  // Search by employee # or name
  const searchedActive = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return active;
    return active.filter((emp) => {
      const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase();
      return emp.emp_num.toLowerCase().includes(q) || fullName.includes(q);
    });
  }, [active, search]);

  // Filter by employee category
  const categoryFilteredActive = useMemo(() => {
    if (!categoryFilter) return searchedActive;
    return searchedActive.filter((emp) => emp.category === categoryFilter);
  }, [searchedActive, categoryFilter]);

  // Filtered list for the table based on the active badge filter
  const statusFilteredActive = useMemo(() => {
    if (!activeFilter) return categoryFilteredActive;
    return categoryFilteredActive.filter((emp) => {
      const row = rows[emp.id];
      if (!row) return false;
      if (activeFilter === "belowAward")
        return row.compliance.checks.some((c) => c.label === "Award floor" && c.status === "fail");
      if (activeFilter === "missingRate")
        return !row.proposed_rate;
      if (activeFilter === "unresolvedWarn")
        return row.compliance.overall === "warn";
      if (activeFilter === "noLetter")
        return !!row.proposed_rate && !row.letter_type;
      return true;
    });
  }, [categoryFilteredActive, rows, activeFilter]);

  // Sorted list — sort applied last, on top of search + status filter
  const filteredActive = useMemo(() => {
    if (!sortKey) return statusFilteredActive;
    const dir = sortDir === "asc" ? 1 : -1;
    const arr = [...statusFilteredActive];
    arr.sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      if (sortKey === "emp_num") {
        const an = parseInt(a.emp_num, 10);
        const bn = parseInt(b.emp_num, 10);
        if (!Number.isNaN(an) && !Number.isNaN(bn)) { av = an; bv = bn; }
        else { av = a.emp_num; bv = b.emp_num; }
      } else if (sortKey === "name") {
        av = `${a.first_name} ${a.last_name}`.toLowerCase();
        bv = `${b.first_name} ${b.last_name}`.toLowerCase();
      } else if (sortKey === "current_rate") {
        av = a.current_rate ?? -Infinity;
        bv = b.current_rate ?? -Infinity;
      } else {
        av = rows[a.id]?.proposed_rate ?? -Infinity;
        bv = rows[b.id]?.proposed_rate ?? -Infinity;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [statusFilteredActive, rows, sortKey, sortDir]);

  // Excluded employees are shown in the table but not counted in any stats
  const activeForStats = useMemo(
    () => active.filter((e) => !(rows[e.id]?.is_excluded)),
    [active, rows],
  );

  // ── Table summary badges ─────────────────────────────────────────────────
  const tableSummary = useMemo(() => {
    let belowAward    = 0;  // proposed rate < award floor (fail)
    let missingRate   = 0;  // no proposed rate set at all
    let unresolvedWarn = 0; // has warn-level issues not suppressed
    let noLetter      = 0;  // rate is set but no letter assigned
    let draftReady    = 0;  // letter assigned + compliance clean + rate set

    for (const emp of activeForStats) {
      const row = rows[emp.id];
      if (!row) continue;
      if (row.compliance.checks.some((c) => c.label === "Award floor" && c.status === "fail"))
        belowAward++;
      if (!row.proposed_rate)
        missingRate++;
      if (row.compliance.overall === "warn")
        unresolvedWarn++;
      // Only count as missing letter if there's an actual change (not "No Change")
      const hasChange =
        (row.change_type && row.change_type.toLowerCase() !== "no change") ||
        (row.letter_type != null && ["A", "B", "C"].includes(row.letter_type));
      if (hasChange && !row.letter_type)
        noLetter++;
      if (
        row.letter_type && ["A", "B", "C"].includes(row.letter_type) &&
        row.compliance.overall === "ok" && row.proposed_rate
      )
        draftReady++;
    }
    return { belowAward, missingRate, unresolvedWarn, noLetter, draftReady };
  }, [active, rows]);

  // ── Submit readiness ─────────────────────────────────────────────────────
  const submitReadiness = useMemo(() => {
    let unresolvedCompliance = 0;
    let missingLetters       = 0;
    let missingRates         = 0;
    const noChangeEmps: Array<{ emp_num: string; name: string }> = [];

    for (const emp of activeForStats) {
      const row = rows[emp.id];
      if (!row) continue;
      if (row.compliance.overall === "fail" || row.compliance.overall === "warn")
        unresolvedCompliance++;
      const hasChange =
        (row.change_type && row.change_type.toLowerCase() !== "no change") ||
        (row.letter_type != null && ["A", "B", "C"].includes(row.letter_type));
      if (hasChange && !row.letter_type)
        missingLetters++;
      if (hasChange && !row.proposed_rate)
        missingRates++;
      if (!hasChange)
        noChangeEmps.push({ emp_num: emp.emp_num, name: `${emp.first_name} ${emp.last_name}` });
    }

    const blockers: string[] = [];
    if (missingRates > 0)
      blockers.push(`${missingRates} employee${missingRates !== 1 ? "s" : ""} missing a proposed rate`);
    if (unresolvedCompliance > 0)
      blockers.push(`${unresolvedCompliance} unresolved compliance issue${unresolvedCompliance !== 1 ? "s" : ""}`);
    if (missingLetters > 0)
      blockers.push(`${missingLetters} employee${missingLetters !== 1 ? "s" : ""} without a letter`);

    return { ready: blockers.length === 0, blockers, noChangeEmps };
  }, [activeForStats, rows]);


  // ── Summary stats ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let payrollCurrent = 0;
    let payrollProposed = 0;
    let issues = 0;
    for (const emp of activeForStats) {
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
      patch: RowPatch,
    ) => {
      const row = rows[emp.id];
      if (!row) return;

      // Stamp this save with a sequence number — any older in-flight response
      // that arrives after a newer one is silently discarded.
      const seq = (saveSeqRef.current[emp.id] ?? 0) + 1;
      saveSeqRef.current[emp.id] = seq;

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

        // Empty string = clear (backend converts "" → null); null = don't touch
        const ppLevelPatch: Pick<EmployeePatch, "pp_level"> | Record<never, never> =
          "pp_level" in patch ? { pp_level: patch.pp_level ?? "" } : {};

        const updated = await patchEmployee(emp.id, {
          change_type: changeType || null,
          change_input: changeInput,
          ...proposedAwardPatch,
          ...ppLevelPatch,
          notes: (patch.notes ?? row.notes) || null,
          ...("is_excluded" in patch ? { is_excluded: patch.is_excluded as boolean } : {}),
        });

        // Discard stale response — a newer save has already landed
        if (saveSeqRef.current[emp.id] !== seq) return;

        setRows((prev) => ({
          ...prev,
          [emp.id]: {
            ...prev[emp.id],
            change_type: updated.change_type ?? "No Change",
            change_input:
              updated.change_input != null
                ? String(updated.change_input)
                : "0",
            proposed_award: updated.proposed_award ?? null,
            pp_level: updated.pp_level ?? null,
            letter_type: updated.letter_type ?? "",
            notes: updated.notes ?? "",
            proposed_rate: updated.proposed_rate ?? null,
            is_excluded: updated.is_excluded ?? false,
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
        if (saveSeqRef.current[emp.id] !== seq) return; // stale error — ignore
        const msg = err instanceof ApiError ? err.message : "Save failed";
        setRows((prev) => ({
          ...prev,
          [emp.id]: { ...prev[emp.id], saveState: "error", error: msg },
        }));
      }
    },
    [rows, cpiRate],
  );


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
            {activeForStats.length}
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
      {(readOnly || approvalStatus === "pending" || approvalStatus === "approved") && (
        <div
          className="flex items-center gap-3 rounded-xl px-5 py-3.5 text-sm font-medium"
          style={
            approvalStatus === "approved"
              ? { background: "var(--green-50)", border: "1px solid var(--green-100)", color: "var(--green-700)" }
              : approvalStatus === "pending"
              ? { background: "var(--amber-100)", border: "1px solid var(--amber-500)", color: "var(--amber-700)" }
              : { background: "var(--neutral-100)", border: "1px solid var(--neutral-200)", color: "var(--neutral-600)" }
          }
        >
          <span>{approvalStatus === "approved" ? "✅" : approvalStatus === "pending" ? "🔒" : "👁"}</span>
          <span>
            {approvalStatus === "approved"
              ? "This site has been approved — all fields are locked."
              : approvalStatus === "pending"
              ? "This site has been submitted and is awaiting approval — all fields are locked."
              : "This site has not been submitted yet — you are viewing in read-only mode."}
          </span>
        </div>
      )}

      {/* ── Action bar ────────────────────────────────────────────────────── */}
      {!locked && (
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="relative"
            title={
              !submitReadiness.ready
                ? submitReadiness.blockers.join(" · ")
                : undefined
            }
          >
            <button
              onClick={() => setShowSubmitConfirm(true)}
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

      {/* ── Submit confirmation modal ────────────────────────────────────── */}
      {showSubmitConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowSubmitConfirm(false)}
        >
          <div
            className="w-96 rounded-xl p-6 shadow-xl"
            style={{ background: "white", border: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 text-sm font-bold" style={{ color: "#0f172a" }}>
              Submit for approval?
            </div>
            <p className="mb-3 text-xs leading-relaxed" style={{ color: "#64748b" }}>
              This will lock all fields and send the site for approval.
            </p>
            {submitReadiness.noChangeEmps.length > 0 && (
              <div
                className="mb-4 rounded-lg px-3 py-2.5 text-xs"
                style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}
              >
                <div className="mb-1.5 font-semibold">
                  ⚠ {submitReadiness.noChangeEmps.length} employee{submitReadiness.noChangeEmps.length !== 1 ? "s" : ""} {submitReadiness.noChangeEmps.length !== 1 ? "have" : "has"} no award level or rate change and will not receive a letter:
                </div>
                <ul className="space-y-0.5">
                  {submitReadiness.noChangeEmps.map((e) => (
                    <li key={e.emp_num} style={{ color: "#78350f" }}>
                      <span className="font-mono font-semibold">#{e.emp_num}</span> — {e.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setShowSubmitConfirm(false); handleSubmit(); }}
                disabled={isSubmitting}
                className="flex-1 rounded-lg py-2 text-xs font-semibold disabled:opacity-50"
                style={{ background: "var(--brand)", color: "white" }}
              >
                {isSubmitting ? "Submitting…" : "Yes, submit"}
              </button>
              <button
                onClick={() => setShowSubmitConfirm(false)}
                className="flex-1 rounded-lg py-2 text-xs font-semibold"
                style={{ background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" }}
              >
                Cancel
              </button>
            </div>
          </div>
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

      {/* ── Summary badges + search/category (right-aligned) ─────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {tableSummary.belowAward > 0 && (
            <SummaryBadge icon="✗" count={tableSummary.belowAward} label="below award minimum" bg="#fee2e2" color="#dc2626" border="#fecaca"
              active={activeFilter === "belowAward"} onClick={() => toggleFilter("belowAward")} />
          )}
          {tableSummary.missingRate > 0 && (
            <SummaryBadge icon="—" count={tableSummary.missingRate} label="missing proposed rate" bg="#fff7ed" color="#c2410c" border="#fed7aa"
              active={activeFilter === "missingRate"} onClick={() => toggleFilter("missingRate")} />
          )}
          {tableSummary.unresolvedWarn > 0 && (
            <SummaryBadge icon="⚠" count={tableSummary.unresolvedWarn} label="unresolved warnings" bg="#fffbeb" color="#b45309" border="#fde68a"
              active={activeFilter === "unresolvedWarn"} onClick={() => toggleFilter("unresolvedWarn")} />
          )}
          {tableSummary.noLetter > 0 && (
            <SummaryBadge icon="✉" count={tableSummary.noLetter} label="no letter assigned" bg="#f8fafc" color="#475569" border="#cbd5e1"
              active={activeFilter === "noLetter"} onClick={() => toggleFilter("noLetter")} />
          )}
          {tableSummary.belowAward === 0 && tableSummary.missingRate === 0 &&
           tableSummary.unresolvedWarn === 0 && (
            <SummaryBadge icon="✓" count={activeForStats.length} label="all employees ready" bg="#f0fdf4" color="#16a34a" border="#bbf7d0" />
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative" style={{ width: 260 }}>
            <svg
              width="13" height="13" viewBox="0 0 15 15" fill="none"
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
            >
              <circle cx="6.5" cy="6.5" r="4.5" stroke="var(--neutral-400)" strokeWidth="1.25" />
              <path d="M10 10l3 3" stroke="var(--neutral-400)" strokeWidth="1.25" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee # or name…"
              className="w-full rounded-lg py-1.5 pl-8 pr-7 text-xs focus:outline-none"
              style={{ border: "1px solid var(--neutral-200)", color: "var(--neutral-800)", background: "white" }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute text-xs font-semibold"
                style={{ right: 8, top: "50%", transform: "translateY(-50%)", color: "var(--neutral-400)", cursor: "pointer" }}
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>

          {categoryOptions.length > 0 && (
            <Select
              value={categoryFilter || NONE}
              onValueChange={(v) => setCategoryFilter(v === NONE ? "" : v)}
            >
              <SelectTrigger className="h-7 text-xs" style={{ width: 170 }}>
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE} className="text-xs">All categories</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* ── Review table ──────────────────────────────────────────────────── */}
      <div
        className="overflow-x-auto rounded-xl"
        style={{
          background: "white",
          border: "1px solid var(--border)",
          boxShadow: "0 1px 3px rgba(15,15,15,0.04)",
          maxHeight: "calc(100vh - 200px)",
          overflowY: "auto",
        }}
      >
        <table className="min-w-full">
          <thead>
            {/* ── Toolbar row — lives inside thead so it spans the full table width ── */}
            <tr>
              <th
                colSpan={locked ? 12 : 13}
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 30,
                  background: "white",
                  borderBottom: "1px solid var(--neutral-100)",
                  padding: 0,
                }}
              >
                <div className="flex items-center justify-between px-4" style={{ height: 44 }}>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--neutral-400)" }}>
                    {activeFilter
                      ? `${filteredActive.length} of ${activeForStats.length} employees`
                      : `${activeForStats.length} active employees`}
                    {active.length - activeForStats.length > 0 && (
                      <span style={{ color: "var(--neutral-300)", marginLeft: 6 }}>
                        · {active.length - activeForStats.length} excluded
                      </span>
                    )}
                    {activeFilter && (
                      <button
                        onClick={() => setActiveFilter(null)}
                        className="ml-3 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: "var(--neutral-100)", color: "var(--neutral-500)" }}
                      >
                        Clear filter ×
                      </button>
                    )}
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
                        style={{ background: "#0369a1", color: "white", cursor: isDraftZipping ? "not-allowed" : "pointer" }}
                        title="Draft letter PDFs — only for compliance-clean employees with a letter assigned"
                      >
                        {isDraftZipping
                          ? "Zipping…"
                          : `⬇ ${tableSummary.draftReady} draft${tableSummary.draftReady !== 1 ? "s" : ""}`}
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        setIsUkgDraftDownloading(true);
                        try {
                          await downloadDraftUkgUpload(cycleId, site);
                        } catch (err) {
                          alert("Download failed: " + (err instanceof Error ? err.message : String(err)));
                        } finally {
                          setIsUkgDraftDownloading(false);
                        }
                      }}
                      disabled={isUkgDraftDownloading}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                      style={{ background: "white", color: "var(--neutral-600)", border: "1px solid var(--neutral-200)", cursor: isUkgDraftDownloading ? "not-allowed" : "pointer" }}
                      title="Working UKG payroll upload — snapshot of current proposed rates, watermarked DRAFT, not for payroll import"
                    >
                      {isUkgDraftDownloading ? "Preparing…" : "⬇ UKG (draft)"}
                    </button>
                    <button
                      onClick={async () => {
                        setIsRegionalDraftDownloading(true);
                        try {
                          await downloadDraftRegionalExcel(cycleId, site);
                        } catch (err) {
                          alert("Download failed: " + (err instanceof Error ? err.message : String(err)));
                        } finally {
                          setIsRegionalDraftDownloading(false);
                        }
                      }}
                      disabled={isRegionalDraftDownloading}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                      style={{ background: "white", color: "var(--neutral-600)", border: "1px solid var(--neutral-200)", cursor: isRegionalDraftDownloading ? "not-allowed" : "pointer" }}
                      title="Working rates summary — snapshot of current data, watermarked DRAFT"
                    >
                      {isRegionalDraftDownloading ? "Preparing…" : "⬇ Working Excel"}
                    </button>
                  </div>
                </div>
              </th>
            </tr>
            {/* ── Column headers ── */}
            <tr>
              <Th align="left"   onClick={() => toggleSort("emp_num")}>Emp # {sortArrow("emp_num")}</Th>
              <Th align="left"   onClick={() => toggleSort("name")}>Name {sortArrow("name")}</Th>
              <Th align="center">Age</Th>
              <Th align="center">Status</Th>
              <Th align="left"  >Current Award</Th>
              <Th align="left"  >Proposed Award</Th>
              <Th align="left"  >PP Level</Th>
              <Th align="right"  onClick={() => toggleSort("current_rate")}>Current Rate {sortArrow("current_rate")}</Th>
              <Th align="left"  >Change Type</Th>
              <Th align="right" >Input</Th>
              <Th align="right"  onClick={() => toggleSort("proposed_rate")}>Proposed Rate {sortArrow("proposed_rate")}</Th>
              <Th align="center">Letter</Th>
              {!locked && <Th align="center">Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {filteredActive.map((emp) => {
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
                    awardRates={awardRates}
                    ppBands={ppBands}
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
                    onToggleExclude={() => {
                      const next = !row.is_excluded;
                      setRows((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], is_excluded: next } }));
                      saveRow(emp, { is_excluded: next });
                    }}
                  />
                  {expandedId === emp.id && (
                    <tr key={`${emp.id}-panel`}>
                      <td
                        colSpan={locked ? 12 : 13}
                        className="px-5 py-4"
                        style={{
                          borderBottom: "1px solid var(--neutral-100)",
                          background: "var(--neutral-50)",
                        }}
                      >
                        <CompliancePanel
                          emp={emp}
                          compliance={row.compliance}
                          locked={locked || (rows[emp.id]?.is_excluded ?? false)}
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
  onClick,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  history?: boolean;
  onClick?: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider leading-tight${onClick ? " select-none" : ""}`}
      style={{
        textAlign: align,
        background: "#0f172a",
        color: history ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.65)",
        borderLeft: history ? "1px solid rgba(255,255,255,0.1)" : undefined,
        whiteSpace: "nowrap",
        position: "sticky",
        top: "44px",
        zIndex: 10,
        cursor: onClick ? "pointer" : undefined,
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
  Pick<RowState, "change_type" | "change_input" | "proposed_award" | "pp_level" | "notes" | "is_excluded">
>;

function ReviewRow({
  emp,
  row,
  cpiRate,
  locked,
  isExpanded,
  awardRates,
  ppBands,
  onToggleExpand,
  onChange,
  onSave,
  onToggleExclude,
}: {
  emp: EmployeeWithCompliance;
  row: RowState;
  cpiRate: number;
  locked: boolean;
  isExpanded: boolean;
  awardRates: AwardRateSummary[];
  ppBands: PPBand[];
  onToggleExpand: () => void;
  onChange: (field: keyof RowState, value: string) => void;
  onSave: (patch: RowPatch) => void;
  onToggleExclude: () => void;
}) {
  const [showConfirm, setShowConfirm] = React.useState(false);
  const isExcluded = row.is_excluded;
  // When excluded, treat the row as fully locked regardless of site status
  const effectiveLocked = locked || isExcluded;

  // Step 1: reviewer explicitly selected a different award
  const hasAwardChange = Boolean(
    row.proposed_award && row.proposed_award !== emp.current_award
  );
  // Step 2: PP band has been selected (unlocks rate controls)
  const hasPPSelected = Boolean(row.pp_level);
  // Effective award driving the PP options (proposed if changed, otherwise current)
  const effectiveAward = row.proposed_award || emp.current_award;

  const overall = row.compliance.overall;
  const rateHasFail = row.compliance.checks.some(
    (c) => c.label === "Award floor" && c.status === "fail",
  );
  const kind = inputKind(row.change_type);
  const cpiLocked = isCpiLocked(row.change_type);

  // Left-border accent + row tint by compliance status (overridden when excluded)
  const rowAccent = isExcluded ? "var(--neutral-300)"
    : overall === "fail" ? "var(--red-500)"
    : overall === "warn" ? "var(--amber-400)"
    : "transparent";
  const rowBg = isExcluded ? "var(--neutral-50)"
    : overall === "fail" ? "var(--red-50)"
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
        opacity: isExcluded ? 0.55 : 1,
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
        <div
          className="font-semibold"
          style={{ color: isExcluded ? "#94a3b8" : "#0f172a", fontSize: "0.8125rem" }}
        >
          {emp.first_name} {emp.last_name}
        </div>
        {isExcluded && (
          <span className="mt-0.5 inline-block text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
            Excluded
          </span>
        )}
      </td>

      {/* ── Age — only shown for employees 21 or under (junior rate check) */}
      <td className={`${tdBase} text-center`} style={{ color: "var(--neutral-600)" }}>
        {emp.age != null && emp.age <= 21
          ? emp.age
          : <span style={{ color: "var(--neutral-300)" }}>—</span>}
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

      {/* ── Current Award (read-only) ─────────────────────────────────────── */}
      <td className={tdBase} style={{ minWidth: 180 }}>
        <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#0f172a", letterSpacing: "-0.01em" }}>
          {emp.current_award ?? <span style={{ color: "#cbd5e1" }}>—</span>}
        </div>
        {/* PP level + band range as subtle meta */}
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

      {/* ── Proposed Award (dropdown) ─────────────────────────────────────── */}
      <td className={tdBase} style={{ minWidth: 200 }}>
        {awardRates.length > 0 ? (
          <Select
            value={row.proposed_award || emp.current_award || NONE}
            onValueChange={(v) => {
              const selected = v === NONE ? "" : v;
              const isSameLevelAsCurrent = !selected || selected === emp.current_award;
              if (isSameLevelAsCurrent) {
                // Same level → revert to No Change, clear proposed_award + pp_level
                onChange("proposed_award", "");
                onChange("pp_level", "");
                onChange("change_type", "No Change");
                onChange("change_input", "0");
                onSave({ proposed_award: "", pp_level: "", change_type: "No Change", change_input: "0" });
              } else {
                // Different award → clear pp_level and rate controls (letter auto-inferred by backend)
                onChange("proposed_award", selected);
                onChange("pp_level", "");
                onChange("change_type", "No Change");
                onChange("change_input", "0");
                onSave({ proposed_award: selected, pp_level: "", change_type: "No Change", change_input: "0" });
              }
            }}
            disabled={effectiveLocked}
          >
            <SelectTrigger
              className="h-7 w-full text-xs px-2"
              style={
                hasAwardChange
                  ? { borderColor: "#6ee7b7", background: "#f0fdf4", color: "#065f46", fontWeight: 700 }
                  : { borderColor: "var(--neutral-200)", color: "var(--neutral-500)" }
              }
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {awardRates.map((r) => (
                <SelectItem key={r.award_level} value={r.award_level} className="text-xs">
                  <span>{r.award_level}</span>
                  {r.hourly_rate != null && (
                    <span style={{ color: "#94a3b8", marginLeft: 8 }}>{formatRate(r.hourly_rate)}</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : effectiveLocked ? (
          /* Locked + no award rates → show proposed_award as text */
          row.proposed_award ? (
            <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#065f46" }}>
              {row.proposed_award}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: "#94a3b8" }}>—</span>
          )
        ) : (
          <span style={{ fontSize: 11, color: "#94a3b8" }}>No reference data</span>
        )}
        {/* Award change arrow hint */}
        {hasAwardChange && (
          <div style={{ fontSize: 10, color: "#065f46", marginTop: 3 }}>
            ↑ from {emp.current_award ?? "—"}
          </div>
        )}

        {/* Junior rate applied to award floor */}
        {row.compliance.junior_minimum != null && row.compliance.award_minimum != null && (
          <div
            className="mt-2 rounded-md px-2 py-1.5 text-[10px]"
            style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}
          >
            <span className="font-semibold">Junior rate:</span>{" "}
            {row.compliance.junior_pct}% of {formatRate(row.compliance.award_minimum)} = <span className="font-bold">{formatRate(row.compliance.junior_minimum)}</span> min
          </div>
        )}


      </td>

      {/* ── PP Level (separate column) ───────────────────────────────────── */}
      <td className={tdBase} style={{ minWidth: 200, opacity: effectiveAward ? 1 : 0.4 }}>
        <PPLevelPicker
          ppBands={ppBands}
          effectiveAward={effectiveAward}
          value={row.pp_level}
          locked={effectiveLocked || !effectiveAward}
          onSelect={(conv) => {
            onChange("pp_level", conv ?? "");
            onSave({ pp_level: conv });
          }}
        />
        {/* Junior rate applied to PP band range */}
        {row.compliance.junior_pct != null && row.compliance.band_min != null && (() => {
          const pct = row.compliance.junior_pct / 100;
          const jMin = Math.round(row.compliance.band_min * pct * 100) / 100;
          const jMax = row.compliance.band_max != null
            ? Math.round(row.compliance.band_max * pct * 100) / 100
            : null;
          return (
            <div
              className="mt-1.5 rounded px-2 py-1 text-[10px]"
              style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}
            >
              {row.compliance.junior_pct}% → <span className="font-bold">{formatRate(jMin)}{jMax != null ? `–${formatRate(jMax)}` : "+"}</span>
            </div>
          );
        })()}
      </td>

      {/* ── Current rate ────────────────────────────────────────────────── */}
      <td className={`${tdBase} text-right`} style={{ minWidth: 100 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "0.875rem", color: "#334155" }}>
          {emp.current_rate != null ? formatRate(emp.current_rate) : "—"}
        </div>
        {!!annualCurrent && (
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
      <td className={`${tdBase}`} style={{ minWidth: 145, opacity: hasPPSelected ? 1 : 0.4 }}>
        <Select
          value={row.change_type || NONE}
          onValueChange={(v) => {
            const val = v === NONE ? "" : v;
            const vl = val.toLowerCase();
            const ppBandMin = vl === "per admin pp"
              ? ppBands.find((b) => b.convention === row.pp_level)?.band_min ?? null
              : null;
            const awardFloor = row.compliance.junior_minimum ?? row.compliance.award_minimum ?? null;
            const newInput =
              vl === "cpi increase"
                ? String(cpiRate)
                : vl === "per admin pp"
                  ? String(ppBandMin ?? emp.current_rate ?? "")
                  : vl === "fixed rate"
                    ? String(emp.current_rate ?? "")
                    : vl === "bring to award level"
                      ? String(awardFloor ?? emp.current_rate ?? "")
                      : row.change_input;
            onChange("change_type", val);
            onChange("change_input", newInput);
            onSave({ change_type: val, change_input: newInput });
          }}
          disabled={effectiveLocked || !hasPPSelected}
        >
          <SelectTrigger className="h-7 w-full text-xs px-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE} className="text-xs italic" style={{ color: "var(--neutral-400)" }}>
              — select —
            </SelectItem>
            {CHANGE_TYPES.map((t) => (
              <SelectItem key={t} value={t} className="text-xs">{CHANGE_TYPE_LABELS[t] ?? t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>

      {/* ── Input ───────────────────────────────────────────────────────── */}
      <td className={`${tdBase} text-right`} style={{ minWidth: 84, opacity: hasPPSelected ? 1 : 0.4 }}>
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
              readOnly={cpiLocked || !hasPPSelected}
              onChange={(e) => !cpiLocked && hasPPSelected && onChange("change_input", e.target.value)}
              onBlur={(e) => { if (!cpiLocked && hasPPSelected) onSave({ change_input: e.target.value }); }}
              disabled={effectiveLocked || !hasPPSelected}
              className="w-16 rounded border px-1.5 py-1 text-right text-xs tabular-nums focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                borderColor: "var(--neutral-200)",
                background: (cpiLocked || !hasPPSelected || effectiveLocked) ? "var(--neutral-50)" : "white",
                color: "var(--neutral-800)",
                ...mono,
                cursor: (cpiLocked || !hasPPSelected) ? "default" : "text",
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
        {!!annualProposed && (
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
        {/* Auto-inferred — display only */}
        {row.letter_type ? (
          <span
            className="inline-flex items-center justify-center rounded-md text-xs font-bold tabular-nums"
            style={{
              width: 28, height: 28,
              background: "#f1f5f9",
              border: "1px solid #cbd5e1",
              color: "#334155",
            }}
          >
            {row.letter_type}
          </span>
        ) : (
          <span style={{ color: "var(--neutral-300)", fontSize: 12 }}>—</span>
        )}
        {/* Draft PDF download — only when letter assigned and compliance clean */}
        {row.letter_type && ["A", "B", "C"].includes(row.letter_type) &&
         row.compliance.overall === "ok" && row.proposed_rate && (
          <button
            onClick={() =>
              downloadDraftLetter(emp.id).catch((err) =>
                alert(err instanceof Error ? err.message : String(err)),
              )
            }
            className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold transition-colors hover:bg-blue-600 hover:text-white hover:border-blue-600"
            title="Download draft letter"
            style={{
              background: "#0369a1",
              border: "1px solid #0369a1",
              color: "white",
              cursor: "pointer",
            }}
          >
            ⬇ Draft
          </button>
        )}
      </td>

      {/* ── Actions (Exclude / Include) — hidden when site is locked ───── */}
      {!locked && <td className={`${tdBase} text-center`} style={{ minWidth: 90 }}>
        {(
          <>
            {isExcluded ? (
              <button
                onClick={onToggleExclude}
                className="rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors"
                style={{ background: "#dcfce7", color: "#16a34a", border: "1px solid #bbf7d0" }}
              >
                Include
              </button>
            ) : (
              <button
                onClick={() => setShowConfirm(true)}
                className="rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors hover:opacity-80"
                style={{ background: "#fee2e2", color: "#dc2626", border: "1px solid #fecaca" }}
              >
                Exclude
              </button>
            )}
          </>
        )}

        {/* Confirmation dialog */}
        {showConfirm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.4)" }}
            onClick={() => setShowConfirm(false)}
          >
            <div
              className="w-80 rounded-xl p-6 shadow-xl"
              style={{ background: "white", border: "1px solid var(--border)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-1 text-sm font-bold" style={{ color: "#0f172a" }}>
                Exclude employee?
              </div>
              <p className="mb-5 text-xs leading-relaxed" style={{ color: "#64748b" }}>
                <strong style={{ color: "#0f172a" }}>{emp.first_name} {emp.last_name}</strong> will
                be grayed out and excluded from all compliance checks, payroll totals,
                and the submission. You can re-include them at any time.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowConfirm(false); onToggleExclude(); }}
                  className="flex-1 rounded-lg py-2 text-xs font-semibold"
                  style={{ background: "#dc2626", color: "white" }}
                >
                  Yes, exclude
                </button>
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 rounded-lg py-2 text-xs font-semibold"
                  style={{ background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </td>}

    </tr>
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
  // Sort: fail → warn → suppressed → ok
  const ORDER: Record<string, number> = { fail: 0, warn: 1, suppressed: 2, ok: 3 };
  const sorted = [...compliance.checks]
    .filter((c) => !(c.label === "Age check" && c.status === "ok"))
    .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));

  return (
    <div>
      {/* Header row */}
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "#0f172a" }}>
          Compliance — MA000027
        </span>
        {compliance.award_minimum != null && (
          <span className="text-xs" style={{ color: "#64748b" }}>
            Award floor:{" "}
            <strong style={{ color: "#0f172a" }}>
              {compliance.junior_minimum != null
                ? formatRate(compliance.junior_minimum)
                : formatRate(compliance.award_minimum)}
            </strong>
            {compliance.junior_minimum != null && (
              <span style={{ color: "#b45309", marginLeft: 4 }}>({compliance.junior_pct}% junior)</span>
            )}
          </span>
        )}
        {compliance.band_min != null && compliance.band_max != null && (
          <span className="text-xs" style={{ color: "#64748b" }}>
            PP band:{" "}
            <strong style={{ color: "#0f172a" }}>
              {compliance.junior_pct != null
                ? `${formatRate(Math.round(compliance.band_min * compliance.junior_pct / 100 * 100) / 100)} – ${formatRate(Math.round(compliance.band_max * compliance.junior_pct / 100 * 100) / 100)}`
                : `${formatRate(compliance.band_min)} – ${formatRate(compliance.band_max)}`}
            </strong>
          </span>
        )}
      </div>

      {/* All checks — fail/warn prominent, ok/suppressed compact */}
      <div className="space-y-2">
        {sorted.map((check) => (
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
  const canSuppress =
    check.status === "warn" &&
    !locked &&
    !["Pay progression", "PP band minimum"].includes(check.label);
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
                if (e.key === "Enter" && reason.trim()) handleSuppress();
                if (e.key === "Escape") { setShowReason(false); setReason(""); }
              }}
              placeholder="Reason for noting (required)"
              autoFocus
              className="w-full rounded-md border px-2.5 py-1.5 text-xs focus:outline-none"
              style={{ borderColor: "#cbd5e1", background: "white", color: "#374151" }}
            />
            <div className="flex gap-2">
              <button
                onClick={handleSuppress}
                disabled={working || !reason.trim()}
                className="rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
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
  icon, count, label, bg, color, border, active: isActive, onClick,
}: {
  icon: string; count: number; label: string;
  bg: string; color: string; border: string;
  active?: boolean; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all"
      style={{
        background: bg,
        color,
        border: `1px solid ${border}`,
        cursor: onClick ? "pointer" : "default",
        outline: isActive ? `2px solid ${color}` : "none",
        outlineOffset: 1,
        transform: isActive ? "scale(1.03)" : "scale(1)",
      }}
    >
      <span className="text-[13px] leading-none">{icon}</span>
      <span className="tabular-nums font-bold">{count}</span>
      <span style={{ fontWeight: 500 }}>{label}</span>
      {isActive && <span style={{ opacity: 0.6 }}>×</span>}
    </button>
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

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
//  PPLevelPicker — imported from @/components/pp-level-picker (shared with
//  approvals-client so both pages stay in sync).
// ─────────────────────────────────────────────────────────────────────────────
