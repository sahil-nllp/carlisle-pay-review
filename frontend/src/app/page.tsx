import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth.server";

/**
 * Root page — bounce to dashboard if logged in, login otherwise.
 */
export default async function RootPage() {
  const user = await getCurrentUser();
  redirect(user ? "/dashboard" : "/login");
}
