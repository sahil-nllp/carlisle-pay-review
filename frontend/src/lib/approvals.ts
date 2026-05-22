/**
 * Client-side API helpers for the approvals endpoints (Phase 4).
 */
import { api } from "@/lib/api";

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
