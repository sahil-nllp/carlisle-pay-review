/**
 * Client-side API helpers for the approvals endpoints (Phase 4).
 */
import { api, API_URL } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────────
export interface ApprovalDetail {
  id: number;
  site: string;
  status: "pending" | "approved" | "changes_requested";

  staff: number;
  payroll_current: number;
  payroll_proposed: number;
  hard_issues: number;
  warn_count: number;

  submitted_by: string | null;
  submitted_at: string | null;
  submission_notes: string | null;

  decided_by: string | null;
  decided_at: string | null;
  decision_notes: string | null;
}

export interface DecideRequest {
  decision: "approve" | "request_changes";
  comment?: string | null;
}

export interface DecideResponse {
  site: string;
  status: "approved" | "changes_requested";
}

// ── API calls ────────────────────────────────────────────────────────────────
export async function listApprovals(cycleId: number): Promise<ApprovalDetail[]> {
  return api<ApprovalDetail[]>(`/api/v1/cycles/${cycleId}/approvals`);
}

export async function decideSite(
  cycleId: number,
  site: string,
  body: DecideRequest,
): Promise<DecideResponse> {
  return api<DecideResponse>(
    `/api/v1/cycles/${cycleId}/sites/${encodeURIComponent(site)}/decide`,
    { method: "POST", body },
  );
}

export async function regenerateSiteFiles(
  cycleId: number,
  site: string,
): Promise<{ regenerated: number; site: string }> {
  return api<{ regenerated: number; site: string }>(
    `/api/v1/cycles/${cycleId}/sites/${encodeURIComponent(site)}/regenerate-files`,
    { method: "POST" },
  );
}

/** Reverse an "approved" decision back to pending — clears the generated
 * output files, since they no longer reflect an approved state. */
export async function undoApproval(
  cycleId: number,
  site: string,
): Promise<{ site: string; status: "pending" }> {
  return api<{ site: string; status: "pending" }>(
    `/api/v1/cycles/${cycleId}/sites/${encodeURIComponent(site)}/undo-approval`,
    { method: "POST" },
  );
}

/** Re-generate output files for every currently-approved site in the cycle. */
export async function regenerateAllFiles(
  cycleId: number,
): Promise<{ sites_regenerated: number; files_regenerated: number }> {
  return api<{ sites_regenerated: number; files_regenerated: number }>(
    `/api/v1/cycles/${cycleId}/regenerate-all-files`,
    { method: "POST" },
  );
}

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

/** Download a combined mail-merge .xlsm covering every approved site's
 * employees for the given letter type. Generated fresh on each call. */
export async function downloadMailmergeAllSites(
  cycleId: number,
  letterType: "A" | "B" | "C",
): Promise<void> {
  await _triggerBlobDownload(
    `${API_URL}/api/v1/cycles/${cycleId}/mailmerge-all/${letterType}.xlsm`,
    `mailmerge-letter-${letterType}-all-sites.xlsm`,
  );
}
