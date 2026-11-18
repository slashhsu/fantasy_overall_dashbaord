import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDashboard } from "@/lib/dashboard-service";
import { getInjuryAdvice } from "@/lib/injury-service";
import { demoCategories, demoFreeAgents, demoLeagues, getDemoMatchups } from "@/lib/demo-data";
import { resetCacheForTests } from "@/lib/cache";
import { fetchNbaSchedule } from "@/lib/nba-schedule";
import { fetchFreeAgentPool, fetchLeagues, fetchLeagueConfiguration, fetchLeagueStandings, fetchLeagueTeamStats, fetchRoster, fetchScoreboard } from "@/lib/yahoo";
import { fetchYahooXml } from "@/lib/yahoo-client";
vi.mock("@/lib/yahoo", async (original) => ({ ...await original<typeof import("@/lib/yahoo")>(), fetchFreeAgentPool: vi.fn(), fetchLeagues: vi.fn(), fetchLeagueConfiguration: vi.fn(), fetchLeagueStandings: vi.fn(), fetchLeagueTeamStats: vi.fn(), fetchRoster: vi.fn(), fetchScoreboard: vi.fn() }));
vi.mock("@/lib/nba-schedule", () => ({ fetchNbaSchedule: vi.fn() }));
vi.mock("@/lib/yahoo-client", () => ({ fetchYahooXml: vi.fn() }));
const league = demoLeagues[0];
const options = { leagueKey: league.leagueKey, week: league.currentWeek, targetDate: "2030-01-01", timeZone: "UTC" };
beforeEach(() => {
  vi.stubEnv("YAHOO_DEMO_MODE", "false"); vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T23:00:00Z")); resetCacheForTests();
  vi.mocked(fetchLeagues).mockResolvedValue([league]);
  vi.mocked(fetchLeagueConfiguration).mockResolvedValue({ categories: demoCategories, rosterPositions: [{ position: "Util", count: 1 }], scoringFormat: "each-category" });
  vi.mocked(fetchScoreboard).mockResolvedValue(getDemoMatchups(league.leagueKey, league.currentWeek));
  vi.mocked(fetchLeagueStandings).mockResolvedValue([]); vi.mocked(fetchLeagueTeamStats).mockResolvedValue([]);
  vi.mocked(fetchRoster).mockResolvedValue({ available: true, players: [] });
  vi.mocked(fetchFreeAgentPool).mockResolvedValue({ players: [{ ...demoFreeAgents[0], team: "BOS", status: "", statWindows: { lastweek: { ...demoFreeAgents[0].stats, "Games Played (GP)": 3, "Minutes Played": 90 }, lastmonth: { ...demoFreeAgents[0].stats, "Games Played (GP)": 10, "Minutes Played": 190 }, season: { ...demoFreeAgents[0].stats, "Games Played (GP)": 20, "Minutes Played": 400 } } }], dataQuality: { status: "complete", projectionSource: "current-season", failedWindows: [], warnings: [], stale: false } });
  vi.mocked(fetchYahooXml).mockImplementation(async (path) => path.includes("status=T")
    ? '<fantasy_content><players><player><player_key>demo.p.999</player_key><name><full>Injured Star</full></name><editorial_team_abbr>BOS</editorial_team_abbr><display_position>PG</display_position><status>O</status></player></players></fantasy_content>'
    : '<fantasy_content><players><player><player_key>demo.p.999</player_key><player_stats><stats><stat><stat_id>0</stat_id><value>5</value></stat><stat><stat_id>2</stat_id><value>160</value></stat></stats></player_stats></player></players></fantasy_content>');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

it.each(["off-day", "in-progress", "final"] as const)("keeps a qualifying injury substitute on an %s while daily streaming still excludes him", async (status) => {
  vi.mocked(fetchNbaSchedule).mockImplementation(async (date) => ({ teamsPlaying: status === "off-day" ? [] : ["BOS", "POR"], schedule: { status: "available", source: "espn", fallbackUsed: false, games: status === "off-day" ? [] : [{ id: date, date, status, homeTeam: "BOS", awayTeam: "POR", startTime: `${date}T20:00:00Z` }] } }));
  expect((await getDashboard(options)).recommendations).toEqual([]);
  vi.mocked(fetchNbaSchedule).mockClear();
  const result = await getInjuryAdvice({ ...options, date: options.targetDate, teamKey: league.userTeam.key, watchKeys: [] });
  expect(result.status).toBe("complete");
  expect(result.opportunities).toHaveLength(1);
  expect(result.opportunities[0]).toMatchObject({ beneficiaryKey: demoFreeAgents[0].playerKey, reason: "rotation-gain", minutesDelta: 11 });
  expect(fetchNbaSchedule).not.toHaveBeenCalled();
  expect(result.diagnostics).toMatchObject({ injured: 1, available: 1, ranked: 1 });
});
