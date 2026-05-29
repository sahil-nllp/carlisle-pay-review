/**
 * Client-side API helpers for the /cycles endpoints (4-file upload flow).
 */
import { api } from "@/lib/api";

// ── Cycle types ─────────────────────────────────────────────────────────────
export interface Cycle {
  id: number;
  fy_label: string;
  effective_date: string;
  letter_date: string;
  consultation_deadline: string | null;
  cpi_rate: number;
  super_old: number | null;
  super_new: number | null;
  signatory_name: string | null;
  signatory_title: string | null;
  signatory_company: string | null;
  hr_email: string | null;
  status: string;
  reference_data_ready: boolean;
  created_at: string;
}

export interface CycleMetadata {
  fy_label: string;
  effective_date: string;  // YYYY-MM-DD
  letter_date: string;     // YYYY-MM-DD
  cpi_rate: number;
}

// ── Diff types ──────────────────────────────────────────────────────────────
export type DiffKind = "new" | "removed" | "changed" | "unchanged";

export interface EmployeeDiffRow {
  emp_num: string;
  name: string;
  site: string;
  kind: DiffKind;
  changes: Record<string, { old: string | number | null; new: string | number | null }>;
}

// ── Per-file summaries (returned by /upload-files) ──────────────────────────
export interface EmployeeFileSummary {
  filename: string;
  sheet_name: string;
  columns_detected: string[];
  employees_parsed: number;
  warnings: string[];
}

export interface AwardSummaryFileSummary {
  filename: string;
  sheet_name: string;
  award_rates: number;
  off_award_rows: number;
  junior_rates: number;
  warnings: string[];
}

export interface PPFileSummary {
  filename: string;
  sheet_name: string;
  stream: "admin" | "tech";
  bands: number;
  sections: string[];
  warnings: string[];
}

// ── Combined staged-upload response ─────────────────────────────────────────
export interface StagedUpload {
  staging_id: string;
  employee_file: EmployeeFileSummary;
  award_summary: AwardSummaryFileSummary;
  pp_admin: PPFileSummary;
  pp_tech: PPFileSummary;

  current_cycle: Cycle | null;
  employee_diff_summary: {
    new: number; removed: number; changed: number; unchanged: number; total: number;
  };
  employee_diff_preview: EmployeeDiffRow[];
}

export type ApplyMode = "fresh" | "archive" | "merge";

export interface ApplyUploadResponse {
  cycle: Cycle;
  employees_inserted: number;
  employees_updated: number;
  employees_removed: number;
  award_rates_loaded: number;
  pp_bands_loaded: number;
  junior_rates_loaded: number;
}

// ── Calls ────────────────────────────────────────────────────────────────────
export async function getCurrentCycle(): Promise<Cycle | null> {
  return api<Cycle | null>("/api/v1/cycles/current");
}

export async function listCycles(): Promise<Cycle[]> {
  return api<Cycle[]>("/api/v1/cycles");
}

export interface UploadInput {
  employee_file: File;
  award_summary: File;
  pp_admin: File;
  pp_tech: File;
}

export async function uploadFiles(files: UploadInput): Promise<StagedUpload> {
  const fd = new FormData();
  fd.append("employee_file", files.employee_file);
  fd.append("award_summary", files.award_summary);
  fd.append("pp_admin", files.pp_admin);
  fd.append("pp_tech", files.pp_tech);
  return api<StagedUpload>("/api/v1/cycles/upload-files", {
    method: "POST",
    body: fd,
  });
}

export async function applyUpload(args: {
  staging_id: string;
  metadata: CycleMetadata;
  mode: ApplyMode;
}): Promise<ApplyUploadResponse> {
  return api<ApplyUploadResponse>("/api/v1/cycles/apply-upload", {
    method: "POST",
    body: args,
  });
}

export async function cancelUpload(staging_id: string): Promise<void> {
  await api("/api/v1/cycles/cancel-upload", {
    method: "POST",
    body: { staging_id },
  });
}
