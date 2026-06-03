import { redirect } from "next/navigation";
import { LayoutClient } from "@/components/layout-client";
import { getCurrentUser } from "@/lib/auth.server";

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <LayoutClient user={user}>{children}</LayoutClient>;
}
