"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ApiError } from "@/lib/api";
import { clearAllData, updateCycleSettings, type ClearDataResult } from "@/lib/admin";

interface CycleFields {
  id: number;
  fy_label: string;
  effective_date: string;
  letter_date: string;
  consultation_deadline: string | null;
  cpi_rate: number;
  super_old: number | null;
  super_new: number | null;
  signatory_name: string | null;
  signatory_title: string | null;
  signatory_company: string | null;
  hr_email: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
export function CycleSettingsClient({ cycle }: { cycle: CycleFields | null }) {
  const router = useRouter();

  const [form, setForm] = useState({
    letter_date: cycle?.letter_date ?? "",
    effective_date: cycle?.effective_date ?? "",
    consultation_deadline: cycle?.consultation_deadline ?? "",
    cpi_rate: String(cycle?.cpi_rate ?? ""),
    super_old: String(cycle?.super_old ?? ""),
    super_new: String(cycle?.super_new ?? ""),
    signatory_name: cycle?.signatory_name ?? "",
    signatory_title: cycle?.signatory_title ?? "",
    signatory_company: cycle?.signatory_company ?? "",
    hr_email: cycle?.hr_email ?? "",
  });

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
  }

  function handleSave() {
    if (!cycle) return;
    setError(null);
    setSaved(false);
    start(async () => {
      try {
        await updateCycleSettings(cycle.id, {
          letter_date: form.letter_date || undefined,
          effective_date: form.effective_date || undefined,
          consultation_deadline: form.consultation_deadline || null,
          cpi_rate: form.cpi_rate ? parseFloat(form.cpi_rate) : undefined,
          super_old: form.super_old ? parseFloat(form.super_old) : null,
          super_new: form.super_new ? parseFloat(form.super_new) : null,
          signatory_name: form.signatory_name || null,
          signatory_title: form.signatory_title || null,
          signatory_company: form.signatory_company || null,
          hr_email: form.hr_email || null,
        });
        setSaved(true);
        router.refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to save settings");
      }
    });
  }

