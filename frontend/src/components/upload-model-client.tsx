"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@/lib/api";
import {
  applyUpload,
  cancelUpload,
  uploadFiles,
  type ApplyMode,
  type CycleMetadata,
  type StagedUpload,
} from "@/lib/cycles";

type Step = "select" | "uploading" | "compare" | "applying" | "done" | "error";

interface FileSlotState {
  employee_file: File | null;
  award_summary: File | null;
  pp_admin: File | null;
  pp_tech: File | null;
}

const EMPTY_FILES: FileSlotState = {
  employee_file: null,
  award_summary: null,
  pp_admin: null,
  pp_tech: null,
};

const SLOT_DEFS: Array<{
  key: keyof FileSlotState;
  label: string;
  hint: string;
}> = [
  { key: "employee_file", label: "Employee Details",      hint: "Employee_Details.xlsx — the master list of staff" },
  { key: "award_summary", label: "Award Summary",         hint: "Award Summary.xlsx — MA000027 hourly rates for FY25/26" },
  { key: "pp_tech",       label: "Pay Progression Tech",  hint: "Pay Progression Tech.xlsx — Radiographer / Sonographer / MRI bands" },
  { key: "pp_admin",      label: "Pay Progression Admin", hint: "Pay Progression Admin.xlsx — Reception / Typing / Supervisor bands" },
];

