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
const playerXml = (key: string) => `<player><player_key>${key}</player_key><name><full>${key}</full></name><editorial_team_abbr>BOS</editorial_team_abbr><display_position>PG</display_position><selected_position><position>PG</position></selected_position></player>`;
beforeEach(() => {
  resetCacheForTests(); vi.stubEnv("YAHOO_DEMO_MODE", "false");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-03T20:00:00Z"));
  vi.mocked(fetchScoreboard).mockResolvedValue([{ id: options.matchupId, week: 1, startDate: "2025-12-31", endDate: "2026-01-04", status: "midevent", isPlayoffs: false, isConsolation: false, teamA, teamB }]);
  vi.mocked(fetchLeagueConfiguration).mockResolvedValue({ categories: [{ statId: "12", name: "Points", displayName: "PTS", enabled: true, position: 0 }], rosterPositions: [{ position: "PG", count: 1 }], scoringFormat: "each-category" });
  vi.mocked(fetchYahooXml).mockImplementation(async (path) => {
    if (path.includes("/roster")) {
      const firstTeam = path.includes(teamA.teamKey);
      const date = path.match(/date=([\d-]+)/)![1];
      const keys = firstTeam ? date === "2025-12-31" ? ["nba.p.old"] : ["nba.p.new"] : date === "2025-12-31" ? [] : ["nba.p.old"];
      return `<fantasy_content><roster><players>${keys.map(playerXml).join("")}</players></roster></fantasy_content>`;
    }
    const date = path.match(/date=([\d-]+)/)![1];
    const keys = path.match(/player_keys=([^/]+)/)![1].split(",");
    return `<fantasy_content><players>${keys.map((key) => playerXml(key).replace('</player>', `<player_stats><coverage_type>date</coverage_type><date>${date}</date><stats><stat><stat_id>0</stat_id><value>1</value></stat><stat><stat_id>12</stat_id><value>10</value></stat></stats></player_stats></player>`)).join("")}</players></fantasy_content>`;
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("matchup player history", () => {
  it("attributes each player only to that team’s actual starting-lineup dates", async () => {
    const data = await getMatchupPlayers(options);
    expect(data.throughDate).toBe("2026-01-03");
    expect(data.teams[0].players.map((player) => player.playerKey).sort()).toEqual(["nba.p.new", "nba.p.old"]);
    expect(data.teams[1].players[0].playerKey).toBe("nba.p.old");
    expect(data.statScope).toBe("fantasy-team-contribution");
    expect(data.teams[0].players.find((player) => player.playerKey === "nba.p.old")?.stats["12"]).toBe(10);
    expect(data.teams[0].players.find((player) => player.playerKey === "nba.p.new")?.stats["12"]).toBe(30);
    expect(data.teams[1].players[0].stats["12"]).toBe(30);
    expect(data.teams[0].players.find((player) => player.playerKey === "nba.p.old")?.scoringDates).toEqual(["2025-12-31"]);
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
    expect(data.teams[0].players.find((player) => player.playerKey === "nba.p.new")?.stats["12"]).toBe(20);
    expect(data.teams[0].players[0].incompleteStats).toContain("12");
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

it("credits Edwards 11 threes to the original team and only 2 to his post-trade team, recomputing each team's shooting ratio", async () => {
  const scoreboard = (await fetchScoreboard("nba.l.1", 1))[0];
  vi.mocked(fetchScoreboard).mockResolvedValue([{ ...scoreboard, teamA: { ...teamA, name: "神奇跳舞小貓", stats: { "10": "11", "5": ".500" } }, teamB: { ...teamB, stats: { "10": "2", "5": ".100" } } }]);
  vi.mocked(fetchLeagueConfiguration).mockResolvedValue({ categories: [{ statId: "10", name: "3-point Shots Made", displayName: "3PM", enabled: true, position: 0 }, { statId: "5", name: "Field Goal Percentage", displayName: "FG%", enabled: true, position: 1 }], rosterPositions: [{ position: "PG", count: 1 }], scoringFormat: "each-category" });
  const key = "nba.p.1";
  vi.mocked(fetchYahooXml).mockImplementation(async (path) => {
    const date = path.match(/date=([\d-]+)/)![1];
    if (path.includes("/roster")) {
      const inOriginal = date < "2026-01-02";
      const belongs = path.includes(teamA.teamKey) ? inOriginal : !inOriginal;
      const player = playerXml(key).replace(`<full>${key}</full>`, "<full>Anthony Edwards</full>").replace("<position>PG</position>", date === "2026-01-03" ? "<position>BN</position>" : "<position>PG</position>");
      return `<fantasy_content><roster><date>${date}</date><players>${belongs ? player : ""}</players></roster></fantasy_content>`;
    }
    const threes = date === "2025-12-31" ? 6 : date === "2026-01-01" ? 5 : date === "2026-01-02" ? 2 : 0;
    const fgm = date === "2025-12-31" ? 4 : date === "2026-01-01" ? 2 : 1;
    const fga = date === "2026-01-01" ? 2 : 10;
    return `<fantasy_content><players>${playerXml(key).replace('</player>', `<player_stats><coverage_type>date</coverage_type><date>${date}</date><stats><stat><stat_id>0</stat_id><value>1</value></stat><stat><stat_id>10</stat_id><value>${threes}</value></stat><stat><stat_id>3</stat_id><value>${fga}</value></stat><stat><stat_id>4</stat_id><value>${fgm}</value></stat></stats></player_stats></player>`)}</players></fantasy_content>`;
  });
  const data = await getMatchupPlayers(options);
  expect(data.status).toBe("complete");
  const original = data.teams[0].players[0], traded = data.teams[1].players[0];
  expect(original.stats).toMatchObject({ "10": 11, "0": 2, "5": .5 });
  expect(traded.stats).toMatchObject({ "10": 2, "0": 1, "5": .1 });
  expect(original.scoringDates).toEqual(["2025-12-31", "2026-01-01"]);
  expect(traded.scoringDates).toEqual(["2026-01-02"]);
  expect(data.teams.map((team) => team.scoreboardCheck?.status)).toEqual(["matched", "matched"]);
  expect(vi.mocked(fetchYahooXml).mock.calls.some(([path]) => path.includes("/stats;") && path.includes("date=2026-01-03"))).toBe(false);
});

it("shows confirmed bench-only players as zero contribution without querying their NBA stats", async () => {
  const original = vi.mocked(fetchYahooXml).getMockImplementation()!;
  vi.mocked(fetchYahooXml).mockImplementation(async (path) => (await original(path)).replaceAll("<position>PG</position>", "<position>BN</position>"));
  const data = await getMatchupPlayers(options);
  expect(data.status).toBe("complete");
  expect(data.teams.flatMap((team) => team.players).every((player) => player.stats["12"] === 0 && player.stats["0"] === 0 && !player.missingDates.length)).toBe(true);
  expect(vi.mocked(fetchYahooXml).mock.calls.some(([path]) => path.includes("/stats;"))).toBe(false);
});

it("does not infer active positions from eligibility or include whole-week stats when selected positions are missing", async () => {
  const original = vi.mocked(fetchYahooXml).getMockImplementation()!;
  vi.mocked(fetchYahooXml).mockImplementation(async (path) => (await original(path)).replaceAll("<selected_position><position>PG</position></selected_position>", ""));
  const data = await getMatchupPlayers(options);
  expect(data.status).toBe("partial");
  expect(data.teams.flatMap((team) => team.players).every((player) => player.stats["12"] === null && player.missingDates.length > 0)).toBe(true);
});

it("flags scoreboard differences without inventing player statistics to match the team score", async () => {
  const scoreboard = (await fetchScoreboard("nba.l.1", 1))[0];
  vi.mocked(fetchScoreboard).mockResolvedValue([{ ...scoreboard, teamA: { ...teamA, stats: { "12": "999" } } }]);
  const data = await getMatchupPlayers(options);
  expect(data.teams[0].scoreboardCheck).toMatchObject({ status: "different", differences: [{ statId: "12", playerTotal: 40, teamTotal: 999 }] });
  expect(data.teams[0].players.reduce((sum, player) => sum + player.stats["12"]!, 0)).toBe(40);
});

it("marks conflicting same-day ownership as unknown instead of crediting both fantasy teams", async () => {
  const original = vi.mocked(fetchYahooXml).getMockImplementation()!;
  vi.mocked(fetchYahooXml).mockImplementation(async (path) => path.includes(teamB.teamKey) && path.includes("date=2025-12-31")
    ? `<fantasy_content><roster><players>${playerXml("nba.p.old")}</players></roster></fantasy_content>` : original(path));
  const data = await getMatchupPlayers(options);
  expect(data.status).toBe("partial");
  for (const team of data.teams) {
    const player = team.players.find((player) => player.playerKey === "nba.p.old")!;
    expect(player.missingDates).toContain("2025-12-31");
    expect(player.scoringDates).not.toContain("2025-12-31");
  }
});
