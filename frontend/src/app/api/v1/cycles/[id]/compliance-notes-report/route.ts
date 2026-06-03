/**
 * Proxy route: GET /api/v1/cycles/[id]/compliance-notes-report
 *
 * Forwards the request to FastAPI with the session cookie and streams
 * the Excel file back to the browser.
 */
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "carlisle_session";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME)?.value;
  if (!session) {
    return new NextResponse("Unauthorised", { status: 401 });
  }

  const upstream = await fetch(
    `${API_URL}/api/v1/cycles/${id}/compliance-notes-report`,
    { headers: { Cookie: `${COOKIE_NAME}=${session}` } },
  );

  if (!upstream.ok) {
    return new NextResponse(await upstream.text(), { status: upstream.status });
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("Content-Type") ??
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        upstream.headers.get("Content-Disposition") ?? "attachment",
    },
  });
}
