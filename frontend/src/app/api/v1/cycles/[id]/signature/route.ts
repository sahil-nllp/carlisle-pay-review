/**
 * Proxy: GET/POST/DELETE /api/v1/cycles/[id]/signature
 */
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "carlisle_session";

async function sessionHeader(): Promise<Record<string, string>> {
  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME)?.value;
  return session ? { Cookie: `${COOKIE_NAME}=${session}` } : {};
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await sessionHeader();
  const upstream = await fetch(`${API_URL}/api/v1/cycles/${id}/signature`, { headers });
  if (!upstream.ok) return new NextResponse(null, { status: upstream.status });
  return new NextResponse(upstream.body, {
    status: 200,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "image/png" },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await sessionHeader();
  const body = await req.arrayBuffer();
  const contentType = req.headers.get("content-type") ?? "multipart/form-data";
  const upstream = await fetch(`${API_URL}/api/v1/cycles/${id}/signature`, {
    method: "POST",
    headers: { ...headers, "content-type": contentType },
    body,
  });
  const text = await upstream.text();
  return new NextResponse(text, { status: upstream.status, headers: { "Content-Type": "application/json" } });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await sessionHeader();
  const upstream = await fetch(`${API_URL}/api/v1/cycles/${id}/signature`, { method: "DELETE", headers });
  return new NextResponse(null, { status: upstream.status });
}
