import { describe, expect, it } from "vitest";
import { applyInjurySnapshot, emptyInjuryHistory, findInjuryOpportunities, importantBaseline, sanitizeInjuryHistory, allInjuredPlayers } from "@/lib/injury-model";
import type { InjuryPlayer, InjuryResponse } from "@/lib/injury-types";
const star: InjuryPlayer = { playerKey: "nba.p.1", name: "Star", team: "BOS", position: "PG", status: "O", statusKnown: true, weekGames: 0, weekMinutes: null, monthGames: 5, monthMinutes: 28, seasonGames: 20, seasonMinutes: 32, playedDates: [] };
const backup: InjuryPlayer = { ...star, playerKey: "nba.p.2", name: "Backup", status: "", weekGames: 3, weekMinutes: 24, monthMinutes: 19 };
const run = (s: Partial<InjuryPlayer> = {}, b: Partial<InjuryPlayer> = {}, options = {}) => findInjuryOpportunities([{ ...star, ...s }, { ...backup, ...b }], new Set([backup.playerKey]), options);
describe("strict injury replacement selection", () => {
  it("uses the recent sufficient baseline rather than the maximum, and falls back only for insufficient evidence", () => {
    expect(importantBaseline(star)).toMatchObject({ period: "lastmonth", games: 5, minutes: 28 });
    expect(run({ monthMinutes: 27.9 }).opportunities).toEqual([]);
    expect(run({ monthGames: 4 }).opportunities[0].relatedInjuries[0]).toMatchObject({ period: "season", minutes: 32 });
    expect(run({ monthMinutes: null }).opportunities[0].relatedInjuries[0].period).toBe("season");
    for (const s of [{ monthGames: 4, seasonGames: 4 }, { monthMinutes: null, seasonMinutes: null }, { monthGames: null, seasonGames: null }, { monthMinutes: NaN, seasonMinutes: Infinity }]) {
      expect(run(s).opportunities).toEqual([]); expect(run(s).watchlist).toEqual([]);
    }
  });
  it("accepts exact thresholds and rejects complete samples below either minute threshold", () => {
    expect(run().opportunities).toHaveLength(1);
    for (const b of [{ weekMinutes: 23.9 }, { monthMinutes: 19.1 }, { weekMinutes: 19 }]) {
      expect(run({}, b).opportunities).toEqual([]); expect(run({}, b).watchlist).toEqual([]);
      expect(run({ status: "Q" }, b).watchlist).toEqual([]);
      expect(run({}, b, { limitedData: true }).watchlist).toEqual([]);
    }
  });
  it.each(["O", "OUT", "INJ", "IL", "IL+"])("recognizes confirmed absence %s", (status) => {
    expect(run({ status }).opportunities).toHaveLength(1);
  });
  it.each(["Q", "GTD", "DTD", "D"])("keeps %s in observation rather than featured", (status) => {
    expect(run({ status }).opportunities).toEqual([]);
    expect(run({ status }).watchlist[0].reason).toBe("unconfirmed-absence");
  });
  it("observes positive small samples but excludes zero, absent or nonpositive evidence", () => {
    for (const b of [{ weekGames: 2 }, { monthGames: 4 }, { weekGames: 1, weekMinutes: 21 }]) {
      expect(run({}, b).opportunities).toEqual([]);
      expect(run({}, b).watchlist[0].reason).toBe("small-sample");
    }
    for (const b of [{ weekGames: 0 }, { weekGames: null }, { monthGames: 0 }, { monthGames: null }, { weekMinutes: null }, { monthMinutes: null }, { weekGames: 1, weekMinutes: 19 }]) expect(run({}, b).watchlist).toEqual([]);
  });
  it("requires current availability, known clear status, the same team and overlapping position", () => {
    for (const b of [{ status: "O" }, { status: "Q" }, { status: "SUSP" }, { statusKnown: false }, { team: "LAL" }, { position: "C" }]) expect(run({}, b).opportunities).toEqual([]);
    expect(run({ statusKnown: false }).opportunities).toEqual([]);
    expect(findInjuryOpportunities([star, backup], new Set()).opportunities).toEqual([]);
  });
  it("does not require recommendation membership, scores or category advantages", () => {
    expect(findInjuryOpportunities([star, backup], new Set([backup.playerKey])).opportunities).toHaveLength(1);
  });
  it("demotes otherwise qualified stale or partial results and never records watch candidates", () => {
    const result = run({}, {}, { limitedData: true });
    expect(result.opportunities).toEqual([]); expect(result.watchlist[0].reason).toBe("limited-data");
    const now = Date.now();
    const data: InjuryResponse = { leagueKey: "nba.l.1", teamKey: "nba.l.1.t.1", generatedAt: new Date(now).toISOString(), observationDate: "2026-10-24", players: [star, backup], rosterKeys: [], warnings: [], demoMode: false, status: "complete", ...result };
    expect(applyInjurySnapshot(emptyInjuryHistory(), data, now).history.observations).toEqual([]);
    const featured = { ...data, ...run() };
    for (const d of [{ ...featured, status: "partial" as const }, { ...featured, updateStatus: { fetchedAt: data.generatedAt, nextRefreshAt: data.generatedAt, stale: true } }, { ...featured, generatedAt: new Date(now - 600_001).toISOString() }]) expect(applyInjurySnapshot(emptyInjuryHistory(), d, now).history.observations).toEqual([]);
    expect(sanitizeInjuryHistory({ version: 1, observations: [{ id: "old" }], healthyBaselines: [] }).observations).toEqual([]);
  });
  it("sorts by ownership, gain and recent minutes; merges shared backups and tracks each related injury", () => {
    const secondStar = { ...star, playerKey: "nba.p.3" };
    const result = findInjuryOpportunities([secondStar, star, backup], new Set([backup.playerKey]));
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].relatedInjuries.map((s) => s.playerKey)).toEqual([star.playerKey, secondStar.playerKey]);
    const now = Date.now();
    expect(applyInjurySnapshot(emptyInjuryHistory(), { ...result, leagueKey: "l", teamKey: "t", generatedAt: new Date(now).toISOString(), observationDate: "2026-10-24", players: [star, secondStar, backup], rosterKeys: [], warnings: [], demoMode: false, status: "complete" }, now).history.observations).toHaveLength(2);
    const backups = ["nba.p.9", "nba.p.8", "nba.p.7"].map((playerKey, i) => ({ ...backup, playerKey, percentOwned: i === 0 ? 90 : 20, weekMinutes: i === 0 ? 25 : 26 }));
    const ordered = findInjuryOpportunities([star, ...backups], new Set(backups.map((p) => p.playerKey)));
    expect(ordered.opportunities.map((p) => p.beneficiaryKey)).toEqual(["nba.p.9", "nba.p.7", "nba.p.8"]);
  });
  it("keeps every qualified substitute with no per-star, section, or recommendation caps", () => {
    const backups = Array.from({ length: 325 }, (_, i) => ({ ...backup, playerKey: `nba.p.${100 + i}` }));
    const result = findInjuryOpportunities([star, ...backups], new Set(backups.map((p) => p.playerKey)));
    expect(result.opportunities).toHaveLength(325);
    expect(result.opportunities.some((p) => p.beneficiaryKey === backups[324].playerKey)).toBe(true);
  });
});

