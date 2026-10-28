import { afterEach, expect, it, vi } from "vitest";
import { fetchRoster } from "@/lib/yahoo";
import { fetchYahooXml } from "@/lib/yahoo-client";
vi.mock("@/lib/yahoo-client", () => ({ fetchYahooXml: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); (globalThis as typeof globalThis & { __fantasyCache?: Map<string, unknown> }).__fantasyCache?.clear(); });
it("shares player stat windows across dated rosters without sharing position selections", async () => {
  vi.mocked(fetchYahooXml).mockImplementation(async (path) => path.includes("/roster;")
    ? `<fantasy_content><team><roster><players><player><player_key>478.p.1</player_key><name><full>A</full></name><display_position>PG</display_position><editorial_team_abbr>BOS</editorial_team_abbr><selected_position><position>${path.includes("2030-01-01") ? "BN" : "PG"}</position></selected_position></player></players></roster></team></fantasy_content>`
    : `<fantasy_content><players><player><player_key>478.p.1</player_key><name><full>A</full></name><player_stats><stats><stat><stat_id>0</stat_id><value>8</value></stat><stat><stat_id>12</stat_id><value>80</value></stat></stats></player_stats></player></players></fantasy_content>`);
  const [a, b] = await Promise.all([fetchRoster("478.l.1", "478.l.1.t.1", "2030-01-01"), fetchRoster("478.l.1", "478.l.1.t.1", "2030-01-02")]);
  expect(a.players[0].selectedPosition).toBe("BN"); expect(b.players[0].selectedPosition).toBe("PG");
  const calls = vi.mocked(fetchYahooXml).mock.calls.map(([path]) => path);
  const stats = calls.filter((path) => path.includes("/stats;"));
  expect(stats.length).toBeGreaterThan(0); expect(new Set(stats).size).toBe(stats.length);
});
