import { afterEach, describe, expect, it, vi } from "vitest";
import { isPageAuthenticated } from "@/lib/auth";
import HomePage, { generateMetadata } from "@/app/page";
import { PublicHome } from "@/components/public-home";
import { DashboardApp } from "@/components/dashboard-app";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { PRIVATE_ROBOTS, SITE_URL } from "@/lib/seo";
vi.mock("@/lib/auth", () => ({ isPageAuthenticated: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("public discovery without exposing private workspaces", () => {
  it("serves a public anonymous homepage with the confirmed canonical and index permission", async () => {
    vi.stubEnv("VERCEL_ENV", "production"); vi.mocked(isPageAuthenticated).mockResolvedValue(false);
    expect((await HomePage()).type).toBe(PublicHome);
    const metadata = await generateMetadata();
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe(`${SITE_URL}/`);
    expect(metadata.openGraph).toMatchObject({ url: `${SITE_URL}/` });
  });
  it("keeps signed-in dashboards private and never returns the introduction in place of the dashboard", async () => {
    vi.mocked(isPageAuthenticated).mockResolvedValue(true);
    expect((await HomePage()).type).toBe(DashboardApp);
    expect((await generateMetadata()).robots).toEqual(PRIVATE_ROBOTS);
  });
  it("keeps preview deployments out of the index", async () => {
    vi.stubEnv("VERCEL_ENV", "preview"); vi.mocked(isPageAuthenticated).mockResolvedValue(false);
    expect((await generateMetadata()).robots).toEqual(PRIVATE_ROBOTS);
  });
  it("publishes only the public canonical URL in the sitemap and permits crawling to discover noindex", () => {
    expect(sitemap()).toEqual([{ url: "https://www.fantasybasketball.fun/" }]);
    expect(robots()).toEqual({ rules: { userAgent: "*", allow: "/", disallow: "/api/" }, sitemap: `${SITE_URL}/sitemap.xml` });
  });
});
