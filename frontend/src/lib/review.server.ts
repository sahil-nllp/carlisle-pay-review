/**
 * Server-only review fetchers (use in Server Components).
 * Forwards the session cookie so the backend can authenticate.
 */
import "server-only";

import { cookies } from "next/headers";

import type { EmployeeWithCompliance, SiteSummary } from "@/lib/review";

const API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "carlisle_session";

async function serverFetch<T>(path: string): Promise<T | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME)?.value;
  if (!session) return null;
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { Cookie: `${COOKIE_NAME}=${session}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getSiteSummariesServer(
  cycleId: number,
): Promise<SiteSummary[]> {
  const data = await serverFetch<SiteSummary[]>(`/api/v1/cycles/${cycleId}/sites`);
  return data ?? [];
}

export async function getSiteEmployeesServer(
  cycleId: number,
  site: string,
): Promise<EmployeeWithCompliance[]> {
  const data = await serverFetch<EmployeeWithCompliance[]>(
    `/api/v1/cycles/${cycleId}/sites/${encodeURIComponent(site)}/employees`,
  );
  return data ?? [];
}
