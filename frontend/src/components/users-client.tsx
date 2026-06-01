"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { ApiError } from "@/lib/api";
import {
  createUser,
  patchUser,
  type AdminUser,
  type CreateUserRequest,
} from "@/lib/admin";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseSites(value: string): string[] {
  return value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
}
function joinSites(arr: string[]): string {
  return arr.join(",");
}

const ROLES = [
  { value: "hr_admin",          label: "HR Admin"           },
  { value: "regional_manager",  label: "Regional Manager"   },
  { value: "senior_management", label: "Senior Management"  },
  { value: "payroll",           label: "Payroll"            },
];

const ROLE_BADGE: Record<string, { bg: string; color: string }> = {
  hr_admin:          { bg: "var(--violet-100)", color: "var(--violet-700)" },
  regional_manager:  { bg: "var(--blue-100)",   color: "var(--blue-700)"   },
  senior_management: { bg: "var(--amber-100)",  color: "var(--amber-700)"  },
  payroll:           { bg: "var(--neutral-100)", color: "var(--neutral-600)" },
};

// ─────────────────────────────────────────────────────────────────────────────
export function UsersClient({
  initialUsers,
  sites = [],
}: {
  initialUsers: AdminUser[];
  sites?: string[];
}) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  function onCreated(u: AdminUser) {
    setUsers((prev) => [...prev, u].sort((a, b) => a.name.localeCompare(b.name)));
    setShowCreate(false);
    router.refresh();
  }

  function onPatched(u: AdminUser) {
    setUsers((prev) => prev.map((x) => (x.id === u.id ? u : x)));
    setEditingId(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: "var(--neutral-500)" }}>
          {users.length} user{users.length !== 1 ? "s" : ""}
        </p>
        <button
          onClick={() => { setShowCreate(true); setEditingId(null); }}
          className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
          style={{ background: "var(--brand)", color: "white" }}
        >
          + Add user
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateUserForm
          sites={sites}
          onSuccess={onCreated}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Users table */}
      <div
        className="overflow-hidden rounded-xl"
        style={{
          background: "white",
          border: "1px solid var(--border)",
          boxShadow: "0 1px 3px rgba(15,15,15,0.04)",
        }}
      >
        <table className="min-w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["Name", "Email", "Role", "Site", "Last login", "Status", ""].map((h, i) => (
                <th
                  key={h + i}
                  className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider"
                  style={{ background: "var(--neutral-50)", color: "var(--neutral-500)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u, idx) => (
              <>
                <tr
                  key={u.id}
                  style={{
                    borderBottom: editingId === u.id || idx < users.length - 1
                      ? "1px solid var(--neutral-100)"
                      : "none",
                  }}
                >
                  <td className="px-5 py-3 font-semibold" style={{ color: "var(--neutral-900)" }}>
                    {u.name}
                  </td>
                  <td className="px-5 py-3 text-sm" style={{ color: "var(--neutral-600)" }}>
                    {u.email}
                  </td>
                  <td className="px-5 py-3">
                    {(() => {
                      const s = ROLE_BADGE[u.role] ?? ROLE_BADGE.payroll;
                      return (
                        <span
                          className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                          style={{ background: s.bg, color: s.color }}
                        >
                          {ROLES.find((r) => r.value === u.role)?.label ?? u.role}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-5 py-3 text-sm" style={{ color: "var(--neutral-600)" }}>
                    {u.site ?? <span style={{ color: "var(--neutral-300)" }}>—</span>}
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: "var(--neutral-500)", fontFamily: "var(--font-mono)" }}>
                    {u.last_login_at ? formatDate(u.last_login_at) : <span style={{ color: "var(--neutral-300)" }}>Never</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                      style={
                        u.is_active
                          ? { background: "var(--green-100)", color: "var(--green-700)" }
                          : { background: "var(--red-100)", color: "var(--red-700)" }
                      }
                    >
                      {u.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => setEditingId(editingId === u.id ? null : u.id)}
                      className="text-xs font-medium underline"
                      style={{ color: editingId === u.id ? "var(--neutral-400)" : "var(--brand)" }}
                    >
                      {editingId === u.id ? "Cancel" : "Edit"}
                    </button>
                  </td>
                </tr>
                {editingId === u.id && (
                  <tr key={`${u.id}-edit`} style={{ borderBottom: idx < users.length - 1 ? "1px solid var(--neutral-100)" : "none" }}>
                    <td colSpan={7} className="px-5 py-5" style={{ background: "var(--neutral-50)" }}>
                      <EditUserForm
                        user={u}
                        sites={sites}
                        onSuccess={onPatched}
                        onCancel={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Create user form
// ─────────────────────────────────────────────────────────────────────────────
function CreateUserForm({
  sites,
  onSuccess,
  onCancel,
}: {
  sites: string[];
  onSuccess: (u: AdminUser) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<CreateUserRequest>({
    email: "",
    name: "",
    password: "",
    role: "regional_manager",
    site: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const validName  = form.name.trim().length >= 2;
  const validPwd   = pwdStrength(form.password) === 3;
  const formValid  = validName && validEmail && validPwd;

  const blockers = [
    !validName  && "Full name required",
    !validEmail && "Valid email required",
    !validPwd   && "Strong password required",
  ].filter(Boolean) as string[];

  function submit() {
    setError(null);
    start(async () => {
      try {
        const user = await createUser(form);
        onSuccess(user);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to create user");
      }
    });
  }

  return (
    <div
      className="rounded-xl p-6"
      style={{
        background: "white",
        border: "1px solid var(--border)",
        boxShadow: "0 1px 3px rgba(15,15,15,0.04)",
      }}
    >
      <h3 className="mb-5 text-sm font-bold" style={{ color: "var(--neutral-900)" }}>
        New user
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Full name">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={INPUT}
            placeholder="Jane Smith"
            style={form.name && !validName ? { borderColor: "#fca5a5" } : undefined}
          />
          {form.name && !validName && (
            <p className="mt-1 text-[11px]" style={{ color: "#ef4444" }}>At least 2 characters required</p>
          )}
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className={INPUT}
            placeholder="jane@carlislehealth.com.au"
            style={form.email && !validEmail ? { borderColor: "#fca5a5" } : undefined}
          />
          {form.email && !validEmail && (
            <p className="mt-1 text-[11px]" style={{ color: "#ef4444" }}>Enter a valid email address</p>
          )}
        </Field>
        <Field label="Password">
          <PasswordInput
            value={form.password}
            onChange={(v) => setForm((f) => ({ ...f, password: v }))}
            placeholder="Set a strong password"
            showStrength
          />
        </Field>
        <Field label="Role">
          <Select
            value={form.role}
            onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Site (Regional Manager only)">
          <SiteMultiSelect
            sites={sites}
            value={form.site ?? ""}
            disabled={form.role !== "regional_manager"}
            onChange={(v) => setForm((f) => ({ ...f, site: v || null }))}
          />
        </Field>
      </div>
      {error && (
        <p className="mt-3 text-xs font-medium" style={{ color: "var(--red-600)" }}>
          {error}
        </p>
      )}
      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={isPending || !formValid}
          className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style={{ background: "var(--neutral-900)", color: "white" }}
          title={!formValid ? blockers.join(" · ") : undefined}
        >
          {isPending ? "Creating…" : "Create user"}
        </button>
        {!formValid && blockers.length > 0 && (
          <span className="text-[11px]" style={{ color: "var(--neutral-400)" }}>
            {blockers.join(" · ")}
          </span>
        )}
        <button
          onClick={onCancel}
          className="text-sm"
          style={{ color: "var(--neutral-500)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Edit user form
// ─────────────────────────────────────────────────────────────────────────────
function EditUserForm({
  user,
  sites,
  onSuccess,
  onCancel,
}: {
  user: AdminUser;
  sites: string[];
  onSuccess: (u: AdminUser) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [site, setSite] = useState(user.site ?? "");
  const [isActive, setIsActive] = useState(user.is_active);
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      try {
        const patch: Parameters<typeof patchUser>[1] = {};
        if (name !== user.name) patch.name = name;
        if (role !== user.role) patch.role = role;
        if ((site || null) !== user.site) patch.site = site || null;
        if (isActive !== user.is_active) patch.is_active = isActive;
        if (newPassword) patch.password = newPassword;

        const updated = await patchUser(user.id, patch);
        onSuccess(updated);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to update user");
      }
    });
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Full name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT}
          />
        </Field>
        <Field label="Role">
          <Select value={role} onValueChange={(v) => setRole(v)}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Site">
          <SiteMultiSelect
            sites={sites}
            value={site}
            disabled={role !== "regional_manager"}
            onChange={setSite}
          />
        </Field>
        <Field label="New password (leave blank to keep)">
          <PasswordInput
            value={newPassword}
            onChange={setNewPassword}
            placeholder="Leave blank to keep current"
            showStrength
          />
        </Field>
        <Field label="Status">
          <Select
            value={isActive ? "active" : "inactive"}
            onValueChange={(v) => setIsActive(v === "active")}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      {error && (
        <p className="mt-3 text-xs font-medium" style={{ color: "var(--red-600)" }}>
          {error}
        </p>
      )}
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={isPending}
          className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 transition-colors"
          style={{ background: "var(--neutral-900)", color: "white" }}
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
        <button
          onClick={onCancel}
          className="text-sm"
          style={{ color: "var(--neutral-500)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────
const INPUT =
  "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 placeholder:text-[var(--neutral-400)]";

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

// ─────────────────────────────────────────────────────────────────────────────
//  Password input — show/hide toggle + strength meter + requirement checklist
// ─────────────────────────────────────────────────────────────────────────────
const PWD_REQS = [
  { label: "At least 8 characters",       test: (p: string) => p.length >= 8 },
  { label: "Uppercase letter (A–Z)",       test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase letter (a–z)",       test: (p: string) => /[a-z]/.test(p) },
  { label: "Number (0–9)",                 test: (p: string) => /[0-9]/.test(p) },
  { label: "Special character (!@#$…)",   test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

function pwdStrength(p: string): 0 | 1 | 2 | 3 {
  if (!p) return 0;
  const passed = PWD_REQS.filter((r) => r.test(p)).length;
  if (passed <= 2) return 1;
  if (passed <= 3) return 2;
  return 3;
}

const STRENGTH_LABEL = ["", "Weak", "Fair", "Strong"] as const;
const STRENGTH_COLOR = ["", "#ef4444", "#f59e0b", "#16a34a"] as const;

function PasswordInput({
  value,
  onChange,
  placeholder,
  showStrength = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  showStrength?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const strength = pwdStrength(value);

  return (
    <div>
      {/* Input row */}
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          className={INPUT}
          style={{ paddingRight: 36 }}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex items-center px-2.5 text-xs"
          style={{ color: "var(--neutral-400)" }}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? (
            // Eye-off icon
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M3.28 2.22a.75.75 0 0 0-1.06 1.06l14.5 14.5a.75.75 0 1 0 1.06-1.06l-1.745-1.745a10.029 10.029 0 0 0 3.3-4.38 1.651 1.651 0 0 0 0-1.185A10.004 10.004 0 0 0 9.999 3a9.956 9.956 0 0 0-4.744 1.194L3.28 2.22ZM7.752 6.69l1.092 1.092a2.5 2.5 0 0 1 3.374 3.373l1.091 1.092a4 4 0 0 0-5.557-5.557Z" clipRule="evenodd" />
              <path d="M10.748 13.93l2.523 2.523a10.003 10.003 0 0 1-8.516-2.228.75.75 0 1 1 .99-1.126 8.5 8.5 0 0 0 5.003 0ZM10.748 13.93 8.27 11.452a4 4 0 0 0 2.478 2.478Z" />
            </svg>
          ) : (
            // Eye icon
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
              <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" clipRule="evenodd" />
            </svg>
          )}
        </button>
      </div>

      {/* Strength bar + requirements — shown when focused or value exists */}
      {showStrength && (value || focused) && (
        <div className="mt-2 space-y-2">
          {/* Strength bar */}
          <div className="flex items-center gap-2">
            <div className="flex flex-1 gap-1">
              {[1, 2, 3].map((lvl) => (
                <div
                  key={lvl}
                  className="h-1 flex-1 rounded-full transition-colors"
                  style={{
                    background: strength >= lvl ? STRENGTH_COLOR[strength] : "var(--neutral-100)",
                  }}
                />
              ))}
            </div>
            {strength > 0 && (
              <span className="text-[11px] font-semibold" style={{ color: STRENGTH_COLOR[strength], minWidth: 36 }}>
                {STRENGTH_LABEL[strength]}
              </span>
            )}
          </div>

          {/* Requirement checklist */}
          <div className="grid grid-cols-1 gap-0.5">
            {PWD_REQS.map((req) => {
              const ok = req.test(value);
              return (
                <div key={req.label} className="flex items-center gap-1.5">
                  <span
                    className="text-[11px] font-bold"
                    style={{ color: ok ? "#16a34a" : "var(--neutral-300)", width: 12, textAlign: "center" }}
                  >
                    {ok ? "✓" : "·"}
                  </span>
                  <span
                    className="text-[11px]"
                    style={{ color: ok ? "#15803d" : "var(--neutral-400)" }}
                  >
                    {req.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Site multi-select — checkbox dropdown, stores as comma-separated string
// ─────────────────────────────────────────────────────────────────────────────
function SiteMultiSelect({
  sites,
  value,
  disabled,
  onChange,
}: {
  sites: string[];
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = parseSites(value);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  function toggle(site: string) {
    const next = selected.includes(site)
      ? selected.filter((s) => s !== site)
      : [...selected, site];
    onChange(joinSites(next));
  }

  // Fallback: free-text input when no sites loaded yet
  if (sites.length === 0) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
        placeholder="e.g. Bayside"
        disabled={disabled}
      />
    );
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-lg border px-3 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: "var(--neutral-300)", background: "white" }}
      >
        {selected.length === 0 ? (
          <span style={{ color: "var(--neutral-400)" }}>Select sites…</span>
        ) : (
          selected.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
              style={{ background: "var(--blue-100)", color: "var(--blue-700)" }}
            >
              {s}
              {!disabled && (
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); toggle(s); }}
                  className="cursor-pointer opacity-60 hover:opacity-100"
                >
                  ×
                </span>
              )}
            </span>
          ))
        )}
        <span className="ml-auto shrink-0 text-[10px]" style={{ color: "var(--neutral-400)" }}>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-lg border shadow-md"
          style={{ background: "white", borderColor: "var(--neutral-200)" }}
        >
          {sites.map((s) => {
            const checked = selected.includes(s);
            return (
              <label
                key={s}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-neutral-50"
                style={{ color: "var(--neutral-800)" }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(s)}
                  className="h-3.5 w-3.5 rounded"
                  style={{ accentColor: "var(--brand)" }}
                />
                {s}
              </label>
            );
          })}
          {selected.length > 0 && (
            <div
              className="border-t px-3 py-2"
              style={{ borderColor: "var(--neutral-100)" }}
            >
              <button
                type="button"
                onClick={() => onChange("")}
                className="text-xs"
                style={{ color: "var(--neutral-400)" }}
              >
                Clear all
              </button>
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
    hour: "2-digit", minute: "2-digit",
  });
}
