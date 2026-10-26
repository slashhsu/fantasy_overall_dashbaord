import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
// This smoke test uses fixture credentials and a one-of-two demo allowlist.
// API unit tests additionally cover the two exact production league IDs.
const login = async (page: import("@playwright/test").Page, password: string) => {
  await page.goto("/login");
  await page.getByLabel("Dashboard password").fill(password);
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("combobox", { name: "League", exact: true })).toBeVisible();
};
test("member league restrictions, admin access, switching and logout", async ({ page }, info) => {
  await login(page, "local-preview-member-password");
  const league = page.getByRole("combobox", { name: "League", exact: true });
  await expect(league.locator("option")).toHaveCount(1);
  await expect(league.locator("option")).toHaveText(["Downtown Dynasty"]);
  expect((await page.request.get("/api/dashboard?leagueKey=demo.l.202&week=18&date=2026-10-25")).status()).toBe(403);
  expect((await page.request.get("/api/draft?leagueKey=demo.l.202")).status()).toBe(403);
  expect(await (await page.request.get("/api/session")).json()).toMatchObject({ authenticated: true, role: "member" });
  await page.getByRole("link", { name: "Draft Assistant", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "League", exact: true }).locator("option")).toHaveCount(1);
  await page.screenshot({ path: `/tmp/member-access-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await (await page.request.get("/api/session")).json()).toMatchObject({ authenticated: false });
  await login(page, "local-preview-password");
  await expect(league.locator("option")).toHaveCount(2);
  await league.selectOption("demo.l.202");
  await expect(page.getByRole("heading", { name: "Fast Break", exact: true })).toBeVisible();
  expect(await (await page.request.get("/api/session")).json()).toMatchObject({ authenticated: true, role: "admin" });
  expect((await page.request.get("/api/draft?leagueKey=demo.l.202")).status()).toBe(200);
});
test("pre-role sessions require a fresh login", async ({ page }) => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 1000 })).toString("base64url");
  const signature = createHmac("sha256", "local-preview-signing-secret-at-least-32-characters").update(payload).digest("base64url");
  await page.context().addCookies([{ name: "fantasy_session", value: `${payload}.${signature}`, domain: "127.0.0.1", path: "/", httpOnly: true }]);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /看懂對戰/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "League", exact: true })).toHaveCount(0);
  await page.goto("/draft");
  await expect(page).toHaveURL(/\/login$/);
});
