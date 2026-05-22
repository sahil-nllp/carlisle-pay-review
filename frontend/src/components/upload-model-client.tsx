"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@/lib/api";
import {
  applyUpload,
  cancelUpload,
  uploadWageModel,
  type ApplyMode,
  type CycleMetadata,
  type UploadStaged,
} from "@/lib/cycles";

type Step = "select" | "uploading" | "compare" | "applying" | "done" | "error";

export function UploadModelClient() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("select");
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<UploadStaged | null>(null);

  // Form fields (defaults are sensible for the next FY)
  const today = new Date();
  const fyEnd = today.getMonth() >= 6 ? today.getFullYear() + 1 : today.getFullYear();
  const defaultMeta: CycleMetadata = {
    fy_label: `FY${fyEnd}-${(fyEnd + 1).toString().slice(-2)}`,
    effective_date: `${fyEnd}-07-01`,
    letter_date: `${fyEnd}-07-11`,
    cpi_rate: 3.5,
  };
  const [meta, setMeta] = useState<CycleMetadata>(defaultMeta);

  async function onSelectFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setStep("uploading");
    setError(null);
    try {
      const result = await uploadWageModel(f);
      setStaged(result);
      setStep("compare");
    } catch (err) {
      setStep("error");
      setError(formatError(err));
    } finally {
      // reset input so re-selecting the same file fires onChange again
      e.target.value = "";
    }
  }

  async function onApply(mode: ApplyMode) {
    if (!staged) return;
    setStep("applying");
    setError(null);
    try {
      await applyUpload({
        staging_id: staged.staging_id,
        filename: staged.filename,
        metadata: meta,
        mode,
      });
      setStep("done");
    } catch (err) {
      setStep("error");
      setError(formatError(err));
    }
  }

  async function onCancel() {
    if (staged) {
      try {
        await cancelUpload(staged.staging_id);
      } catch {
        /* ignore */
      }
    }
    setStaged(null);
    setStep("select");
    setError(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (step === "done") {
    return (
      <SuccessCard
        onContinue={() => {
          router.refresh();
          router.push("/dashboard");
        }}
      />
    );
  }

  if (step === "compare" && staged) {
    return (
      <CompareView
        staged={staged}
        meta={meta}
        onMetaChange={setMeta}
        onApply={onApply}
        onCancel={onCancel}
      />
    );
  }

  return (
    <SelectView
      step={step}
      error={error}
      onSelectFile={onSelectFile}
      onClearError={() => {
        setError(null);
        setStep("select");
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Subviews
// ─────────────────────────────────────────────────────────────────────────────
function SelectView({
  step,
  error,
  onSelectFile,
  onClearError,
}: {
  step: Step;
  error: string | null;
  onSelectFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearError: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">
        Upload approved wage model
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Accepts .xlsx or .xlsm files up to 50 MB. The file will be parsed and you'll
        get a diff preview before any changes are committed.
      </p>

      <label className="mt-6 flex cursor-pointer flex-col items-center justify-center
                        rounded-lg border-2 border-dashed border-slate-300 bg-slate-50
                        px-6 py-12 transition hover:border-slate-400 hover:bg-slate-100">
        <input
          type="file"
          accept=".xlsx,.xlsm"
          onChange={onSelectFile}
          disabled={step === "uploading"}
          className="sr-only"
        />
        <div className="text-center">
          <div className="text-sm font-medium text-slate-700">
            {step === "uploading" ? "Uploading…" : "Choose a file"}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            or drag and drop coming soon
          </div>
        </div>
      </label>

      {error && (
        <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
          <div className="text-sm font-medium text-rose-800">Upload failed</div>
          <div className="mt-1 text-xs text-rose-700">{error}</div>
          <button
            onClick={onClearError}
            className="mt-2 text-xs font-medium text-rose-800 underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function CompareView({
  staged,
  meta,
  onMetaChange,
  onApply,
  onCancel,
}: {
  staged: UploadStaged;
  meta: CycleMetadata;
  onMetaChange: (m: CycleMetadata) => void;
  onApply: (mode: ApplyMode) => void;
  onCancel: () => void;
}) {
  const hasCurrent = staged.current_cycle !== null;
  const s = staged.summary;

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Review changes before committing.</strong> Once you choose how to
        apply this file, employee records will be updated.
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="New" value={s.new} tone="green" />
        <Stat label="Removed" value={s.removed} tone="rose" />
        <Stat label="Changed" value={s.changed} tone="amber" />
        <Stat label="Unchanged" value={s.unchanged} tone="slate" />
        <Stat label="In new file" value={s.total} tone="blue" />
      </div>

      {/* Cycle metadata */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Cycle settings</h3>
        <p className="mt-1 text-xs text-slate-500">
          These apply to the new (or merged) review cycle.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Financial Year">
            <input
              type="text"
              value={meta.fy_label}
              onChange={(e) =>
                onMetaChange({ ...meta, fy_label: e.target.value })
              }
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
            />
          </Field>
          <Field label="CPI %">
            <div
              className="flex items-center gap-2 w-full rounded-md border px-3 py-2 text-sm"
              style={{
                background: "var(--neutral-50)",
                border: "1px solid var(--neutral-200)",
                color: "var(--neutral-600)",
              }}
            >
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--neutral-900)" }}>
                3.5%
              </span>
              <span className="text-xs" style={{ color: "var(--neutral-400)" }}>
                — fixed for this cycle
              </span>
            </div>
          </Field>
          <Field label="Effective Date">
            <input
              type="date"
              value={meta.effective_date}
              onChange={(e) =>
                onMetaChange({ ...meta, effective_date: e.target.value })
              }
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
            />
          </Field>
          <Field label="Letter Date">
            <input
              type="date"
              value={meta.letter_date}
              onChange={(e) =>
                onMetaChange({ ...meta, letter_date: e.target.value })
              }
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
            />
          </Field>
        </div>
      </div>

      {/* Apply choice */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">
          {hasCurrent
            ? "Choose how to apply the new file"
            : "Ready to commit"}
        </h3>

        <div className="mt-4 flex flex-wrap gap-3">
          {hasCurrent ? (
            <>
              <button
                onClick={() => onApply("archive")}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Archive current & load new
              </button>
              <button
                onClick={() => onApply("merge")}
                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
              >
                Merge into existing cycle
              </button>
            </>
          ) : (
            <button
              onClick={() => onApply("fresh")}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Create new cycle with this file
            </button>
          )}

          <button
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>

        <div className="mt-4 text-xs text-slate-500">
          <strong>File:</strong> {staged.filename} &nbsp;|&nbsp;
          <strong>Sheet:</strong> {staged.sheet_name} &nbsp;|&nbsp;
          <strong>Columns:</strong> {staged.columns_detected.length} detected
        </div>
        {staged.warnings.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-xs text-amber-700">
            {staged.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Diff preview */}
      {staged.preview.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Emp #</th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Site</th>
                <th className="px-4 py-2 text-left">Kind</th>
                <th className="px-4 py-2 text-left">Changes</th>
              </tr>
            </thead>
            <tbody>
              {staged.preview.map((row) => (
                <tr key={row.emp_num} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 text-slate-700">{row.emp_num}</td>
                  <td className="px-4 py-2 text-slate-700">{row.name}</td>
                  <td className="px-4 py-2 text-slate-700">{row.site}</td>
                  <td className="px-4 py-2"><KindBadge kind={row.kind} /></td>
                  <td className="px-4 py-2 text-xs text-slate-600">
                    {row.kind === "changed" ? (
                      <ul className="space-y-0.5">
                        {Object.entries(row.changes).map(([field, ch]) => (
                          <li key={field}>
                            <span className="font-medium">{field}:</span>{" "}
                            <span className="text-slate-400 line-through">
                              {String(ch.old ?? "—")}
                            </span>{" "}
                            →{" "}
                            <span className="text-slate-800">
                              {String(ch.new ?? "—")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {staged.summary.total > staged.preview.length && (
            <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              Showing top {staged.preview.length} of {staged.summary.total} rows.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SuccessCard({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center shadow-sm">
      <div className="text-base font-semibold text-emerald-900">
        Wage model loaded
      </div>
      <p className="mt-1 text-sm text-emerald-800">
        Employees are now in the database and ready for review.
      </p>
      <button
        onClick={onContinue}
        className="mt-6 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
      >
        Go to dashboard
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tiny presentational helpers
// ─────────────────────────────────────────────────────────────────────────────
function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "rose" | "amber" | "slate" | "blue";
}) {
  const tones = {
    green: "text-emerald-700",
    rose: "text-rose-700",
    amber: "text-amber-700",
    slate: "text-slate-700",
    blue: "text-blue-700",
  } as const;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-center shadow-sm">
      <div className={`text-2xl font-semibold ${tones[tone]}`}>{value}</div>
      <div className="mt-0.5 text-xs uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const map: Record<string, string> = {
    new: "bg-emerald-100 text-emerald-800",
    removed: "bg-rose-100 text-rose-800",
    changed: "bg-amber-100 text-amber-800",
    unchanged: "bg-slate-100 text-slate-700",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${map[kind] ?? ""}`}>
      {kind}
    </span>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}

function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body;
    if (body && typeof body === "object" && "detail" in body) {
      return String((body as { detail: unknown }).detail);
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
