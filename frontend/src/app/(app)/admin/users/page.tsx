import { getUsersServer } from "@/lib/admin.server";
import { UsersClient } from "@/components/users-client";

export default async function UsersPage() {
  const users = await getUsersServer();

  return (
    <div style={{ animation: "slideUp 0.4s ease both" }}>
      <p className="mb-6 text-xs" style={{ color: "var(--neutral-500)" }}>
        Manage HR admins, regional managers, senior management, and payroll users.
      </p>
      <UsersClient initialUsers={users} />
    </div>
  );
}
