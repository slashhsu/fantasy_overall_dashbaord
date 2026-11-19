import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getInjuryAdvice } from "@/lib/injury-service";
import { resetCacheForTests } from "@/lib/cache";
import { getDashboard } from "@/lib/dashboard-service";
import { fetchFreeAgentPool, fetchLeagues, fetchLeagueTeams, fetchRoster } from "@/lib/yahoo";
import { fetchYahooXml } from "@/lib/yahoo-client";
import { fetchNbaSchedule } from "@/lib/nba-schedule";
import type { InjuryResponse } from "@/lib/injury-types";
vi.mock("@/lib/dashboard-service", () => ({ getDashboard: vi.fn() }));
vi.mock("@/lib/nba-schedule", () => ({ fetchNbaSchedule: vi.fn() }));
vi.mock("@/lib/yahoo-client", () => ({ fetchYahooXml: vi.fn() }));
vi.mock("@/lib/yahoo", async (original) => ({ ...await original<typeof import("@/lib/yahoo")>(), fetchLeagues: vi.fn(), fetchLeagueTeams: vi.fn(), fetchRoster: vi.fn(), fetchFreeAgentPool: vi.fn() }));
const options = { leagueKey: "nba.l.1", teamKey: "nba.l.1.t.1", week: 1, date: "2026-10-24", timeZone: "America/Los_Angeles", watchKeys: [] as string[] };
const metadata = (id: number, status = "", ownership = "freeagents", team = "BOS", percent: number | null = 30) => `<player><player_key>nba.p.${id}</player_key><name><full>Player ${id}</full></name><editorial_team_abbr>${team}</editorial_team_abbr><display_position>PG</display_position><status>${status}</status><ownership><ownership_type>${ownership}</ownership_type></ownership>${percent == null ? "" : `<percent_owned><value>${percent}</value></percent_owned>`}</player>`;
const xml = (rows: string[]) => `<fantasy_content><players>${rows.join("")}</players></fantasy_content>`;
let market: string[];
const statsXml = (path: string) => {
  const keys = /player_keys=([^/]+)/.exec(path)?.[1].split(",") ?? [];
  const period = /type=(\w+)/.exec(path)?.[1];
  return xml(keys.map((key) => {
    const star = key === "nba.p.1";
    const games = period === "lastweek" ? 3 : 10;
    const minutes = star ? 32 : period === "lastweek" ? 30 : 19;
    return `<player><player_key>${key}</player_key><player_stats><stats><stat><stat_id>0</stat_id><value>${games}</value></stat><stat><stat_id>26</stat_id><value>${minutes}:00</value></stat></stats></player_stats></player>`;
  }));
};
const source = async (path: string) => {
  if (path.includes(";out=metadata,ownership,percent_owned")) {
    const offset = Number(/start=(\d+)/.exec(path)?.[1] ?? 0);
    return xml(market.slice(offset, offset + 25));
  }
  return statsXml(path);
};
async function finish(first?: InjuryResponse) {
  let response = first ?? await getInjuryAdvice(options);
  for (let i = 0; response.scan?.cursor && !response.scan.blocked && i < 30; i++) response = await getInjuryAdvice({ ...options, cursor: response.scan.cursor });
  return response;
}
beforeEach(() => {
  vi.stubEnv("YAHOO_DEMO_MODE", "false"); vi.stubEnv("APP_PASSWORD", "test-password"); vi.stubEnv("SESSION_SECRET", "test-secret-at-least-thirty-two-characters");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T18:00:00Z")); resetCacheForTests();
  market = [metadata(1, "O", "team", "BOS", 99), metadata(2), metadata(3, "", "team")];
  vi.mocked(fetchLeagues).mockResolvedValue([{ gameKey: "nba", leagueKey: options.leagueKey, name: "League", season: 2026, currentWeek: 1, startWeek: 1, endWeek: 25, userTeam: { key: options.teamKey, name: "My team" } }]);
  vi.mocked(fetchLeagueTeams).mockResolvedValue([{ key: options.teamKey, name: "My team" }, { key: "nba.l.1.t.2", name: "Other team" }]);
  vi.mocked(fetchRoster).mockResolvedValue({ available: true, players: [] });
  vi.mocked(fetchYahooXml).mockImplementation(source);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("complete-market injury advice", () => {
  it("uses all available players without dashboard, schedule, category or recommendation membership", async () => {
    const response = await finish();
    expect(response.status).toBe("complete");
    expect(response.opportunities).toHaveLength(1);
    expect(response.opportunities[0]).toMatchObject({ beneficiaryKey: "nba.p.2", benefiting: true, minutesDelta: 11 });
    expect(response.opportunities[0]).not.toHaveProperty("score");
    expect(response.injuredPlayers?.map((p) => p.playerKey)).toEqual(["nba.p.1"]);
    expect(response.diagnostics).toEqual({ players: 3, injured: 1, available: 1 });
    expect(getDashboard).not.toHaveBeenCalled(); expect(fetchFreeAgentPool).not.toHaveBeenCalled(); expect(fetchNbaSchedule).not.toHaveBeenCalled();
    const count = vi.mocked(fetchYahooXml).mock.calls.length;
    await finish(); expect(fetchYahooXml).toHaveBeenCalledTimes(count);
  });
  it("coalesces source batches for twenty simultaneous visitors", async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, () => getInjuryAdvice(options)));
    expect(responses.every((response) => response.opportunities.length === 1)).toBe(true);
    expect(fetchLeagues).toHaveBeenCalledTimes(1);
    expect(fetchLeagueTeams).toHaveBeenCalledTimes(1);
    expect(fetchRoster).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(fetchYahooXml).mock.calls.map(([path]) => path);
    expect(calls.filter((path) => path.includes(";out=metadata"))).toHaveLength(1);
    for (const period of ["lastweek", "lastmonth", "season"]) expect(calls.filter((path) => path.includes(`type=${period}`))).toHaveLength(1);
  });
  it("includes waiver candidates and low-minute owned injuries, excludes Q from the full injury table, and preserves unknown ownership rates", async () => {
    market = [metadata(1, "O", "team", "BOS", 99), metadata(2, "", "waivers", "BOS", 0), metadata(3, "Q", "team", "BOS", 100), metadata(4, "IL+", "team", "BOS", null)];
    const response = await finish();
    expect(response.opportunities[0].beneficiaryKey).toBe("nba.p.2");
    expect(response.players.find((p) => p.playerKey === "nba.p.2")).toMatchObject({ availability: "waivers", percentOwned: 0 });
    expect(response.injuredPlayers?.map((p) => p.playerKey)).toEqual(["nba.p.1", "nba.p.4"]);
    expect(response.injuredPlayers?.[1].percentOwned).toBeNull();
    expect(response.injuredPlayers?.[1].monthMinutes).toBe(19);
  });
  it("continues beyond 300 players, across cache resets/cold starts, without a free-agent cap", async () => {
    vi.stubEnv("FREE_AGENT_LIMIT", "25");
    market = [metadata(1, "O", "team"), ...Array.from({ length: 324 }, (_, i) => metadata(10 + i, "", "freeagents", "FA")), metadata(999, "", "waivers")];
    const first = await getInjuryAdvice(options);
    expect(first.scan).toMatchObject({ complete: false, phase: "metadata", playersScanned: 150 });
    expect(first.status).toBe("partial");
    resetCacheForTests();
    const response = await finish(first);
    expect(response.scan).toMatchObject({ complete: true, playersScanned: 326 });
    expect(response.opportunities.some((p) => p.beneficiaryKey === "nba.p.999")).toBe(true);
    expect(vi.mocked(fetchYahooXml).mock.calls.filter(([path]) => path.includes(";start=0;")).length).toBe(1);
  });
  it("retries the exact failed batch and then completes without a false empty/complete result", async () => {
    let failed = false;
    vi.mocked(fetchYahooXml).mockImplementation(async (path) => {
      if (!failed && path.includes("type=lastmonth")) { failed = true; throw new Error("offline"); }
      return source(path);
    });
    const first = await getInjuryAdvice(options);
    expect(first.scan).toMatchObject({ complete: false, blocked: true, phase: "stats" });
    expect(first.status).toBe("partial"); expect(first.opportunities).toEqual([]);
    const response = await finish(await getInjuryAdvice({ ...options, cursor: first.scan?.cursor }));
    expect(response.status).toBe("complete"); expect(response.opportunities).toHaveLength(1);
  });
  it("does not infer missing ownership or missing stats as availability or zero", async () => {
    market = [metadata(1, "O", "team"), metadata(2, "", "invalid")];
    const response = await finish();
    expect(response.status).toBe("partial"); expect(response.opportunities).toEqual([]); expect(response.diagnostics?.available).toBe(0);
  });
  it("requires dated GP evidence for watched, cleared players and continues seven daily batches", async () => {
    market = [metadata(1, "", "team"), metadata(2, "", "team")];
    vi.mocked(fetchYahooXml).mockImplementation(async (path) => {
      if (!path.includes("type=date")) return source(path);
      const date = /date=(\d{4}-\d{2}-\d{2})/.exec(path)?.[1];
      return `<fantasy_content><players><player><player_key>nba.p.1</player_key><player_stats><coverage_type>date</coverage_type><date>${date}</date><stats><stat><stat_id>0</stat_id><value>${date === "2026-10-23" ? 1 : 0}</value></stat></stats></player_stats></player></players></fantasy_content>`;
    });
    let response = await getInjuryAdvice({ ...options, watchKeys: ["nba.p.1"] });
    while (response.scan?.cursor) response = await getInjuryAdvice({ ...options, watchKeys: ["nba.p.1"], cursor: response.scan.cursor });
    expect(response.players.find((p) => p.playerKey === "nba.p.1")?.playedDates).toEqual(["2026-10-23"]);
  });
  it("does not mistake a missing Yahoo collection for a verified empty market", async () => {
    vi.mocked(fetchYahooXml).mockResolvedValue("<fantasy_content />");
    const response = await getInjuryAdvice(options);
    expect(response.status).toBe("partial");
    expect(response.scan).toMatchObject({ complete: false, blocked: true, playersScanned: 0 });
  });
  it("stops repeated Yahoo pages rather than silently truncating or looping", async () => {
    market = Array.from({ length: 25 }, (_, i) => metadata(i + 1));
    vi.mocked(fetchYahooXml).mockResolvedValue(xml(market));
    const response = await getInjuryAdvice(options);
    expect(response.scan).toMatchObject({ complete: false, blocked: true, playersScanned: 25 });
    expect(response.warnings.some((w) => w.includes("分頁重複"))).toBe(true);
  });
  it("validates league/team membership and never scans historical snapshots", async () => {
    await expect(getInjuryAdvice({ ...options, teamKey: "nba.l.2.t.1" })).rejects.toThrow("not in this league");
    expect((await getInjuryAdvice({ ...options, date: "2026-10-20" })).status).toBe("historical");
    expect(fetchYahooXml).not.toHaveBeenCalled();
  });
  it("rejects tampered, cross-team and expired continuation state", async () => {
    market = Array.from({ length: 160 }, (_, i) => metadata(i + 1));
    const first = await getInjuryAdvice(options);
    const cursor = first.scan!.cursor!;
    await expect(getInjuryAdvice({ ...options, cursor: `${cursor}x` })).rejects.toThrow("續載");
    await expect(getInjuryAdvice({ ...options, teamKey: "nba.l.1.t.2", cursor })).rejects.toThrow("續載");
    vi.advanceTimersByTime(11 * 60_000);
    await expect(getInjuryAdvice({ ...options, cursor })).rejects.toThrow("續載");
  });
});
