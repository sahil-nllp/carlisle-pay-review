/**
 * Sidebar navigation definition, with per-role visibility.
 */
import type { UserRole } from "@/lib/types";

export interface NavItem {
  label: string;
  href: string;
  group: "main" | "admin";
  roles: UserRole[];
}

export const NAV_ITEMS: NavItem[] = [
  // Main section
  {
    label: "Dashboard",
    href: "/dashboard",
    group: "main",
    roles: ["hr_admin", "regional_manager", "senior_management", "payroll"],
  },
  {
    label: "Review",
    href: "/review",
    group: "main",
    roles: ["hr_admin", "regional_manager", "senior_management"],
  },
  {
    label: "Approvals",
    href: "/approvals",
    group: "main",
    roles: ["hr_admin", "senior_management"],
  },
  {
    label: "Downloads",
    href: "/downloads",
    group: "main",
    roles: ["hr_admin", "payroll"],
  },

  // Admin section
  {
    label: "Upload Model",
    href: "/admin/upload-model",
    group: "admin",
    roles: ["hr_admin"],
  },
  {
    label: "Cycle Settings",
    href: "/admin/cycle-settings",
    group: "admin",
    roles: ["hr_admin"],
  },
  {
    label: "Users",
    href: "/admin/users",
    group: "admin",
    roles: ["hr_admin"],
  },
  {
    label: "Audit Log",
    href: "/admin/audit",
    group: "admin",
    roles: ["hr_admin"],
  },
];

export function visibleNavItems(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function roleLabel(role: UserRole): string {
  switch (role) {
    case "hr_admin":
      return "HR Admin";
    case "regional_manager":
      return "Regional Manager";
    case "senior_management":
      return "Senior Management";
    case "payroll":
      return "Payroll";
  }
}
