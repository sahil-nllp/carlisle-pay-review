/**
 * Thin fetch wrapper for talking to the FastAPI backend.
 *
 * - Sends cookies (credentials: 'include') so session auth works
 * - Throws on non-2xx so callers don't have to check response.ok
 * - Lets you pass typed shapes for response bodies
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message?: string,
  ) {
    // Extract FastAPI's `detail` string so callers get a human-readable message
    const detail =
      typeof body === "object" && body !== null && "detail" in body
        ? typeof (body as { detail: unknown }).detail === "string"
          ? (body as { detail: string }).detail
          : undefined
        : typeof body === "string"
          ? body
          : undefined;
    super(message ?? detail ?? `API error ${status}`);
  }
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

export async function api<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, query, headers, ...rest } = options;

  // Build query string
  let url = `${API_URL}${path}`;
  if (query) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) sp.set(k, String(v));
    }
    const qs = sp.toString();
    if (qs) url += `?${qs}`;
  }

  // If body is FormData, let the browser set Content-Type (with boundary).
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const mergedHeaders: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(headers as Record<string, string> | undefined),
  };

  const init: RequestInit = {
    ...rest,
    credentials: "include",
    headers: mergedHeaders,
  };

  if (body !== undefined) {
    if (isFormData) {
      init.body = body as FormData;
    } else if (typeof body === "string") {
      init.body = body;
    } else {
      init.body = JSON.stringify(body);
    }
  }

  const res = await fetch(url, init);

  // 204 No Content
  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    throw new ApiError(res.status, payload);
  }

  return payload as T;
}
