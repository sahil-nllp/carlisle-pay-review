/**
 * Admin API helpers (client-side).
 */
import { api } from "@/lib/api";

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: string;
  site: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface CreateUserRequest {
  email: string;
  name: string;
  password: string;
  role: string;
  site: string | null;
}

export interface PatchUserRequest {
  name?: string;
  role?: string;
  site?: string | null;
  is_active?: boolean;
  password?: string;
}

export interface AuditEntry {
  id: number;
  timestamp: string;
  user_id: number | null;
  user_name: string | null;
  user_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  detail: Record<string, unknown> | null;
}

export interface AuditPage {
  total: number;
  page: number;
  page_size: number;
  items: AuditEntry[];
}

export interface CycleSettingsRequest {
  letter_date?: string;
  effective_date?: string;
  consultation_deadline?: string | null;
  cpi_rate?: number;
  super_old?: number | null;
  super_new?: number | null;
  signatory_name?: string | null;
  signatory_title?: string | null;
  signatory_company?: string | null;
  hr_email?: string | null;
}

// Users
export const listUsers = () => api<AdminUser[]>("/api/v1/admin/users");

export const createUser = (body: CreateUserRequest) =>
  api<AdminUser>("/api/v1/admin/users", { method: "POST", body: JSON.stringify(body) });

export const patchUser = (id: number, body: PatchUserRequest) =>
  api<AdminUser>(`/api/v1/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

// Audit
export const listAudit = (page = 1, pageSize = 50) =>
  api<AuditPage>(`/api/v1/admin/audit?page=${page}&page_size=${pageSize}`);

// Cycle settings
export const updateCycleSettings = (cycleId: number, body: CycleSettingsRequest) =>
  api(`/api/v1/cycles/${cycleId}/settings`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

// Data management
export interface ClearDataResult {
  cycles_deleted: number;
  employees_deleted: number;
  approvals_deleted: number;
  files_deleted: number;
  storage_cleared: boolean;
}

export const clearAllData = () =>
  api<ClearDataResult>("/api/v1/admin/clear-data", { method: "POST" });
