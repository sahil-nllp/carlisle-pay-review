/**
 * Server-only approvals fetcher (use in Server Components).
 */
import "server-only";

import { cookies } from "next/headers";

import type { ApprovalDetail } from "@/lib/approvals";

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

export async function getApprovalsServer(
  cycleId: number,
): Promise<ApprovalDetail[]> {
  const data = await serverFetch<ApprovalDetail[]>(
    `/api/v1/cycles/${cycleId}/approvals`,
  );
  return data ?? [];
}
