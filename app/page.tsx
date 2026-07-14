import { redirect } from "next/navigation";
import { DashboardApp } from "@/components/dashboard-app";
import { isPageAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!(await isPageAuthenticated())) redirect("/login");
  return <DashboardApp />;
}