it("distinguishes missing minutes, insufficient games and genuinely low baseline minutes", () => {
  const variants = [
    { ...star, monthMinutes: null, seasonMinutes: null },
    { ...star, monthGames: 4, seasonGames: 4 },
    { ...star, monthMinutes: 27 },
  ];
  const expected = ["傷員上場時間資料缺失", "傷員基準場數不足（至少 5 場）", "傷員基準時間未達 28 分鐘"];
  variants.forEach((player, index) => expect(findInjuryOpportunities([player], new Set()).exclusionCounts[expected[index]]).toBe(1));
});


it("sorts known ownership above unknown, preserves zero, and sorts the full injury list without minute thresholds", () => {
  const players = [
    { ...star, playerKey: "1", name: "Unknown", percentOwned: null, monthMinutes: 5 },
    { ...star, playerKey: "2", name: "Zero", percentOwned: 0 },
    { ...star, playerKey: "3", name: "High", percentOwned: 99 },
    { ...star, playerKey: "4", name: "Questionable", status: "Q", percentOwned: 100 },
    { ...star, playerKey: "5", name: "Active", status: "", percentOwned: 100 },
  ];
  expect(allInjuredPlayers(players).map((p) => p.name)).toEqual(["High", "Zero", "Unknown"]);
  const qualified = [ { ...backup, playerKey: "a", name: "A", percentOwned: null, weekMinutes: 35 }, { ...backup, playerKey: "b", name: "B", percentOwned: 0 } ];
  expect(findInjuryOpportunities([star, ...qualified], new Set(["a", "b"])).opportunities.map((p) => p.beneficiaryKey)).toEqual(["b", "a"]);
});
