import { expect, test } from "@playwright/test";
test("lazy weekly player tables, sorting, tabs and refresh", async ({ page }, info) => {
  let detailRequests = 0;
  page.on("request", (request) => { if (request.url().includes("/api/matchup-players?")) detailRequests++; });
  await page.goto("/login");
  await page.getByLabel("Dashboard password").fill("local-preview-password");
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await page.getByRole("button", { name: "Weekly Report", exact: true }).click();
  await expect(page.locator(".report-table")).toBeVisible();
  expect(detailRequests).toBe(0);
  await page.getByRole("button", { name: "球員當週數據" }).click();
  await expect(page.locator(".weekly-player-table tbody tr")).toHaveCount(2);
  await expect(page.getByText(/只計入球員當天在此隊且排在有效先發位置/)).toBeVisible();
  const before = detailRequests;
  await page.getByRole("tab", { name: "Box Score Poets", exact: true }).click();
  await expect(page.locator(".weekly-player-table")).toHaveAttribute("aria-label", "Box Score Poets 球員週數據");
  expect(detailRequests).toBe(before);
  await page.locator(".weekly-player-table").getByRole("button", { name: "PTS", exact: true }).click();
  await page.locator(".weekly-player-content .table-scroll").evaluate((element) => { element.scrollLeft = 200; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `/tmp/weekly-players-${info.project.name}.png`, fullPage: true });
  await page.locator(".control-bar").getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => detailRequests).toBeGreaterThan(before);
  await page.getByLabel("Weekly report week").selectOption("18");
  await expect(page.locator(".weekly-player-period").first()).toContainText("Week 18");
});

test("traded Edwards shows separate team contributions and auditable scoring dates", async ({ page }) => {
  await page.route("**/api/matchup-players?*", async (route) => {
    await route.fulfill({ json: { statScope: "fantasy-team-contribution", week: 19, startDate: "2026-10-20", endDate: "2026-10-25", throughDate: "2026-10-25", status: "complete", categories: [{ statId: "10", name: "3-point Shots Made", displayName: "3PM", enabled: true }], teams: [
      { teamKey: "demo.l.101.t.1", name: "神奇跳舞小貓", missingRosterDates: [], scoreboardCheck: { status: "matched", differences: [] }, players: [{ playerKey: "nba.p.1", name: "Anthony Edwards", team: "MIN", position: "SG", rosterDates: ["2026-10-20", "2026-10-21"], scoringDates: ["2026-10-20", "2026-10-21"], stats: { "0": 2, "10": 11 }, missingDates: [] }] },
      { teamKey: "demo.l.101.t.2", name: "交易後隊伍", missingRosterDates: [], players: [{ playerKey: "nba.p.1", name: "Anthony Edwards", team: "MIN", position: "SG", rosterDates: ["2026-10-23"], scoringDates: ["2026-10-23"], stats: { "0": 1, "10": 2 }, missingDates: [] }] },
    ] } });
  });
  await page.goto("/login"); await page.getByLabel("Dashboard password").fill("local-preview-password");
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await page.getByRole("button", { name: "Weekly Report", exact: true }).click();
  await page.getByRole("button", { name: "球員當週數據", exact: true }).click();
  await expect(page.locator(".weekly-player-table").getByText("11", { exact: true })).toBeVisible();
  await expect(page.locator(".weekly-player-content")).not.toContainText("整週 NBA 成績，包含板凳");
  await page.getByText("計分陣容日期（2 天）", { exact: true }).click();
  await expect(page.locator(".weekly-player-table details")).toContainText("2026-10-20, 2026-10-21");
  await page.getByRole("tab", { name: "交易後隊伍", exact: true }).click();
  await expect(page.locator(".weekly-player-table").getByText("2", { exact: true })).toBeVisible();
  await expect(page.locator(".weekly-player-table").getByText("11", { exact: true })).toHaveCount(0);
});
