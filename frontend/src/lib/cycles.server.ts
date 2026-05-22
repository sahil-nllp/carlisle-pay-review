/**
 * Server-only cycle fetchers (use in Server Components).
 *
 * Forwards the session cookie so the backend can authenticate the request.
 */
import "server-only";

import { cookies } from "next/headers";

import type { Cycle, EmployeeDiffRow } from "@/lib/cycles";

export interface EmployeeRow {
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
  pp_level: string | null;
  change_type: string | null;
  proposed_rate: number | null;
  letter_type: string | null;
  notes: string | null;
  is_departed: boolean;
}

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

export async function getCurrentCycleServer(): Promise<Cycle | null> {
  return serverFetch<Cycle>("/api/v1/cycles/current");
}

export async function getCycleEmployeesServer(
  cycleId: number,
): Promise<EmployeeRow[]> {
  const data = await serverFetch<EmployeeRow[]>(
    `/api/v1/cycles/${cycleId}/employees`,
  );
  return data ?? [];
}

// (Unused export kept so this module's diff type is available wherever needed)
export type { EmployeeDiffRow };
