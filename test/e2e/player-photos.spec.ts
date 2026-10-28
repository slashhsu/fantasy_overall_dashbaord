import { expect, test } from "@playwright/test";

// A deterministic portrait fixture verifies rendering without depending on Yahoo CDN uptime.
const portrait = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#dbe9f0"/><circle cx="40" cy="28" r="17" fill="#a46a45"/><path d="M8 80q0-40 32-40t32 40" fill="#e87825"/></svg>';

test("player portraits render and survive table scrolling on desktop and mobile", async ({ page }, testInfo) => {
  await page.route("https://s.yimg.com/avatar-test/**", async (route) => {
    await route.fulfill({ contentType: "image/svg+xml", body: portrait, headers: { "cache-control": "public, max-age=3600" } });
  });
  await page.route("**/api/dashboard?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.recommendations.forEach((player: { headshotUrl?: string }, index: number) => {
      player.headshotUrl = `https://s.yimg.com/avatar-test/${index}.svg`;
    });
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/draft?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.players?.forEach((player: { headshotUrl?: string }, index: number) => {
      player.headshotUrl = `https://s.yimg.com/avatar-test/${index}.svg`;
    });
    await route.fulfill({ response, json: data });
  });
  await page.goto("/login");
  await page.getByLabel("Dashboard password").fill("local-preview-password");
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await page.getByLabel("推薦期間", { exact: true }).selectOption("daily");
  const avatar = page.locator(".recommendation-table .player-avatar").first();
  const image = avatar.locator("img");
  await expect(image).toHaveClass(/is-loaded/);
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(80);
  const size = await avatar.boundingBox();
  expect(size?.width).toBe(32);
  expect(size?.height).toBe(32);
  await page.locator(".table-scroll").first().evaluate((element) => { element.scrollLeft = 400; });
  await expect(avatar).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `/tmp/player-photos-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("link", { name: "Draft Assistant", exact: true }).click();
  await expect(page.locator(".draft-table .player-avatar-photo").first()).toHaveClass(/is-loaded/);
  await expect(page.locator(".draft-player-detail .player-avatar-photo").first()).toHaveClass(/is-loaded/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
