import { expect, test } from "@playwright/test";

test("refresh cooldown, backup notice and Matchups report navigation", async ({ page }, testInfo) => {
  let dashboardRequests = 0;
  await page.route("**/api/dashboard?*", async (route) => {
    dashboardRequests++;
    const response = await route.fetch();
    const data = await response.json();
    data.updateStatus = { fetchedAt: new Date(Date.now() - 600_000).toISOString(), stale: true, nextRefreshAt: new Date(Date.now() + 3000).toISOString() };
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/draft?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.updateStatus = { fetchedAt: new Date().toISOString(), stale: false, nextRefreshAt: new Date(Date.now() + 60_000).toISOString() };
    await route.fulfill({ response, json: data });
  });
  await page.goto("/login");
  await page.getByLabel("Dashboard password").fill("local-preview-password");
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await expect(page.getByText(/Showing backup data/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Refresh \(/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole("button", { name: "Matchups", exact: true }).click();
  const other = page.locator(".matchup-table tbody tr").filter({ has: page.getByRole("button", { name: "View", exact: true }) }).first();
  const teamName = await other.locator("td").first().locator("strong").innerText();
  await other.getByRole("button", { name: "View", exact: true }).click();
  await expect(page.getByRole("button", { name: "Weekly Report" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("Weekly report team").locator("option:checked")).toHaveText(teamName);
  await expect(page.locator(".report-table")).toBeVisible();
  await page.getByRole("button", { name: "Matchups", exact: true }).click();
  const before = dashboardRequests;
  await page.getByRole("button", { name: "Selected", exact: true }).click();
  await expect(page.locator(".report-table")).toBeVisible();
  expect(dashboardRequests).toBe(before);
  await page.screenshot({ path: `/tmp/multi-user-${testInfo.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.route("**/api/dashboard?*", (route) => route.fulfill({ status: 503, json: { error: "Yahoo busy. Retry in 60 seconds.", code: "PROVIDER_BUSY" } }));
  await page.getByLabel("Weekly report week").selectOption("18");
  await expect(page.getByText("資料服務忙碌中，請稍後重試")).toBeVisible();
  await expect(page.getByText("尚無對戰數據")).toHaveCount(0);
  await page.getByRole("link", { name: "Draft Assistant", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Refresh \(/ })).toBeDisabled();
});
