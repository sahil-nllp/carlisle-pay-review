/**
 * Client-safe auth helpers — login, logout, and `fetchMe`.
 *
 * For server-side user resolution (Server Components, Route Handlers), use
 * `getCurrentUser` from `@/lib/auth.server`.
 */
import { ApiError, api } from "@/lib/api";
import type { LoginRequest, LoginResponse, User } from "@/lib/types";

export async function login(credentials: LoginRequest): Promise<LoginResponse> {
  return api<LoginResponse>("/api/v1/auth/login", {
    method: "POST",
    body: credentials,
  });
}

export async function logout(): Promise<void> {
  try {
    await api("/api/v1/auth/logout", { method: "POST" });
  } catch (err) {
    // Even if backend errors, treat as logged out client-side
    if (!(err instanceof ApiError) || err.status !== 401) {
      throw err;
    }
  }
}

export async function fetchMe(): Promise<User | null> {
  try {
    return await api<User>("/api/v1/auth/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}
