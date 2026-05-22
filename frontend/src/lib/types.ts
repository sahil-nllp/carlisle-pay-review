/**
 * Shared types mirroring the backend Pydantic schemas.
 *
 * Keep these in sync with backend/app/schemas/*.py
 */

export type UserRole =
  | "hr_admin"
  | "regional_manager"
  | "senior_management"
  | "payroll";

export interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  site: string | null;
  is_active: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
}
