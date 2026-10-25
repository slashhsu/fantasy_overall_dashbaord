import { expect, test, type Page } from "@playwright/test";
import { MODEL_HELP_KEYS } from "../../lib/help-content";
const login = async (page: Page) => {
  await page.goto("/login");
  await page.getByLabel("Dashboard password").fill("local-preview-password");
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Best available players" })).toBeVisible();
};
async function fits(page: Page) {
  const rect = await page.getByRole("tooltip").boundingBox();
  const size = page.viewportSize()!;
  expect(rect).not.toBeNull(); expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(size.width); expect(rect!.y + rect!.height).toBeLessThanOrEqual(size.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}
test("guide requires login, shares definitions and makes no data API requests", async ({ page }, info) => {
  await page.goto("/guide"); await expect(page).toHaveURL(/\/login$/);
  await login(page);
  await page.waitForLoadState("networkidle");
  const requests: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url()); });
  expect(await page.locator("button button, label .help-trigger, summary .help-trigger").count()).toBe(0);
  const injury = page.getByRole("region", { name: "傷病機會與復出提醒" });
  await injury.scrollIntoViewIfNeeded();
  await expect(injury.locator(".injury-body")).toHaveAttribute("aria-busy", "false");
  const hint = page.getByRole("button", { name: "In play 說明", exact: true });
  await hint.scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  requests.length = 0;
  await expect(page.locator(".control-bar .help-trigger")).toHaveCount(0);
  if (info.project.name === "chromium") await hint.hover(); else await hint.tap();
  await expect(page.getByRole("tooltip")).toContainText("2.75");
  await fits(page);
  await page.keyboard.press("Escape"); await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.locator(".arena-intro").getByRole("link", { name: "使用說明書" }).click();
  await expect(page).toHaveURL(/\/guide$/); await expect(page.getByRole("heading", { name: "使用說明書", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "說明書目錄" }).getByRole("link", { name: "推薦與摘要" }).click();
  await expect(page.locator("#probability")).toContainText("5 個百分點");
  await expect(page.locator("#confidence")).toContainText("不是預測命中率");
  await page.getByRole("navigation", { name: "說明書目錄" }).getByRole("link", { name: "統計分類詞彙" }).click();
  await expect(page.locator("#stat-20")).toContainText("沒有 % 單位");
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `/tmp/guide-${info.project.name}.png`, fullPage: true });
});
test("dashboard, weekly details and matchups expose correct units without interfering with sorting", async ({ page }, info) => {
  await login(page);
  const table = page.locator(".recommendation-table");
  await expect(table.locator("tbody tr").first()).toBeVisible();
  expect(await table.locator("tbody tr").first().locator("td").count()).toBe(await table.locator("th").count());
  const reb = table.getByRole("button", { name: "REB", exact: true });
  await reb.click(); const sorted = await reb.locator("..").getAttribute("aria-sort");
  for (const name of ["PTS", "REB", "AST", "STL", "BLK", "3PM", "TO", "Player", "Team", "Game", "#"]) {
    await expect(table.getByRole("columnheader", { name, exact: true }).locator(".help-trigger")).toHaveCount(0);
  }
  await expect(table.locator("tbody .help-trigger")).toHaveCount(0);
  await expect(page.getByText("以下為單場預估，非當週實績", { exact: true })).toBeVisible();
  const scoreHelp = table.getByRole("button", { name: "推薦分數 說明", exact: true });
  await scoreHelp.click(); await expect(page.getByRole("tooltip")).toContainText("預期分類數");
  await expect(reb.locator("..")).toHaveAttribute("aria-sort", sorted!);
  await page.waitForTimeout(50); await fits(page);
  // The portal must remain visible even inside a horizontally scrolled table.
  expect(await page.getByRole("tooltip").evaluate((element) => element.parentElement === document.body)).toBe(true);
  await page.screenshot({ path: `/tmp/help-recommendations-${info.project.name}.png` });
  await page.evaluate(() => window.scrollBy(0, 250));
  await page.waitForTimeout(50); await fits(page);
  await scoreHelp.click(); await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.getByRole("button", { name: "Weekly Report", exact: true }).click();
  await page.getByRole("button", { name: "Priority 說明", exact: true }).click();
  await expect(page.getByRole("tooltip")).toContainText("不是機率");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "球員當週數據", exact: true }).click();
  const weekly = page.locator(".weekly-player-table");
  await expect(weekly).toBeVisible();
  await expect(page.locator(".weekly-player-content .help-trigger")).toHaveCount(0);
  await expect(page.locator(".weekly-player-content")).toContainText("球員加總不一定等於球隊週報比分");
  await page.getByRole("button", { name: "Matchups", exact: true }).click();
  await expect(page.locator(".matchup-table .help-trigger")).toHaveCount(0);
  await page.getByRole("button", { name: "Raw Data", exact: true }).click();
  await expect(page.locator(".raw-help .help-trigger")).toHaveCount(0);
  await expect(page.locator(".raw-help a")).toHaveAttribute("href", "/guide#raw");
  const topics = await page.locator("[data-help-topic]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-help-topic")));
  expect(topics.every((topic) => MODEL_HELP_KEYS.includes(topic as typeof MODEL_HELP_KEYS[number]))).toBe(true);
  await expect(page.locator(".raw-data")).toContainText('"recommendations"');
});
test("draft help supports keyboard, touch, selection and all auction columns", async ({ page }, info) => {
  await page.route("**/api/draft?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.players[0].draftAnalysis.averagePick = null;
    data.players[0].yahooRank = 1;
    await route.fulfill({ response, json: data });
  });
  await login(page); await page.getByRole("link", { name: "Draft Assistant", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Best picks now/ })).toBeVisible();
  const table = page.locator(".draft-table");
  await expect(table.locator(".adp-proxy")).toHaveText("Yahoo rank 代理，非 ADP");
  const row = table.locator("tbody tr").first();
  await row.click(); const selected = await row.getAttribute("aria-selected");
  await expect(page.locator(".draft-control-bar .help-trigger")).toHaveCount(0);
  await expect(page.locator(".draft-summary-strip .help-trigger")).toHaveCount(0);
  for (const name of ["ADP", "Player", "#", "Pick"]) await expect(table.getByRole("columnheader", { name, exact: true }).locator(".help-trigger")).toHaveCount(0);
  await expect(table.locator("tbody .help-trigger")).toHaveCount(0);
  const help = table.getByRole("button", { name: "Team fit 說明", exact: true });
  await help.focus(); await expect(page.getByRole("tooltip")).toContainText("不是預期勝率");
  await page.keyboard.press("Escape"); await expect(page.getByRole("tooltip")).toHaveCount(0);
  await help.click(); await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(row).toHaveAttribute("aria-selected", selected!);
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "Draft mode" }).selectOption("salary-cap");
  await expect(table.getByRole("columnheader", { name: "AAV", exact: true }).locator(".help-trigger")).toHaveCount(0);
  const price = table.getByRole("button", { name: "Max bid 說明", exact: true });
  await price.click(); await expect(page.getByRole("tooltip")).toContainText("其他空位至少各 $1");
  await page.waitForTimeout(50); await fits(page);
  await page.screenshot({ path: `/tmp/help-draft-${info.project.name}.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "使用說明書", exact: true }).click();
  await expect(page).toHaveURL(/\/guide$/);
});

test("mixed model score units alone receive per-player hints", async ({ page }) => {
  await page.route("**/api/dashboard?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.recommendations.forEach((player: { scoreType: string }, index: number) => { player.scoreType = index === 0 ? "matchup-probability" : "expected-categories"; });
    await route.fulfill({ response, json: data });
  });
  await login(page);
  const table = page.locator(".recommendation-table");
  await expect(table.locator("tbody .help-trigger").first()).toBeVisible();
  await table.locator("tbody .help-trigger").first().click();
  await expect(page.getByRole("tooltip")).toContainText("5 個百分點");
  await page.keyboard.press("Escape");
  await table.locator("tbody .help-trigger").nth(1).click();
  await expect(page.getByRole("tooltip")).toContainText("預期分類數");
});
