/**
 * Server-only auth helpers.
 *
 * Reads the session cookie from the incoming request and asks the backend
 * who the user is. Returns null if not authenticated.
 *
 * This file MUST NOT be imported from client components — it uses
 * `next/headers`, which is server-only.
 */
import "server-only";

import { cookies } from "next/headers";

import type { User } from "@/lib/types";

const API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "carlisle_session";

export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME)?.value;
  if (!session) return null;

  try {
    const res = await fetch(`${API_URL}/api/v1/auth/me`, {
      headers: { Cookie: `${COOKIE_NAME}=${session}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as User;
  } catch {
    return null;
  }
}
