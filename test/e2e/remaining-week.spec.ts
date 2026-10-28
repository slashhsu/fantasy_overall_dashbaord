import { expect, test } from "@playwright/test";

test("weekly defaults, sortable counts, daily switch and last-selection wins", async ({ page }, info) => {
  test.setTimeout(120_000);
  const requests: string[] = [];
  await page.route("**/api/dashboard?*", async (route) => {
    const url = new URL(route.request().url());
    const horizon = url.searchParams.get("recommendationHorizon") ?? "daily";
    requests.push(horizon);
    url.searchParams.set("recommendationHorizon", "daily");
    const response = await route.fetch({ url: url.href });
    const data = await response.json();
    data.recommendationHorizon = horizon;
    data.recommendationPeriod = { startDate: data.targetDate, endDate: data.targetDate, timeZone: data.timeZone, status: "complete" };
    data.recommendations.forEach((row: { remainingGames: number; usableGames: number; remainingGamesComplete: boolean }, index: number) => {
      row.remainingGames = index % 4; row.usableGames = index % 3; row.remainingGamesComplete = true;
    });
    await route.fulfill({ response, json: data });
  });
  await page.goto("/login");
  await page.getByLabel("Dashboard password").fill("local-preview-password");
  await page.getByRole("button", { name: "Open dashboard" }).click();
  const horizon = page.getByLabel("推薦期間", { exact: true });
  await expect(horizon).toHaveValue("remaining-week");
  const table = page.locator(".recommendation-table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("button", { name: "預估可排入場次", exact: true })).toBeVisible();
  await table.getByRole("button", { name: "本週剩餘場次", exact: true }).click();
  const counts = await table.locator("tbody tr td:nth-child(5)").allTextContents();
  expect(counts.map(Number)).toEqual([...counts.map(Number)].sort((a, b) => b - a));
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `/tmp/remaining-week-${info.project.name}.png`, fullPage: true });
  await horizon.selectOption("daily");
  await expect(table.getByRole("button", { name: "預估可排入場次", exact: true })).toHaveCount(0);
  await expect(table.getByRole("button", { name: "本週剩餘場次", exact: true })).toBeVisible();
  await horizon.selectOption("remaining-week");
  await horizon.selectOption("daily");
  await expect(horizon).toHaveValue("daily");
  await expect(table).toBeVisible();
  await expect(table.getByRole("button", { name: "預估可排入場次", exact: true })).toHaveCount(0);
  expect(requests).toContain("remaining-week"); expect(requests).toContain("daily");
});
