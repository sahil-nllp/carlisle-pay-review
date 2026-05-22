/**
 * Client-side API helpers for the /cycles endpoints.
 */
import { api } from "@/lib/api";

// ── Types (mirror backend schemas) ──────────────────────────────────────────
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
  wage_model_filename: string | null;
  created_at: string;
}

export interface CycleMetadata {
  fy_label: string;
  effective_date: string;  // YYYY-MM-DD
  letter_date: string;     // YYYY-MM-DD
  cpi_rate: number;
}

export type DiffKind = "new" | "removed" | "changed" | "unchanged";

export interface EmployeeDiffRow {
  emp_num: string;
  name: string;
  site: string;
  kind: DiffKind;
  changes: Record<string, { old: string | number | null; new: string | number | null }>;
}

export interface UploadStaged {
  staging_id: string;
  filename: string;
  sheet_name: string;
  columns_detected: string[];
  row_count: number;
  warnings: string[];
  current_cycle: Cycle | null;
  summary: { new: number; removed: number; changed: number; unchanged: number; total: number };
  preview: EmployeeDiffRow[];
}

export type ApplyMode = "fresh" | "archive" | "merge";

export interface UploadApplyResponse {
  cycle: Cycle;
  employees_inserted: number;
  employees_updated: number;
  employees_removed: number;
}

// ── Calls ────────────────────────────────────────────────────────────────────
export async function getCurrentCycle(): Promise<Cycle | null> {
  return api<Cycle | null>("/api/v1/cycles/current");
}

export async function listCycles(): Promise<Cycle[]> {
  return api<Cycle[]>("/api/v1/cycles");
}

export async function uploadWageModel(file: File): Promise<UploadStaged> {
  const fd = new FormData();
  fd.append("file", file);
  return api<UploadStaged>("/api/v1/cycles/upload", {
    method: "POST",
    body: fd,
  });
}

export async function applyUpload(args: {
  staging_id: string;
  filename: string;
  metadata: CycleMetadata;
  mode: ApplyMode;
}): Promise<UploadApplyResponse> {
  return api<UploadApplyResponse>("/api/v1/cycles/upload/apply", {
    method: "POST",
    body: args,
  });
}

export async function cancelUpload(staging_id: string): Promise<void> {
  await api("/api/v1/cycles/upload/cancel", {
    method: "POST",
    body: { staging_id },
  });
}
