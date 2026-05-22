/**
 * Client-side API helpers for the /review endpoints (Phase 3).
 */
import { api, API_URL } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────────
export interface SiteIssues {
  below_award: number;
  no_proposed_rate: number;
  unknown_level: number;
}

export interface SiteSummary {
  site: string;
  staff: number;
  payroll_current: number;
  payroll_proposed: number;
  issues: SiteIssues;
  approval_status: string;
}

export interface CheckResult {
  status: "ok" | "warn" | "fail" | "suppressed";
  label: string;
  detail: string;
  recommendation: string;
}

export interface SuppressionInfo {
  id: number;
  check_label: string;
  reason: string | null;
  suppressed_by_name: string;
  suppressed_at: string; // ISO datetime string
  undone_by_name: string | null;
  undone_at: string | null;
}

export interface EmployeeCompliance {
  checks: CheckResult[];
  overall: "ok" | "warn" | "fail";
  award_minimum: number | null;
  next_level: string | null;
  band_min: number | null;
  band_max: number | null;
  suppressions: SuppressionInfo[];
}

export interface EmployeeWithCompliance {
  id: number;
  cycle_id: number;
  emp_num: string;
  first_name: string;
  last_name: string;
  email: string | null;
  age: number | null;
  site: string;
  department: string | null;
  category: string | null;
  hours_per_week: number | null;
  fy25_award: string | null;
  current_rate: number | null;
  fy26_award: string | null;
  proposed_award: string | null;  // accepted next-level suggestion
  pp_level: string | null;
  change_type: string | null;
  change_input: number | null;
  proposed_rate: number | null;
  letter_type: string | null;
  notes: string | null;
  is_departed: boolean;

  // Historical compliance snapshot (FY25→FY26, read-only, from Excel)
  hist_award_level_changed: boolean | null;
  hist_rate_changed: boolean | null;
  hist_above_award_rate: boolean | null;
  hist_above_pp_rate: boolean | null;
  hist_above_pp_max: boolean | null;

  compliance: EmployeeCompliance;
}

export interface EmployeePatch {
  // proposed_rate is calculated server-side — send change_type + change_input instead
  change_type?: string | null;
  change_input?: number | null;
  // Accepted next-level suggestion (empty string = clear)
  proposed_award?: string | null;
  // Other editable fields
  pp_level?: string | null;
  letter_type?: string | null;
  notes?: string | null;
}

export interface BulkSuggestResponse {
  updated: number;
  skipped: number;
}

export interface SubmitSiteResponse {
  site: string;
  status: "pending";
  issues_count: number;
}

// ── API calls ────────────────────────────────────────────────────────────────
export async function listSites(cycleId: number): Promise<SiteSummary[]> {
  return api<SiteSummary[]>(`/api/v1/cycles/${cycleId}/sites`);
}

export async function getSiteEmployees(
  cycleId: number,
  site: string,
): Promise<EmployeeWithCompliance[]> {
  return api<EmployeeWithCompliance[]>(
    `/api/v1/cycles/${cycleId}/sites/${encodeURIComponent(site)}/employees`,
  );
}

export async function patchEmployee(
  empId: number,
  patch: EmployeePatch,
): Promise<EmployeeWithCompliance> {
  return api<EmployeeWithCompliance>(`/api/v1/employees/${empId}`, {
    method: "PATCH",
    body: patch,
  });
}

export async function bulkSuggest(
  cycleId: number,
  site?: string,
): Promise<BulkSuggestResponse> {
  return api<BulkSuggestResponse>(`/api/v1/cycles/${cycleId}/bulk-suggest`, {
    method: "POST",
    body: { site: site ?? null },
  });
}

export async function submitSite(
  cycleId: number,
  site: string,
): Promise<SubmitSiteResponse> {
  return api<SubmitSiteResponse>(
    `/api/v1/cycles/${cycleId}/sites/${encodeURIComponent(site)}/submit`,
    { method: "POST" },
  );
}

export interface BulkAssignLettersResponse {
  updated: number;
  skipped: number;
}

export async function bulkAssignLetters(
  cycleId: number,
  site: string,
): Promise<BulkAssignLettersResponse> {
  return api<BulkAssignLettersResponse>(
    `/api/v1/cycles/${cycleId}/sites/${encodeURIComponent(site)}/assign-letters`,
    { method: "POST" },
  );
}

export async function suppressCheck(
  empId: number,
  checkLabel: string,
  reason?: string,
): Promise<EmployeeWithCompliance> {
  return api<EmployeeWithCompliance>(`/api/v1/employees/${empId}/suppress-check`, {
    method: "POST",
    body: { check_label: checkLabel, reason: reason ?? null },
  });
}

export async function unsuppressCheck(
  empId: number,
  checkLabel: string,
): Promise<EmployeeWithCompliance> {
  return api<EmployeeWithCompliance>(
    `/api/v1/employees/${empId}/suppress-check/${encodeURIComponent(checkLabel)}`,
    { method: "DELETE" },
  );
}

// ── Draft letter downloads ────────────────────────────────────────────────────
// Use programmatic fetch (credentials: "include") so the session cookie is sent
// to the FastAPI backend, then trigger a synthetic <a> click to save the blob.

async function _triggerBlobDownload(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => res.text());
    const detail =
      typeof body === "object" && body !== null && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : typeof body === "string"
          ? body
          : `HTTP ${res.status}`;
    throw new Error(detail);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const fnMatch = disposition.match(/filename="([^"]+)"/);
  const filename = fnMatch ? fnMatch[1] : fallbackName;

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

/** Download a single employee's DRAFT pay-letter PDF. */
export async function downloadDraftLetter(empId: number): Promise<void> {
  await _triggerBlobDownload(
    `${API_URL}/api/v1/employees/${empId}/draft-letter`,
    `draft-letter-${empId}.pdf`,
  );
}

/** Download all ready DRAFT pay-letter PDFs as a ZIP. */
export async function downloadDraftLettersZip(cycleId: number, site: string): Promise<void> {
  await _triggerBlobDownload(
    `${API_URL}/api/v1/cycles/${cycleId}/sites/${encodeURIComponent(site)}/draft-letters.zip`,
    `draft-letters-${site}.zip`,
  );
}
