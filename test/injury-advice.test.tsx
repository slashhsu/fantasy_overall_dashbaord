import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InjuryAdvice, injuryStorageKey } from "@/components/injury-advice";
import type { InjuryHistory, InjuryResponse } from "@/lib/injury-types";
const props = { leagueKey: "nba.l.1", teamKey: "nba.l.1.t.1", week: 1, date: "2026-10-24", timeZone: "America/Los_Angeles", refreshVersion: 0 };
const snapshot = (): InjuryResponse => ({ ...props, generatedAt: new Date().toISOString(), observationDate: new Date().toISOString().slice(0, 10), status: "complete", players: [
  { playerKey: "nba.p.1", name: "Star Guard", team: "BOS", position: "PG", status: "", statusKnown: true, weekGames: 3, weekMinutes: 32, monthGames: 10, seasonGames: 20, monthMinutes: 32, seasonMinutes: 32, playedDates: [new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)] },
  { playerKey: "nba.p.2", name: "Backup Guard", team: "BOS", position: "PG", status: "", statusKnown: true, weekGames: 3, weekMinutes: 20, monthGames: 10, seasonGames: 20, monthMinutes: 19, seasonMinutes: 19, playedDates: [] },
], rosterKeys: ["nba.p.2"], opportunities: [], watchlist: [], exclusionCounts: {}, warnings: [], demoMode: false });
const history = (): InjuryHistory => {
  const then = new Date(Date.now() - 3 * 86_400_000).toISOString();
  return { version: 2, observations: [{ id: "nba.p.1:nba.p.2", injuredKey: "nba.p.1", beneficiaryKey: "nba.p.2", nbaTeam: "BOS", episodeAt: then, lastInjuredAt: then, lastSeenAt: then, beneficiaryMinutes: 29 }], healthyBaselines: [] };
};
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
describe("injury advice on the recommendation page", () => {
  it("waits for visibility and keeps league/team histories separate", async () => {
    let intersection!: IntersectionObserverCallback;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { intersection = callback; }
      observe() {} disconnect() {}
    });
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => snapshot() })); vi.stubGlobal("fetch", fetcher);
    const otherHistory = JSON.stringify(history());
    localStorage.setItem(injuryStorageKey("other", "other-team"), otherHistory);
    render(<InjuryAdvice {...props} />);
    expect(fetcher).not.toHaveBeenCalled();
    act(() => intersection([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    await screen.findByText(/目前沒有可確認的復出釋出提醒/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(injuryStorageKey("other", "other-team"))).toBe(otherHistory);
  });
  it("uses saved injury observations, confirms dated returns and persists a dismissal", async () => {
    localStorage.setItem(injuryStorageKey(props.leagueKey, props.teamKey), JSON.stringify(history()));
    const fetcher = vi.fn(async (url: string) => { void url; return { ok: true, json: async () => snapshot() }; }); vi.stubGlobal("fetch", fetcher);
    render(<InjuryAdvice {...props} />);
    expect(await screen.findByText("已恢復出賽")).toBeInTheDocument();
    expect(fetcher.mock.calls[0][0]).toContain("watch=nba.p.1");
    expect(screen.getByText(/替補近期時間已下降/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "忽略此提醒" }));
    await waitFor(() => expect(screen.queryByText("已恢復出賽")).not.toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem(injuryStorageKey(props.leagueKey, props.teamKey))!).observations[0].dismissed).toBe(true);
  });
  it("does not show return cards from partial data or overwrite prior injury observations", async () => {
    const stored = history(); localStorage.setItem(injuryStorageKey(props.leagueKey, props.teamKey), JSON.stringify(stored));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...snapshot(), status: "partial" }) })));
    render(<InjuryAdvice {...props} />);
    await screen.findByText(/目前沒有可確認的復出釋出提醒/);
    expect(screen.queryByText("已恢復出賽")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(injuryStorageKey(props.leagueKey, props.teamKey))!).observations).toEqual(stored.observations);
  });
});

it("renders server groups, starts watching collapsed and removes old loose history", async () => {
  const oldKey = injuryStorageKey(props.leagueKey, props.teamKey).replace(":v2:", ":v1:");
  localStorage.setItem(oldKey, JSON.stringify({ ...history(), version: 1 }));
  const data = snapshot();
  data.players[0].status = "Q";
  data.watchlist = [{ id: "watch", injuredKey: "nba.p.1", beneficiaryKey: "nba.p.2", benefiting: false, score: 8, helps: ["AST"], minutesDelta: 5, group: "watch", reason: "unconfirmed-absence", relatedInjuries: [{ playerKey: "nba.p.1", period: "lastmonth", games: 10, minutes: 32 }] }];
  data.exclusionCounts = { "傷員重要性不足或基準資料不足": 2 };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => data })));
  const { container } = render(<InjuryAdvice {...props} />);
  await screen.findByText(/傷員重要性不足或基準資料不足（2）/);
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  fireEvent.click(screen.getByText("觀察名單（1）"));
  expect(details.open).toBe(true);
  expect(container.querySelectorAll(".injury-card .help-trigger")).toHaveLength(0);
  expect(container.querySelectorAll(".injury-toolbar .help-trigger")).toHaveLength(0);
  expect(screen.getAllByRole("button", { name: "傷病推薦分數 說明" })).toHaveLength(1);
  expect(screen.getByText(/傷病觀察，尚未確認缺陣/)).toBeInTheDocument();
  expect(screen.getByText(/非已確認傷前健康期/)).toBeInTheDocument();
  expect(localStorage.getItem(oldKey)).toBeNull();
  expect(JSON.parse(localStorage.getItem(injuryStorageKey(props.leagueKey, props.teamKey))!).observations).toEqual([]);
});
it("clears prior team cards and ignores their late response after switching teams", async () => {
  let finish!: (value: unknown) => void;
  const deferred = new Promise((resolve) => { finish = resolve; });
  vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("teamKey=nba.l.1.t.1") ? deferred : Promise.resolve({ ok: true, json: async () => ({ ...snapshot(), teamKey: "nba.l.1.t.2", exclusionCounts: { "新隊伍沒有合格替補": 1 } }) })));
  const { rerender } = render(<InjuryAdvice {...props} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  rerender(<InjuryAdvice {...props} teamKey="nba.l.1.t.2" />);
  await screen.findByText(/新隊伍沒有合格替補/);
  await act(async () => { finish({ ok: true, json: async () => ({ ...snapshot(), exclusionCounts: { "舊隊伍資料": 1 } }) }); });
  expect(screen.queryByText(/舊隊伍資料/)).not.toBeInTheDocument();
});
