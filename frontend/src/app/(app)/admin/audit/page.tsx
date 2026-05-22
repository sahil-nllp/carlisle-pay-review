import { getAuditServer } from "@/lib/admin.server";

const ACTION_BADGE: Record<string, { bg: string; color: string }> = {
  login:                     { bg: "var(--neutral-100)",  color: "var(--neutral-600)"  },
  logout:                    { bg: "var(--neutral-100)",  color: "var(--neutral-600)"  },
  upload_wage_model_staged:  { bg: "var(--blue-100)",     color: "var(--blue-700)"     },
  upload_wage_model_applied: { bg: "var(--blue-100)",     color: "var(--blue-700)"     },
  upload_wage_model_cancelled:{ bg: "var(--neutral-100)", color: "var(--neutral-600)"  },
  bulk_suggest_rates:        { bg: "var(--violet-100)",   color: "var(--violet-700)"   },
  site_submitted:            { bg: "var(--amber-100)",    color: "var(--amber-700)"    },
  site_approved:             { bg: "var(--green-100)",    color: "var(--green-700)"    },
  site_approvedd:            { bg: "var(--green-100)",    color: "var(--green-700)"    },
  site_request_changesd:     { bg: "var(--red-100)",      color: "var(--red-700)"      },
  create_user:               { bg: "var(--blue-100)",     color: "var(--blue-700)"     },
  update_user:               { bg: "var(--amber-100)",    color: "var(--amber-700)"    },
  update_cycle_settings:     { bg: "var(--violet-100)",   color: "var(--violet-700)"   },
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const data = await getAuditServer(page);

  return (
    <div style={{ animation: "slideUp 0.4s ease both" }}>
      {/* Description */}
      <p className="mb-6 text-xs" style={{ color: "var(--neutral-500)" }}>
        Every state-changing action across the platform.
      </p>

      {!data || data.items.length === 0 ? (
        <div
          className="rounded-xl p-12 text-center"
          style={{ background: "white", border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(15,15,15,0.04)" }}
        >
          <p className="text-sm" style={{ color: "var(--neutral-600)" }}>No audit entries yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs" style={{ color: "var(--neutral-500)" }}>
              {data.total} total entries · page {data.page} of {Math.ceil(data.total / data.page_size)}
            </p>
          </div>

          <div
            className="overflow-hidden rounded-xl"
            style={{ background: "white", border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(15,15,15,0.04)" }}
          >
            <table className="min-w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Timestamp", "User", "Action", "Entity", "Detail"].map((h, i) => (
                    <th
                      key={h + i}
                      className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider"
                      style={{ background: "var(--neutral-50)", color: "var(--neutral-500)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((entry, idx) => {
                  const badge = ACTION_BADGE[entry.action] ?? { bg: "var(--neutral-100)", color: "var(--neutral-600)" };
                  return (
                    <tr
                      key={entry.id}
                      style={{ borderBottom: idx < data.items.length - 1 ? "1px solid var(--neutral-100)" : "none" }}
                    >
                      <td
                        className="px-5 py-2.5 text-xs whitespace-nowrap tabular-nums"
                        style={{ color: "var(--neutral-500)", fontFamily: "var(--font-mono)" }}
                      >
                        {formatDate(entry.timestamp)}
                      </td>
                      <td className="px-5 py-2.5">
                        {entry.user_name ? (
                          <div>
                            <div className="text-xs font-semibold" style={{ color: "var(--neutral-800)" }}>
                              {entry.user_name}
                            </div>
                            <div className="text-xs" style={{ color: "var(--neutral-400)" }}>
                              {entry.user_email}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: "var(--neutral-400)" }}>System</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5">
                        <span
                          className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                          style={{ background: badge.bg, color: badge.color }}
                        >
                          {entry.action.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-xs" style={{ color: "var(--neutral-600)" }}>
                        {entry.entity_type ? (
                          <span style={{ fontFamily: "var(--font-mono)" }}>
                            {entry.entity_type} #{entry.entity_id}
                          </span>
                        ) : (
                          <span style={{ color: "var(--neutral-300)" }}>—</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-xs max-w-xs truncate" style={{ color: "var(--neutral-500)" }}>
                        {entry.detail ? (
                          <span title={JSON.stringify(entry.detail, null, 2)}>
                            {Object.entries(entry.detail)
                              .slice(0, 3)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(" · ")}
                          </span>
                        ) : (
                          <span style={{ color: "var(--neutral-300)" }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data.total > data.page_size && (
            <div className="flex items-center gap-2">
              {page > 1 && (
                <a
                  href={`?page=${page - 1}`}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={{ border: "1px solid var(--border)", background: "white", color: "var(--neutral-700)" }}
                >
                  ← Previous
                </a>
              )}
              {page * data.page_size < data.total && (
                <a
                  href={`?page=${page + 1}`}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={{ border: "1px solid var(--border)", background: "white", color: "var(--neutral-700)" }}
                >
                  Next →
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}
