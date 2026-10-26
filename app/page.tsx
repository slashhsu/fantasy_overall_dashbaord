import type { Metadata } from "next";
import { PublicHome } from "@/components/public-home";
import { PRIVATE_ROBOTS, PUBLIC_HOME_METADATA, publicRobots } from "@/lib/seo";
import { DashboardApp } from "@/components/dashboard-app";
import { isPageAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  if (await isPageAuthenticated()) return { title: "Fantasy Basketball Desk", robots: PRIVATE_ROBOTS };
  return { ...PUBLIC_HOME_METADATA, robots: publicRobots() };
}
export default async function HomePage() {
  return await isPageAuthenticated() ? <DashboardApp /> : <PublicHome />;
}
