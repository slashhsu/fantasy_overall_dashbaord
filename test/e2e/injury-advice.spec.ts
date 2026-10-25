import { expect, test } from "@playwright/test";
test("injury candidates, return evidence and dismissal stay inside the website", async ({ page }, info) => {
  let phase: "injured" | "returned" = "injured";
  await page.route("**/api/injury-advice?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const star = { playerKey: "demo.p.900001", name: "Demo Lead Guard", team: "BOS", position: "PG", status: phase === "injured" ? "O" : "", statusKnown: true, weekGames: 3, weekMinutes: 32, monthGames: 10, seasonGames: 20, monthMinutes: 32, seasonMinutes: 32, playedDates: phase === "returned" ? [new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)] : [] };
    const backup = { ...star, playerKey: "demo.p.900002", name: "Demo Backup Guard", status: "", weekMinutes: phase === "injured" ? 29 : 20, monthMinutes: 19, seasonMinutes: 19, playedDates: [] };
    await route.fulfill({ json: { leagueKey: params.get("leagueKey"), teamKey: params.get("teamKey"), generatedAt: new Date().toISOString(), observationDate: new Date().toISOString().slice(0, 10), status: "complete", demoMode: true, warnings: [], watchlist: [], exclusionCounts: {}, players: [star, backup], rosterKeys: phase === "returned" ? [backup.playerKey] : [], opportunities: phase === "injured" ? [{ id: `${star.playerKey}:${backup.playerKey}`, injuredKey: star.playerKey, beneficiaryKey: backup.playerKey, benefiting: true, score: 9.5, helps: ["AST", "STL"], minutesDelta: 10, group: "featured", reason: "rotation-gain", relatedInjuries: [{ playerKey: star.playerKey, period: "lastmonth", games: 10, minutes: 32 }] }] : [] } });
  });
  await page.goto("/login");
  await page.getByLabel("Dashboard password").fill("local-preview-password");
  await page.getByRole("button", { name: "Open dashboard" }).click();
  const section = page.getByRole("region", { name: "傷病機會與復出提醒" });
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByText("近期輪替受益（相關性推估）")).toBeVisible();
  await expect(section.getByText(/平均時間代理，非已確認傷前健康期/)).toBeVisible();
  await expect(section.locator(".injury-watchlist")).not.toHaveAttribute("open", "");
  await expect(section.getByText(/目前推薦分數 9.50/)).toBeVisible();
  await expect(section.getByText("AST", { exact: true })).toBeVisible();
  await page.screenshot({ path: `/tmp/injury-featured-${info.project.name}.png`, fullPage: true });
  await page.evaluate(() => {
    const key = "fantasy-injury:v2:demo.l.101:demo.l.101.t.1";
    const history = JSON.parse(localStorage.getItem(key)!);
    const then = new Date(Date.now() - 3 * 86_400_000).toISOString();
    for (const observation of history.observations) { observation.episodeAt = then; observation.lastInjuredAt = then; observation.lastSeenAt = then; }
    localStorage.setItem(key, JSON.stringify(history));
  });
  phase = "returned";
  await section.getByRole("button", { name: "Refresh injury advice" }).click();
  await expect(section.getByText("已恢復出賽", { exact: true })).toBeVisible();
  await expect(section.locator(".injury-body")).toHaveCSS("padding-left", "20px");
  await expect(section.locator(".injury-card")).toHaveCSS("border-radius", "12px");
  await expect(section.getByText(/替補近期時間已下降/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `/tmp/injury-advice-${info.project.name}.png`, fullPage: true });
  await section.getByRole("button", { name: "忽略此提醒" }).click();
  await expect(section.getByText("已恢復出賽", { exact: true })).toHaveCount(0);
  await page.reload();
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByText(/目前沒有可確認的復出釋出提醒/)).toBeVisible();
});

test("watchlist starts collapsed and switching fantasy teams clears its cards", async ({ page }, info) => {
  await page.route("**/api/injury-advice?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const firstTeam = params.get("teamKey") === "demo.l.101.t.1";
    const star = { playerKey: "demo.p.1", name: "Watch Star", team: "BOS", position: "PG", status: "Q", statusKnown: true, weekGames: 3, weekMinutes: 32, monthGames: 10, seasonGames: 20, monthMinutes: 32, seasonMinutes: 32, playedDates: [] };
    const backup = { ...star, playerKey: "demo.p.2", name: "Watch Backup", status: "", weekGames: 2, weekMinutes: 25, monthMinutes: 19 };
    await route.fulfill({ json: { leagueKey: params.get("leagueKey"), teamKey: params.get("teamKey"), generatedAt: new Date().toISOString(), observationDate: new Date().toISOString().slice(0, 10), status: "complete", demoMode: true, warnings: [], players: [star, backup], rosterKeys: [], opportunities: [], exclusionCounts: firstTeam ? {} : { "新隊伍沒有合格替補": 1 }, watchlist: firstTeam ? [{ id: "watch", injuredKey: star.playerKey, beneficiaryKey: backup.playerKey, benefiting: false, score: 8, helps: ["AST"], minutesDelta: 6, group: "watch", reason: "unconfirmed-absence", relatedInjuries: [{ playerKey: star.playerKey, period: "lastmonth", games: 10, minutes: 32 }] }] : [] } });
  });
  await page.goto("/login");
  await page.getByLabel("Dashboard password").fill("local-preview-password");
  await page.getByRole("button", { name: "Open dashboard" }).click();
  const section = page.getByRole("region", { name: "傷病機會與復出提醒" });
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByText("觀察名單（1）")).toBeVisible();
  await expect(section.getByText("Watch Backup", { exact: true })).not.toBeVisible();
  await section.locator("summary").click();
  await expect(section.getByText("Watch Backup", { exact: true })).toBeVisible();
  await expect(section.getByText("可信程度：低", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `/tmp/injury-watchlist-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Weekly Report", exact: true }).click();
  const team = page.getByRole("combobox", { name: "Weekly report team" });
  await expect(team).toBeEnabled();
  await team.selectOption("demo.l.101.t.2");
  await expect(page.locator(".content-panel")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "Recommendations", exact: true }).click();
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByText(/新隊伍沒有合格替補/)).toBeVisible();
  await expect(section.getByText("Watch Backup", { exact: true })).toHaveCount(0);
  await expect(section.getByText("觀察名單（0）")).toBeVisible();
});
