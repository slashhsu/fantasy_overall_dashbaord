import { expect, test } from "@playwright/test";
const origin = "https://www.fantasybasketball.fun";
test("public homepage is crawlable and private routes remain protected", async ({ page }, info) => {
  test.setTimeout(120_000); // Includes first-time compilation of private routes in the dev server.
  const apiRequests: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url()); });
  const response = await page.goto("/");
  expect(response?.status()).toBe(200); await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /看懂對戰/ })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  expect(new URL((await page.locator('link[rel="canonical"]').getAttribute("href"))!).href).toBe(`${origin}/`);
  await expect(page.getByRole("combobox", { name: "League", exact: true })).toHaveCount(0);
  expect(apiRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `/tmp/public-home-${info.project.name}.png`, fullPage: true });
  const googlebot = await page.request.get("/", { headers: { "User-Agent": "Googlebot" } });
  expect(googlebot.status()).toBe(200);
  expect(await googlebot.text()).toContain('name="robots" content="index, follow"');
  expect(await googlebot.text()).not.toContain('content="noindex');
  const sitemap = await page.request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200); const xml = await sitemap.text();
  expect(xml).toContain(`<loc>${origin}/</loc>`); expect(xml.match(/<loc>/g)).toHaveLength(1);
  const robots = await page.request.get("/robots.txt");
  expect(robots.status()).toBe(200); expect(await robots.text()).toContain(`Sitemap: ${origin}/sitemap.xml`);
  expect(await robots.text()).toContain("Allow: /");
  for (const path of ["/draft", "/guide"]) {
    await page.goto(path); await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  }
  const denied = await page.request.get("/api/leagues");
  expect(denied.status()).toBe(401); expect(denied.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect((await page.request.get("/googlea32a4e91b86cc0d5.html")).status()).toBe(200);
  await page.getByLabel("Dashboard password").fill("local-preview-password");
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await expect(page.getByRole("combobox", { name: "League", exact: true })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  const authenticatedHtml = await page.request.get("/", { headers: { "User-Agent": "Googlebot" } });
  expect(await authenticatedHtml.text()).toContain('name="robots" content="noindex, nofollow"');
  for (const path of ["/draft", "/guide"]) {
    await page.goto(path); await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  }
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /看懂對戰/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "League", exact: true })).toHaveCount(0);
});
