import { getUsersServer } from "@/lib/admin.server";
import { getSiteNamesServer } from "@/lib/cycles.server";
import { UsersClient } from "@/components/users-client";

export default async function UsersPage() {
  const [users, sites] = await Promise.all([
    getUsersServer(),
    getSiteNamesServer(),
  ]);

  return (
    <div style={{ animation: "slideUp 0.4s ease both" }}>
      <p className="mb-6 text-xs" style={{ color: "var(--neutral-500)" }}>
        Manage HR admins, regional managers, senior management, and payroll users.
      </p>
      <UsersClient initialUsers={users} sites={sites} />
    </div>
  );
}
