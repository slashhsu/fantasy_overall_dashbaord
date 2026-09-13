import { expect, test } from "@playwright/test";

const login = async (page: import("@playwright/test").Page) => {
  await page.goto("/login");
  await page.getByLabel("Dashboard password").fill("local-preview-password");
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await expect(page).toHaveURL(/\/$/);
};

test("login, timezone, refresh, and hidden experimental navigation", async ({ page }) => {
  await login(page);
  await expect(page.locator(".report-table")).toBeVisible();
  await expect(page.getByRole("button", { name: "Recommendations" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Draft Assistant/i })).toHaveCount(0);
  const timezone = page.getByLabel("Time zone");
  await expect(timezone).toBeVisible();
  await timezone.selectOption("Asia/Taipei");
  await expect(timezone).toHaveValue("Asia/Taipei");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.locator(".report-table tbody tr").first()).toBeVisible();
});

test("mock salary-cap flow records a team and winning bid", async ({ page }) => {
  await login(page);
  await page.goto("/draft");
  await expect(page.getByRole("heading", { name: "Best picks now" })).toBeVisible();
  await page.getByLabel("Draft mode").selectOption("salary-cap");
  await expect(page.getByLabel("Auction budget")).toHaveValue("200");
  await page.locator(".draft-row-actions button").first().click();
  const dialog = page.getByRole("dialog", { name: /Record/ });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Winning bid").fill("25");
  await dialog.getByRole("button", { name: "Record pick" }).click();
  await expect(page.locator(".draft-history-list")).toContainText("#1");
});

test("mobile controls contain wide tables without page overlap", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only layout assertion");
  await login(page);
  await expect(page.locator(".table-scroll").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.goto("/draft");
  await expect(page.locator(".draft-table-scroll")).toBeVisible();
  const draftOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(draftOverflow).toBeLessThanOrEqual(1);
});
