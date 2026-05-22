/**
 * Server-only downloads fetcher (use in Server Components).
 */
import "server-only";

import { cookies } from "next/headers";

const API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "carlisle_session";

export interface DownloadFile {
  id: number;
  site: string;
  file_type: string;
  label: string;
  filename: string;
  file_size: number | null;
  created_at: string | null;
}

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

export async function getDownloadsServer(cycleId: number): Promise<DownloadFile[]> {
  const data = await serverFetch<DownloadFile[]>(`/api/v1/cycles/${cycleId}/downloads`);
  return data ?? [];
}
