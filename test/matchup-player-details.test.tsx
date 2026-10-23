import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MatchupPlayerDetails } from "@/components/matchup-player-details";
const props = { leagueKey: "nba.l.1", week: 1, matchupId: "a::b", selectedTeamKey: "a", refreshVersion: 0 };
const response = { startDate: "2026-10-20", endDate: "2026-10-25", throughDate: "2026-10-23", status: "complete", categories: [{ statId: "12", displayName: "PTS" }], teams: [
  { teamKey: "a", name: "Team A", missingRosterDates: [], players: [{ playerKey: "p1", name: "Player One", team: "BOS", position: "PG", stats: { "0": 2, "12": 20 }, missingDates: [], incompleteStats: ["12"] }] },
  { teamKey: "b", name: "Team B", missingRosterDates: [], players: [] },
] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("weekly player details", () => {
  it("loads only when expanded, reuses data between team tabs and refreshes when requested", async () => {
    const fetcher = vi.fn(async (url: string) => { void url; return { ok: true, json: async () => response }; }); vi.stubGlobal("fetch", fetcher);
    const { rerender } = render(<MatchupPlayerDetails {...props} />);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "球員當週數據" }));
    expect(await screen.findByText("Player One")).toBeInTheDocument();
    expect(screen.getByText("≥20")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Team B" }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    rerender(<MatchupPlayerDetails {...props} refreshVersion={1} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls[1][0]).toContain("forceRefresh=true");
    fireEvent.click(screen.getByRole("button", { name: "球員當週數據" }));
    rerender(<MatchupPlayerDetails {...props} refreshVersion={2} />);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("clears old rows on matchup changes and ignores late results", async () => {
    let resolveOld!: (value: unknown) => void;
    const old = new Promise((resolve) => { resolveOld = resolve; });
    const fetcher = vi.fn().mockImplementationOnce(() => old).mockResolvedValue({ ok: true, json: async () => ({ ...response, teams: [{ ...response.teams[0], players: [{ ...response.teams[0].players[0], name: "New Player" }] }] }) });
    vi.stubGlobal("fetch", fetcher);
    const { rerender } = render(<MatchupPlayerDetails {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "球員當週數據" }));
    rerender(<MatchupPlayerDetails {...props} matchupId="c::d" />);
    expect(await screen.findByText("New Player")).toBeInTheDocument();
    resolveOld({ ok: true, json: async () => response });
    await waitFor(() => expect(screen.queryByText("Player One")).not.toBeInTheDocument());
  });
});
