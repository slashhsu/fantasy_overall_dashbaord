import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMatchupPlayers } from "@/lib/matchup-players-service";
import { resetCacheForTests } from "@/lib/cache";
import { fetchYahooXml } from "@/lib/yahoo-client";
import { fetchLeagueConfiguration, fetchScoreboard } from "@/lib/yahoo";
vi.mock("@/lib/yahoo-client", () => ({ fetchYahooXml: vi.fn() }));
vi.mock("@/lib/dashboard-service", () => ({ getLeagueSummaries: async () => ({ leagues: [{ leagueKey: "nba.l.1", gameKey: "nba", startWeek: 1, endWeek: 30, userTeam: { key: "nba.l.1.t.1" } }] }) }));
vi.mock("@/lib/yahoo", async (original) => ({ ...await original<typeof import("@/lib/yahoo")>(), fetchScoreboard: vi.fn(), fetchLeagueConfiguration: vi.fn() }));
const teamA = { teamKey: "nba.l.1.t.1", name: "A", stats: {} };
const teamB = { teamKey: "nba.l.1.t.2", name: "B", stats: {} };
const options = { leagueKey: "nba.l.1", week: 1, matchupId: `${teamA.teamKey}::${teamB.teamKey}` };
const playerXml = (key: string) => `<player><player_key>${key}</player_key><name><full>${key}</full></name><editorial_team_abbr>BOS</editorial_team_abbr><display_position>PG</display_position></player>`;
beforeEach(() => {
  resetCacheForTests(); vi.stubEnv("YAHOO_DEMO_MODE", "false");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-03T20:00:00Z"));
  vi.mocked(fetchScoreboard).mockResolvedValue([{ id: options.matchupId, week: 1, startDate: "2025-12-31", endDate: "2026-01-04", status: "midevent", isPlayoffs: false, isConsolation: false, teamA, teamB }]);
  vi.mocked(fetchLeagueConfiguration).mockResolvedValue({ categories: [{ statId: "12", name: "Points", displayName: "PTS", enabled: true, position: 0 }], rosterPositions: [], scoringFormat: "each-category" });
  vi.mocked(fetchYahooXml).mockImplementation(async (path) => {
    if (path.includes("/roster")) {
      const firstTeam = path.includes(teamA.teamKey);
      const date = path.match(/date=([\d-]+)/)![1];
      const keys = firstTeam ? date === "2025-12-31" ? ["nba.p.old"] : ["nba.p.new"] : ["nba.p.old"];
      return `<fantasy_content><roster><players>${keys.map(playerXml).join("")}</players></roster></fantasy_content>`;
    }
    const date = path.match(/date=([\d-]+)/)![1];
    const keys = path.match(/player_keys=([^/]+)/)![1].split(",");
    return `<fantasy_content><players>${keys.map((key) => playerXml(key).replace('</player>', `<player_stats><coverage_type>date</coverage_type><date>${date}</date><stats><stat><stat_id>0</stat_id><value>1</value></stat><stat><stat_id>12</stat_id><value>10</value></stat></stats></player_stats></player>`)).join("")}</players></fantasy_content>`;
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("matchup player history", () => {
  it("unions daily memberships, shares players across teams and includes all-week stats", async () => {
    const data = await getMatchupPlayers(options);
    expect(data.throughDate).toBe("2026-01-03");
    expect(data.teams[0].players.map((player) => player.playerKey).sort()).toEqual(["nba.p.new", "nba.p.old"]);
    expect(data.teams[1].players[0].playerKey).toBe("nba.p.old");
    expect(data.teams[0].players.every((player) => player.stats["12"] === 40)).toBe(true);
    const count = vi.mocked(fetchYahooXml).mock.calls.length;
    await getMatchupPlayers(options);
    expect(fetchYahooXml).toHaveBeenCalledTimes(count);
  });
  it("marks missing roster and stats dates without zero filling", async () => {
    const original = vi.mocked(fetchYahooXml).getMockImplementation()!;
    vi.mocked(fetchYahooXml).mockImplementation(async (path) => {
      if (path.includes("date=2026-01-01")) throw new Error("missing upstream");
      return original(path);
    });
    const data = await getMatchupPlayers(options);
    expect(data.status).toBe("partial");
    expect(data.teams[0].missingRosterDates).toContain("2026-01-01");
    expect(data.teams[0].players[0].stats["12"]).toBeNull();
  });
  it("uses Yahoo game weeks when scoreboard dates are absent", async () => {
    const scoreboard = (await fetchScoreboard("nba.l.1", 1))[0];
    vi.mocked(fetchScoreboard).mockResolvedValue([{ ...scoreboard, startDate: undefined, endDate: undefined }]);
    const original = vi.mocked(fetchYahooXml).getMockImplementation()!;
    vi.mocked(fetchYahooXml).mockImplementation(async (path) => path.endsWith("/game_weeks")
      ? '<fantasy_content><game_weeks><game_week><week>1</week><start>2025-12-31</start><end>2026-01-04</end></game_week></game_weeks></fantasy_content>' : original(path));
    const data = await getMatchupPlayers(options);
    expect(data.startDate).toBe("2025-12-31"); expect(data.endDate).toBe("2026-01-04");
  });
  it("does not request rosters for future weeks and rejects foreign matchups", async () => {
    vi.setSystemTime(new Date("2025-12-30T20:00:00Z"));
    expect((await getMatchupPlayers(options)).status).toBe("not-started");
    expect(fetchYahooXml).not.toHaveBeenCalled();
    await expect(getMatchupPlayers({ ...options, matchupId: "foreign" })).rejects.toThrow();
  });
});
