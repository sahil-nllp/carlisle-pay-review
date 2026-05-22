"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
export function UsersClient({ initialUsers }: { initialUsers: AdminUser[] }) {
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
  onSuccess,
  onCancel,
}: {
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
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className={INPUT}
            placeholder="jane@carlislehealth.com.au"
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className={INPUT}
            placeholder="Min. 8 characters"
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
          <input
            type="text"
            value={form.site ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, site: e.target.value || null }))}
            className={INPUT}
            placeholder="e.g. Bayside"
            disabled={form.role !== "regional_manager"}
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
          disabled={isPending}
          className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 transition-colors"
          style={{ background: "var(--neutral-900)", color: "white" }}
        >
          {isPending ? "Creating…" : "Create user"}
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
//  Edit user form
// ─────────────────────────────────────────────────────────────────────────────
function EditUserForm({
  user,
  onSuccess,
  onCancel,
}: {
  user: AdminUser;
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
          <input
            type="text"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            className={INPUT}
            disabled={role !== "regional_manager"}
            placeholder="e.g. Bayside"
          />
        </Field>
        <Field label="New password (leave blank to keep)">
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={INPUT}
            placeholder="Min. 8 characters"
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
