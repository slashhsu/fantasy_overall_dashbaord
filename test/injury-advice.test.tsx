import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  data.watchlist = [{ id: "watch", injuredKey: "nba.p.1", beneficiaryKey: "nba.p.2", benefiting: false, minutesDelta: 5, group: "watch", reason: "unconfirmed-absence", relatedInjuries: [{ playerKey: "nba.p.1", period: "lastmonth", games: 10, minutes: 32 }] }];
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
  expect(screen.queryByRole("button", { name: "傷病推薦分數 說明" })).not.toBeInTheDocument();
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


it("explains the inspected pool when no injury candidate passes the thresholds", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...snapshot(), diagnostics: { players: 400, injured: 25, available: 200 }, exclusionCounts: { "替補時間或增幅未達門檻": 3 } }) })));
  render(<InjuryAdvice {...props} />);
  expect(await screen.findByText(/已檢查 400 名球員/)).toHaveTextContent("25 名有傷病標記、200 名可取得");
  expect(screen.getByText(/已檢查 400 名球員/)).toHaveTextContent("不受串流名單、推薦分數、當天賽程或開賽鎖定影響");
  expect(screen.getByText(/替補時間或增幅未達門檻（3）/)).toBeInTheDocument();
});


it("paginates all qualifying substitutes and all injuries in groups of 20 without showing scores", async () => {
  const data = snapshot();
  data.players = Array.from({ length: 21 }, (_, i) => ({ ...data.players[1], playerKey: `nba.p.${i + 100}`, name: `Backup ${i}`, status: "", percentOwned: 90 - i, availability: "waivers" as const }));
  data.players.unshift({ ...snapshot().players[0], status: "O" });
  data.opportunities = data.players.slice(1).map((p) => ({ id: `star:${p.playerKey}`, injuredKey: data.players[0].playerKey, beneficiaryKey: p.playerKey, benefiting: true, minutesDelta: 10, group: "featured", reason: "rotation-gain", relatedInjuries: [{ playerKey: data.players[0].playerKey, period: "lastmonth", games: 10, minutes: 32 }] }));
  data.injuredPlayers = Array.from({ length: 21 }, (_, i) => ({ ...data.players[0], playerKey: `nba.p.${500 + i}`, name: `Injured ${i}`, percentOwned: i === 20 ? null : 99 - i, availability: "owned" }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => data })));
  render(<InjuryAdvice {...props} />);
  expect(await screen.findByText("Backup 0", { selector: "strong" })).toBeInTheDocument();
  expect(screen.queryByText("Backup 20", { selector: "strong" })).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("navigation", { name: "精選補人分頁" })).getByRole("button", { name: "下一頁" }));
  expect(screen.getByText("Backup 20", { selector: "strong" })).toBeInTheDocument();
  expect(screen.queryByText("Backup 0", { selector: "strong" })).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("navigation", { name: "全體傷病名單分頁" })).getByRole("button", { name: "下一頁" }));
  expect(screen.getByText("Injured 20")).toBeInTheDocument();
  expect(screen.getByText(/傷病標記：O · 擁有率：未知/)).toBeInTheDocument();
  expect(screen.getByText(/擁有率：70.0% · Waiver/)).toBeInTheDocument();
  expect(screen.queryByText(/目前推薦分數/)).not.toBeInTheDocument();
});
it("automatically continues a scan using POST and never records a partial snapshot", async () => {
  const data = snapshot();
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === "POST"
    ? { ...data, scan: { phase: "complete", complete: true, playersScanned: 400, statsProcessed: 20, statsTotal: 20 } }
    : { ...data, status: "partial", scan: { phase: "metadata", complete: false, playersScanned: 150, statsProcessed: 0, statsTotal: 0, cursor: "signed-scan-state" } } }));
  vi.stubGlobal("fetch", fetcher);
  render(<InjuryAdvice {...props} />);
  await screen.findByText(/目前沒有可確認的復出釋出提醒/);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify({ cursor: "signed-scan-state" }) });
  expect(screen.queryByText(/掃描尚未完成/)).not.toBeInTheDocument();
});
it("stops at a failed batch, shows incomplete coverage, and retries its continuation explicitly", async () => {
  const data = snapshot();
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === "POST" ? data
    : { ...data, status: "partial", scan: { phase: "stats", complete: false, blocked: true, playersScanned: 400, statsProcessed: 0, statsTotal: 20, cursor: "retry-state" } } }));
  vi.stubGlobal("fetch", fetcher);
  render(<InjuryAdvice {...props} />);
  const retry = await screen.findByRole("button", { name: "繼續載入傷病資料" });
  await waitFor(() => expect(retry).toBeEnabled());
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(retry);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify({ cursor: "retry-state" }) });
});