export function UploadModelClient() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("select");
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<FileSlotState>(EMPTY_FILES);
  const [staged, setStaged] = useState<StagedUpload | null>(null);

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

  const allFilesReady = SLOT_DEFS.every((s) => files[s.key] !== null);

  function setSlot(key: keyof FileSlotState, file: File | null) {
    setFiles((prev) => ({ ...prev, [key]: file }));
    setError(null);
  }

  async function onValidate() {
    if (!allFilesReady) return;
    setStep("uploading");
    setError(null);
    try {
      const result = await uploadFiles({
        employee_file: files.employee_file!,
        award_summary: files.award_summary!,
        pp_admin: files.pp_admin!,
        pp_tech: files.pp_tech!,
      });
      setStaged(result);
      setStep("compare");
    } catch (err) {
      setStep("error");
      setError(formatError(err));
    }
  }

  async function onApply(mode: ApplyMode) {
    if (!staged) return;
    setStep("applying");
    setError(null);
    try {
      await applyUpload({
        staging_id: staged.staging_id,
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
      try { await cancelUpload(staged.staging_id); } catch { /* ignore */ }
    }
    setStaged(null);
    setFiles(EMPTY_FILES);
    setStep("select");
    setError(null);
  }

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

  if ((step === "compare" || step === "applying") && staged) {
    return (
      <CompareView
        staged={staged}
        meta={meta}
        onMetaChange={setMeta}
        onApply={onApply}
        onCancel={onCancel}
        isApplying={step === "applying"}
      />
    );
  }

  return (
    <SelectView
      step={step}
      files={files}
      onSetSlot={setSlot}
      onValidate={onValidate}
      canValidate={allFilesReady}
      error={error}
      onClearError={() => { setError(null); setStep("select"); }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Select view — 4 file slots + validate button
// ─────────────────────────────────────────────────────────────────────────────
function SelectView({
  step,
  files,
  onSetSlot,
  onValidate,
  canValidate,
  error,
  onClearError,
}: {
  step: Step;
  files: FileSlotState;
  onSetSlot: (key: keyof FileSlotState, file: File | null) => void;
  onValidate: () => void;
  canValidate: boolean;
  error: string | null;
  onClearError: () => void;
}) {
  const uploading = step === "uploading";
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Upload wage review files</h2>
        <p className="mt-1 text-sm text-slate-500">
          Select all four .xlsx files for this cycle. The system parses them together
          and shows a diff preview before committing.
        </p>

        <div className="mt-6 space-y-3">
          {SLOT_DEFS.map((slot) => (
            <FileSlot
              key={slot.key}
              label={slot.label}
              hint={slot.hint}
              file={files[slot.key]}
              disabled={uploading}
              onChange={(f) => onSetSlot(slot.key, f)}
            />
          ))}
        </div>

        <button
          onClick={onValidate}
          disabled={!canValidate || uploading}
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white
                     hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? (
            <>
              <Spinner />
              Validating files…
            </>
          ) : (
            <>Validate &amp; preview →</>
          )}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
          <div className="text-sm font-medium text-rose-800">Upload failed</div>
          <div className="mt-1 text-xs text-rose-700">{error}</div>
          <button onClick={onClearError} className="mt-2 text-xs font-medium text-rose-800 underline">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function FileSlot({
  label,
  hint,
  file,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  file: File | null;
  disabled: boolean;
  onChange: (f: File | null) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-900">{label}</div>
        <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
        {file && (
          <div className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-emerald-700">
            <span>✓</span>
            <span className="font-medium truncate">{file.name}</span>
            <span className="text-slate-400">· {(file.size / 1024).toFixed(0)} KB</span>
          </div>
        )}
      </div>
      <label className="shrink-0">
        <input
          type="file"
          accept=".xlsx,.xlsm"
          disabled={disabled}
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          className="sr-only"
        />
        <span
          className={`inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs font-medium
                       ${file ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}
                       ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {file ? "Replace" : "Choose file"}
        </span>
      </label>
      {file && !disabled && (
        <button
          onClick={() => onChange(null)}
          className="shrink-0 text-xs text-slate-500 hover:text-slate-800 underline"
        >
          remove
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Compare view — show parse summaries + diff + apply buttons
// ─────────────────────────────────────────────────────────────────────────────
function CompareView({
  staged,
  meta,
  onMetaChange,
  onApply,
  onCancel,
  isApplying,
}: {
  staged: StagedUpload;
  meta: CycleMetadata;
  onMetaChange: (m: CycleMetadata) => void;
  onApply: (mode: ApplyMode) => void;
  onCancel: () => void;
  isApplying: boolean;
}) {
  const hasCurrent = staged.current_cycle !== null;
  const ds = staged.employee_diff_summary;

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Review parsed data before committing.</strong> Once you choose an apply
        mode, employees + reference data are updated atomically for this cycle.
      </div>

      {/* Per-file parse summaries */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <FileCard
          title="Employee Details"
          filename={staged.employee_file.filename}
          stats={[
            { label: "Employees parsed", value: staged.employee_file.employees_parsed },
            { label: "Columns detected", value: staged.employee_file.columns_detected.length },
          ]}
          warnings={staged.employee_file.warnings}
        />
        <FileCard
          title="Award Summary"
          filename={staged.award_summary.filename}
          stats={[
            { label: "Award rates",   value: staged.award_summary.award_rates },
            { label: "Off-award rows", value: staged.award_summary.off_award_rows },
            { label: "Junior rates",  value: staged.award_summary.junior_rates },
          ]}
          warnings={staged.award_summary.warnings}
        />
        <FileCard
          title="PP Tech"
          filename={staged.pp_tech.filename}
          stats={[
            { label: "Bands found", value: staged.pp_tech.bands },
            { label: "Sections",    value: staged.pp_tech.sections.length },
          ]}
          warnings={staged.pp_tech.warnings}
          subtle={`Sections: ${staged.pp_tech.sections.join(", ") || "—"}`}
        />
        <FileCard
          title="PP Admin"
          filename={staged.pp_admin.filename}
          stats={[
            { label: "Bands found", value: staged.pp_admin.bands },
            { label: "Sections",    value: staged.pp_admin.sections.length },
          ]}
          warnings={staged.pp_admin.warnings}
          subtle={`Sections: ${staged.pp_admin.sections.join(", ") || "—"}`}
        />
      </div>

      {/* Employee diff stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="New"        value={ds.new}        tone="green" />
        <Stat label="Removed"    value={ds.removed}    tone="rose" />
        <Stat label="Changed"    value={ds.changed}    tone="amber" />
        <Stat label="Unchanged"  value={ds.unchanged}  tone="slate" />
        <Stat label="In new file" value={ds.total}     tone="blue" />
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
              onChange={(e) => onMetaChange({ ...meta, fy_label: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
            />
          </Field>
          <Field label="CPI %">
            <input
              type="number"
              step="0.1"
              value={meta.cpi_rate}
              onChange={(e) => onMetaChange({ ...meta, cpi_rate: parseFloat(e.target.value) || 0 })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
            />
          </Field>
          <Field label="Effective Date">
            <input
              type="date"
              value={meta.effective_date}
              onChange={(e) => onMetaChange({ ...meta, effective_date: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
            />
          </Field>
          <Field label="Letter Date">
            <input
              type="date"
              value={meta.letter_date}
              onChange={(e) => onMetaChange({ ...meta, letter_date: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
            />
          </Field>
        </div>
      </div>

      {/* Apply choice */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">
          {hasCurrent ? "Choose how to apply" : "Ready to commit"}
        </h3>

        {isApplying && (
          <div className="mt-4 flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
            <Spinner />
            <span className="text-sm font-medium text-blue-800">
              Importing — this may take a moment…
            </span>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          {hasCurrent ? (
            <>
              <button
                onClick={() => onApply("archive")}
                disabled={isApplying}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Archive current &amp; load new
              </button>
              <button
                onClick={() => onApply("merge")}
                disabled={isApplying}
                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Merge into existing cycle
              </button>
            </>
          ) : (
            <button
              onClick={() => onApply("fresh")}
              disabled={isApplying}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create new cycle with these files
            </button>
          )}
          <button
            onClick={onCancel}
            disabled={isApplying}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Diff preview */}
      {staged.employee_diff_preview.length > 0 && (
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
              {staged.employee_diff_preview.map((row) => (
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
                            <span className="text-slate-400 line-through">{String(ch.old ?? "—")}</span>{" "}
                            →{" "}
                            <span className="text-slate-800">{String(ch.new ?? "—")}</span>
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
          {ds.total > staged.employee_diff_preview.length && (
            <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              Showing top {staged.employee_diff_preview.length} of {ds.total} rows.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────
function FileCard({
  title, filename, stats, warnings, subtle,
}: {
  title: string;
  filename: string;
  stats: Array<{ label: string; value: number }>;
  warnings: string[];
  subtle?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-1 truncate text-sm font-medium text-slate-900">{filename}</div>
      <div className="mt-3 space-y-1">
        {stats.map((s) => (
          <div key={s.label} className="flex items-baseline justify-between text-xs">
            <span className="text-slate-500">{s.label}</span>
            <span className="font-mono font-semibold text-slate-900">{s.value}</span>
          </div>
        ))}
      </div>
      {subtle && (
        <div className="mt-3 text-[11px] leading-snug text-slate-500 line-clamp-2" title={subtle}>{subtle}</div>
      )}
      {warnings.length > 0 && (
        <ul className="mt-3 list-disc pl-4 text-[11px] text-amber-700">
          {warnings.slice(0, 3).map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}

function SuccessCard({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center shadow-sm">
      <div className="text-base font-semibold text-emerald-900">Wage review files loaded</div>
      <p className="mt-1 text-sm text-emerald-800">
        Employees, award rates and PP bands are now in the database and ready for review.
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

function Stat({
  label, value, tone,
}: {
  label: string; value: number; tone: "green" | "rose" | "amber" | "slate" | "blue";
}) {
  const tones = {
    green: "text-emerald-700", rose: "text-rose-700", amber: "text-amber-700",
    slate: "text-slate-700",   blue: "text-blue-700",
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
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${map[kind] ?? ""}`}>{kind}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-current" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
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
