"use client";

import { useState } from "react";

import type { DownloadFile } from "@/lib/downloads.server";
import { regenerateSiteFiles } from "@/lib/approvals";

interface Props {
  cycleId: number;
  bySite: Record<string, DownloadFile[]>;
}

export default function DownloadsClient({ cycleId, bySite }: Props) {
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [regenDone, setRegenDone] = useState<Set<string>>(new Set());
  const [regenError, setRegenError] = useState<Record<string, string>>({});

  // After regeneration the page data is stale — reload to pick up the new file records
  async function handleRegenerate(site: string) {
    setRegenerating(site);
    setRegenError((prev) => { const n = { ...prev }; delete n[site]; return n; });
    try {
      const res = await regenerateSiteFiles(cycleId, site);
      setRegenDone((prev) => new Set([...prev, site]));
      // Brief delay so the user sees the "Done" state, then reload
      setTimeout(() => {
        window.location.reload();
      }, 800);
      void res;
    } catch (err) {
      setRegenError((prev) => ({
        ...prev,
        [site]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setRegenerating(null);
    }
  }

  const entries = Object.entries(bySite).sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) {
    return (
      <div
        className="rounded-xl p-12 text-center"
        style={{
          background: "white",
          border: "1px solid var(--border)",
          boxShadow: "0 1px 3px rgba(15,15,15,0.04)",
        }}
      >
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: "var(--neutral-100)" }}
        >
          <svg width="20" height="20" viewBox="0 0 15 15" fill="none">
            <path d="M7.5 1.5v8M4.5 7l3 3 3-3" stroke="var(--neutral-400)" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 11.5v1a1 1 0 001 1h9a1 1 0 001-1v-1" stroke="var(--neutral-400)" strokeWidth="1.25" strokeLinecap="round"/>
          </svg>
        </div>
        <p className="text-sm font-semibold" style={{ color: "var(--neutral-700)" }}>
          No files generated yet
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--neutral-500)" }}>
          Files are generated automatically when a site is approved.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {entries.map(([site, siteFiles]) => {
        const isRegenerating = regenerating === site;
        const isDone = regenDone.has(site);
        const error = regenError[site];

        return (
          <div
            key={site}
            className="overflow-hidden rounded-xl"
            style={{
              background: "white",
              border: "1px solid var(--border)",
              boxShadow: "0 1px 3px rgba(15,15,15,0.04)",
            }}
          >
            {/* Site header */}
            <div
              className="flex items-center gap-3 px-5 py-3"
              style={{ borderBottom: "1px solid var(--neutral-100)", background: "var(--neutral-50)" }}
            >
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
                style={{ background: "var(--brand-light)" }}
              >
                <svg width="11" height="11" viewBox="0 0 15 15" fill="none">
                  <rect x="1" y="1" width="5.5" height="5.5" rx="1" stroke="var(--brand)" strokeWidth="1.5"/>
                  <rect x="8.5" y="1" width="5.5" height="5.5" rx="1" stroke="var(--brand)" strokeWidth="1.5"/>
                  <rect x="1" y="8.5" width="5.5" height="5.5" rx="1" stroke="var(--brand)" strokeWidth="1.5"/>
                  <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" stroke="var(--brand)" strokeWidth="1.5"/>
                </svg>
              </div>
              <span className="text-sm font-bold" style={{ color: "var(--neutral-900)" }}>
                {site}
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-xs font-semibold"
                style={{ background: "var(--green-100)", color: "var(--green-700)" }}
              >
                Approved
              </span>

              {/* Regenerate button */}
              <button
                onClick={() => handleRegenerate(site)}
                disabled={isRegenerating || isDone}
                className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all"
                style={{
                  background: isDone
                    ? "var(--green-50)"
                    : isRegenerating
                    ? "var(--neutral-100)"
                    : "var(--neutral-100)",
                  color: isDone
                    ? "var(--green-700)"
                    : isRegenerating
                    ? "var(--neutral-400)"
                    : "var(--neutral-600)",
                  border: `1px solid ${isDone ? "var(--green-200)" : "var(--neutral-200)"}`,
                  cursor: isRegenerating || isDone ? "not-allowed" : "pointer",
                }}
                title="Re-generate all output files for this site (e.g. to get PDFs after a code update)"
              >
                {isDone ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 15 15" fill="none">
                      <path d="M2 8l4 4 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Regenerated
                  </>
                ) : isRegenerating ? (
                  <>
                    <svg className="animate-spin" width="11" height="11" viewBox="0 0 15 15" fill="none">
                      <path d="M7.5 1.5A6 6 0 1 1 1.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    Regenerating…
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 15 15" fill="none">
                      <path d="M1.5 7.5A6 6 0 0 1 13 4.5M13.5 7.5A6 6 0 0 1 2 10.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
                      <path d="M11 2.5l2 2-2 2M4 8.5l-2 2 2 2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Regenerate files
                  </>
                )}
              </button>
            </div>

            {/* Error message */}
            {error && (
              <div
                className="px-5 py-2 text-xs"
                style={{ background: "var(--red-50)", color: "var(--red-700)", borderBottom: "1px solid var(--red-100)" }}
              >
                Regeneration failed: {error}
              </div>
            )}

            {/* Files */}
            <div>
              {siteFiles.map((f, idx) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between px-5 py-3.5"
                  style={{
                    borderTop: idx > 0 ? "1px solid var(--neutral-100)" : "none",
                  }}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: fileTypeColor(f.file_type).bg }}
                    >
                      <FileIcon type={f.file_type} color={fileTypeColor(f.file_type).color} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold" style={{ color: "var(--neutral-900)" }}>
                        {f.label}
                      </div>
                      <div
                        className="mt-0.5 flex items-center gap-2 text-xs"
                        style={{ color: "var(--neutral-400)", fontFamily: "var(--font-mono)" }}
                      >
                        <span>{f.filename}</span>
                        {f.file_size != null && (
                          <>
                            <span style={{ color: "var(--neutral-200)" }}>·</span>
                            <span>{formatBytes(f.file_size)}</span>
                          </>
                        )}
                        {f.created_at && (
                          <>
                            <span style={{ color: "var(--neutral-200)" }}>·</span>
                            <span>{formatDate(f.created_at)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <a
                    href={`/api/v1/downloads/${f.id}`}
                    download={f.filename}
                    className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors"
                    style={{ background: "var(--brand)", color: "white" }}
                  >
                    <svg width="11" height="11" viewBox="0 0 15 15" fill="none">
                      <path d="M7.5 1.5v8M4.5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M2 11.5v1a1 1 0 001 1h9a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    Download
                  </a>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function fileTypeColor(type: string): { bg: string; color: string } {
  const map: Record<string, { bg: string; color: string }> = {
    letters_zip:    { bg: "var(--blue-50)",    color: "var(--blue-700)"   },
    ukg_upload:     { bg: "var(--violet-100)", color: "var(--violet-700)" },
    regional_excel: { bg: "var(--green-50)",   color: "var(--green-700)"  },
  };
  return map[type] ?? { bg: "var(--neutral-100)", color: "var(--neutral-600)" };
}

function FileIcon({ type, color }: { type: string; color: string }) {
  if (type === "letters_zip") {
    return (
      <svg width="16" height="16" viewBox="0 0 15 15" fill="none">
        <rect x="1.5" y="2" width="12" height="11" rx="1.5" stroke={color} strokeWidth="1.25"/>
        <path d="M5 5.5h5M5 8h5M5 10.5h3" stroke={color} strokeWidth="1.25" strokeLinecap="round"/>
      </svg>
    );
  }
  if (type === "ukg_upload") {
    return (
      <svg width="16" height="16" viewBox="0 0 15 15" fill="none">
        <path d="M7.5 10V2M4.5 5l3-3 3 3" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 11.5v1a1 1 0 001 1h9a1 1 0 001-1v-1" stroke={color} strokeWidth="1.25" strokeLinecap="round"/>
      </svg>
    );
  }
  if (type === "regional_excel") {
    return (
      <svg width="16" height="16" viewBox="0 0 15 15" fill="none">
        <rect x="1" y="1" width="13" height="13" rx="1.5" stroke={color} strokeWidth="1.25"/>
        <path d="M1 5h13M5 5v9M5 1v4" stroke={color} strokeWidth="1.25"/>
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 15 15" fill="none">
      <rect x="2" y="1" width="11" height="13" rx="1.5" stroke={color} strokeWidth="1.25"/>
      <path d="M5 5h5M5 8h5M5 11h3" stroke={color} strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
