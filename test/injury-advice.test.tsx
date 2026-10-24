import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InjuryAdvice, injuryStorageKey } from "@/components/injury-advice";
import type { InjuryHistory, InjuryResponse } from "@/lib/injury-types";
const props = { leagueKey: "nba.l.1", teamKey: "nba.l.1.t.1", week: 1, date: "2026-10-24", timeZone: "America/Los_Angeles", refreshVersion: 0 };
const snapshot = (): InjuryResponse => ({ ...props, generatedAt: new Date().toISOString(), observationDate: new Date().toISOString().slice(0, 10), status: "complete", players: [
  { playerKey: "nba.p.1", name: "Star Guard", team: "BOS", position: "PG", status: "", statusKnown: true, weekGames: 3, weekMinutes: 32, monthMinutes: 32, seasonMinutes: 32, playedDates: [new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)] },
  { playerKey: "nba.p.2", name: "Backup Guard", team: "BOS", position: "PG", status: "", statusKnown: true, weekGames: 3, weekMinutes: 20, monthMinutes: 19, seasonMinutes: 19, playedDates: [] },
], rosterKeys: ["nba.p.2"], opportunities: [], warnings: [], demoMode: false });
const history = (): InjuryHistory => {
  const then = new Date(Date.now() - 3 * 86_400_000).toISOString();
  return { version: 1, observations: [{ id: "nba.p.1:nba.p.2", injuredKey: "nba.p.1", beneficiaryKey: "nba.p.2", nbaTeam: "BOS", episodeAt: then, lastInjuredAt: then, lastSeenAt: then, beneficiaryMinutes: 29 }], healthyBaselines: [] };
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