  return (
    <div className="mt-6 space-y-8">
      {cycle ? (
        <>
          {/* Cycle identity (read-only) */}
          <Section title="Cycle identity">
            <div className="grid grid-cols-2 gap-4">
              <ReadField label="FY label" value={cycle.fy_label} />
            </div>
          </Section>

          {/* Dates */}
          <Section title="Key dates">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Field label="Effective date">
                <input type="date" value={form.effective_date} onChange={(e) => set("effective_date", e.target.value)} className={INPUT} />
              </Field>
              <Field label="Letter date">
                <input type="date" value={form.letter_date} onChange={(e) => set("letter_date", e.target.value)} className={INPUT} />
              </Field>
              <Field label="Consultation deadline">
                <input type="date" value={form.consultation_deadline} onChange={(e) => set("consultation_deadline", e.target.value)} className={INPUT} />
                <p className="mt-1 text-xs" style={{ color: "var(--neutral-400)" }}>Used in Letter B/C</p>
              </Field>
            </div>
          </Section>

          {/* Rates */}
          <Section title="Rates">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Field label="CPI rate (%)">
                <input
                  type="number" step="0.01" min="0" max="100"
                  value={form.cpi_rate}
                  onChange={(e) => set("cpi_rate", e.target.value)}
                  className={INPUT}
                  placeholder="2.4"
                />
              </Field>
              <Field label="Superannuation old rate (%)">
                <input
                  type="number" step="0.01" min="0" max="100"
                  value={form.super_old}
                  onChange={(e) => set("super_old", e.target.value)}
                  className={INPUT}
                  placeholder="11.0"
                />
              </Field>
              <Field label="Superannuation new rate (%)">
                <input
                  type="number" step="0.01" min="0" max="100"
                  value={form.super_new}
                  onChange={(e) => set("super_new", e.target.value)}
                  className={INPUT}
                  placeholder="11.5"
                />
              </Field>
            </div>
          </Section>

          {/* Signatory */}
          <Section title="Letter signatory">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Name">
                <input type="text" value={form.signatory_name} onChange={(e) => set("signatory_name", e.target.value)} className={INPUT} placeholder="John Smith" />
              </Field>
              <Field label="Title / position">
                <input type="text" value={form.signatory_title} onChange={(e) => set("signatory_title", e.target.value)} className={INPUT} placeholder="Chief Executive Officer" />
              </Field>
              <Field label="Company">
                <input type="text" value={form.signatory_company} onChange={(e) => set("signatory_company", e.target.value)} className={INPUT} placeholder="Carlisle Health" />
              </Field>
              <Field label="HR contact email">
                <input type="email" value={form.hr_email} onChange={(e) => set("hr_email", e.target.value)} className={INPUT} placeholder="hr@carlislehealth.com.au" />
                <p className="mt-1 text-xs" style={{ color: "var(--neutral-400)" }}>Shown in letters for employee queries</p>
              </Field>
            </div>
          </Section>

          {/* Save */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleSave}
              disabled={isPending}
              className="rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50 transition-colors"
              style={{ background: "var(--neutral-900)", color: "white" }}
            >
              {isPending ? "Saving…" : "Save settings"}
            </button>
            {saved && <span className="text-sm font-medium" style={{ color: "var(--green-600)" }}>✓ Saved</span>}
            {error && <span className="text-sm" style={{ color: "var(--red-600)" }}>{error}</span>}
          </div>
        </>
      ) : (
        <div
          className="flex flex-col items-center justify-center rounded-xl py-16 text-center"
          style={{ background: "white", border: "1px solid var(--border)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "var(--neutral-700)" }}>
            No active review cycle
          </p>
          <p className="mt-1.5 text-xs" style={{ color: "var(--neutral-500)" }}>
            Upload a wage model first to configure cycle settings.
          </p>
        </div>
      )}

      {/* ── Danger Zone ─────────────────────────────────────────────────── */}
      <DangerZone onCleared={() => router.refresh()} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Danger Zone
// ─────────────────────────────────────────────────────────────────────────────
function DangerZone({ onCleared }: { onCleared: () => void }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isPending, start] = useTransition();
  const [result, setResult] = useState<ClearDataResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const CONFIRM_PHRASE = "DELETE";
  const ready = confirmText.trim().toUpperCase() === CONFIRM_PHRASE;

  function handleClear() {
    if (!ready) return;
    setError(null);
    start(async () => {
      try {
        const res = await clearAllData();
        setResult(res);
        setShowConfirm(false);
        setConfirmText("");
        onCleared();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to clear data");
      }
    });
  }

  return (
    <div
      className="rounded-xl p-6"
      style={{
        background: "var(--red-50)",
        border: "1px solid var(--red-100)",
      }}
    >
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-sm font-bold" style={{ color: "var(--red-700)" }}>
            Danger Zone
          </h2>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--red-600)" }}>
            Permanently delete <strong>all review cycles, employees, approvals, and generated files</strong>.
            Users, audit log, and alembic version are preserved. This cannot be undone.
          </p>
        </div>
        {!showConfirm && (
          <button
            onClick={() => { setShowConfirm(true); setResult(null); setError(null); }}
            className="shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
            style={{
              background: "var(--red-600)",
              color: "white",
            }}
          >
            Clear all data
          </button>
        )}
      </div>

      {/* Confirmation step */}
      {showConfirm && (
        <div
          className="mt-5 rounded-lg p-4"
          style={{ background: "white", border: "1px solid var(--red-200)" }}
        >
          <p className="mb-3 text-xs font-medium" style={{ color: "var(--neutral-700)" }}>
            Type <span className="font-bold tracking-widest" style={{ color: "var(--red-600)" }}>DELETE</span> to confirm:
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleClear()}
            placeholder="Type DELETE to confirm"
            className="w-full rounded-lg border px-3 py-2 text-sm font-mono tracking-widest focus:outline-none"
            style={{
              borderColor: ready ? "var(--red-400)" : "var(--neutral-200)",
              background: ready ? "var(--red-50)" : "white",
              color: "var(--neutral-900)",
            }}
            autoFocus
          />
          {error && (
            <p className="mt-2 text-xs" style={{ color: "var(--red-600)" }}>{error}</p>
          )}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={handleClear}
              disabled={!ready || isPending}
              className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40 transition-colors"
              style={{ background: "var(--red-600)", color: "white" }}
            >
              {isPending ? "Clearing…" : "Yes, delete everything"}
            </button>
            <button
              onClick={() => { setShowConfirm(false); setConfirmText(""); setError(null); }}
              className="text-sm"
              style={{ color: "var(--neutral-500)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Success summary */}
      {result && (
        <div
          className="mt-4 rounded-lg px-4 py-3 text-xs"
          style={{ background: "var(--green-50)", border: "1px solid var(--green-100)", color: "var(--green-700)" }}
        >
          <span className="font-semibold">✓ All data cleared.</span>{" "}
          {result.cycles_deleted} cycle{result.cycles_deleted !== 1 ? "s" : ""},{" "}
          {result.employees_deleted} employee{result.employees_deleted !== 1 ? "s" : ""},{" "}
          {result.approvals_deleted} approval{result.approvals_deleted !== 1 ? "s" : ""},{" "}
          {result.files_deleted} file{result.files_deleted !== 1 ? "s" : ""} deleted.
          {!result.storage_cleared && (
            <span className="ml-2 opacity-70">(Storage wipe failed — check server logs.)</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────
const INPUT =
  "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-6"
      style={{
        background: "white",
        border: "1px solid var(--border)",
        boxShadow: "0 1px 3px rgba(15,15,15,0.04)",
      }}
    >
      <h2 className="mb-4 text-sm font-bold" style={{ color: "var(--neutral-800)" }}>{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        className="mb-1.5 block text-xs font-semibold uppercase tracking-wide"
        style={{ color: "var(--neutral-600)" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="mb-1.5 text-xs font-semibold uppercase tracking-wide"
        style={{ color: "var(--neutral-600)" }}
      >
        {label}
      </div>
      <div
        className="rounded-lg px-3 py-2 text-sm"
        style={{
          background: "var(--neutral-50)",
          border: "1px solid var(--neutral-200)",
          color: "var(--neutral-700)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
