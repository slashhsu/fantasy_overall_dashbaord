import { describe, expect, it } from "vitest";
import { applyInjurySnapshot, emptyInjuryHistory, findInjuryOpportunities, injuryPlayer, injuryState, sanitizeInjuryHistory } from "@/lib/injury-model";
import type { InjuryHistory, InjuryPlayer, InjuryResponse } from "@/lib/injury-types";
const now = Date.parse("2026-10-24T18:00:00Z");
const star: InjuryPlayer = { playerKey: "nba.p.1", name: "Star", team: "BOS", position: "PG,SG", status: "O", statusKnown: true, weekGames: 0, weekMinutes: null, monthMinutes: 32, seasonMinutes: 32, playedDates: [] };
const backup: InjuryPlayer = { ...star, playerKey: "nba.p.2", name: "Backup", status: "", weekGames: 3, weekMinutes: 29, monthMinutes: 19, seasonMinutes: 20 };
const opportunity = { id: "nba.p.1:nba.p.2", injuredKey: star.playerKey, beneficiaryKey: backup.playerKey, score: 10, helps: ["AST"], benefiting: true, minutesDelta: 10 };
const snapshot = (overrides: Partial<InjuryResponse> = {}): InjuryResponse => ({ leagueKey: "nba.l.1", teamKey: "nba.l.1.t.1", generatedAt: new Date(now).toISOString(), observationDate: "2026-10-24", status: "complete", players: [star, backup], rosterKeys: [], opportunities: [opportunity], warnings: [], demoMode: false, ...overrides });
const history: InjuryHistory = { version: 1, observations: [{ id: opportunity.id, injuredKey: star.playerKey, beneficiaryKey: backup.playerKey, nbaTeam: "BOS", episodeAt: "2026-10-20T18:00:00Z", lastInjuredAt: "2026-10-20T18:00:00Z", lastSeenAt: "2026-10-20T18:00:00Z", beneficiaryMinutes: 29 }], healthyBaselines: [] };
describe("injury rotation evidence", () => {
  it("separates out, question marks and unknown statuses", () => {
    expect(["O", "INJ", "IL", "IL+"].map(injuryState)).toEqual(["out", "out", "out", "out"]);
    expect(injuryState("Q")).toBe("watch"); expect(injuryState("GTD")).toBe("watch"); expect(injuryState("SUSP")).toBe("unknown");
  });
  it("requires meaningful GP and total minutes for per-game averages", () => {
    expect(injuryPlayer({ playerKey: "p", name: "P", team: "BOS", position: "PG", period: "season", stats: {}, statWindows: { lastweek: { "Games Played (GP)": 0, "Minutes Played": 90 } } }).weekMinutes).toBeNull();
  });
  it("finds available same-team, overlapping-position beneficiaries and preserves score ordering", () => {
    const second = { ...backup, playerKey: "nba.p.3", weekGames: 2 };
    const otherTeam = { ...backup, playerKey: "nba.p.4", team: "LAL" };
    const center = { ...backup, playerKey: "nba.p.5", position: "C" };
    const owned = { ...backup, playerKey: "nba.p.6" };
    const available = new Set([backup.playerKey, second.playerKey, otherTeam.playerKey, center.playerKey]);
    const result = findInjuryOpportunities([star, backup, second, otherTeam, center, owned], available, new Map([[backup.playerKey, { score: 5, helps: ["AST"] }], [second.playerKey, { score: 10, helps: [] }]]));
    expect(result.map((item) => item.beneficiaryKey)).toEqual([second.playerKey, backup.playerKey]);
    expect(result.map((item) => item.benefiting)).toEqual([false, true]);
    expect(findInjuryOpportunities([{ ...star, status: "Q" }, backup], available, new Map())[0].benefiting).toBe(false);
    expect(findInjuryOpportunities([{ ...star, seasonMinutes: 20, monthMinutes: 20 }, backup], available, new Map())).toEqual([]);
    expect(findInjuryOpportunities([{ ...star, seasonMinutes: null, monthMinutes: null }, backup], available, new Map())).toHaveLength(1);
  });
  it("records an injury, but never fabricates a return for a new visitor", () => {
    expect(applyInjurySnapshot(emptyInjuryHistory(), snapshot(), now).history.observations).toHaveLength(1);
    const clear = snapshot({ players: [{ ...star, status: "" }, backup], opportunities: [], rosterKeys: [backup.playerKey] });
    expect(applyInjurySnapshot(emptyInjuryHistory(), clear, now).alerts).toEqual([]);
  });
  it("distinguishes cleared flags from dated post-injury appearances and minute declines", () => {
    const clear = snapshot({ players: [{ ...star, status: "" }, { ...backup, weekMinutes: 23 }], opportunities: [], rosterKeys: [backup.playerKey] });
    const pending = applyInjurySnapshot(history, clear, now).alerts[0];
    expect(pending.confirmed).toBe(false); expect(pending.roleDeclined).toBe(true);
    clear.players[0].playedDates = ["2026-10-19", "2026-10-23", "2026-10-25"];
    expect(applyInjurySnapshot(history, clear, now).alerts[0].confirmed).toBe(true);
    clear.players[0].playedDates = ["2026-10-19", "2026-10-25"];
    expect(applyInjurySnapshot(history, clear, now).alerts[0].confirmed).toBe(false);
  });
  it("suppresses returns for missing players, unknown status, moved teams, off-roster backups and stale/partial data", () => {
    const clear = snapshot({ players: [{ ...star, status: "" }, backup], opportunities: [], rosterKeys: [backup.playerKey] });
    for (const data of [
      { ...clear, players: [backup] }, { ...clear, players: [{ ...star, status: "", statusKnown: false }, backup] },
      { ...clear, players: [{ ...star, status: "", team: "LAL" }, backup] }, { ...clear, rosterKeys: [] },
      { ...clear, status: "partial" as const }, { ...clear, generatedAt: "2026-10-20T18:00:00Z" },
      { ...clear, updateStatus: { stale: true, fetchedAt: new Date(now).toISOString(), nextRefreshAt: new Date(now).toISOString() } },
    ]) expect(applyInjurySnapshot(history, data, now).alerts).toEqual([]);
  });
  it("keeps a dismissal for one episode and resets it after a new injury", () => {
    const dismissed = structuredClone(history); dismissed.observations[0].dismissed = true;
    const clear = snapshot({ players: [{ ...star, status: "" }, backup], opportunities: [], rosterKeys: [backup.playerKey] });
    const closed = applyInjurySnapshot(dismissed, clear, now);
    expect(closed.alerts).toEqual([]);
    const reopened = applyInjurySnapshot(closed.history, snapshot({ rosterKeys: [backup.playerKey], opportunities: [] }), now + 1000);
    expect(reopened.history.observations[0].dismissed).toBe(false);
    expect(reopened.history.observations[0].closedAt).toBeUndefined();
  });
  it("expires history after 30 days and caps pairs and healthy observations at 50", () => {
    expect(sanitizeInjuryHistory(history, now + 40 * 86_400_000).observations).toEqual([]);
    const many = { ...history, observations: Array.from({ length: 70 }, (_, index) => ({ ...history.observations[0], id: String(index) })) };
    expect(sanitizeInjuryHistory(many, now).observations).toHaveLength(50);
  });
});
