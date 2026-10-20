import { afterEach, describe, expect, it, vi } from "vitest";
import { getDashboard } from "@/lib/dashboard-service";
import { evaluateMatchup } from "@/lib/recommender";

const options = {
  leagueKey: "demo.l.101", week: 19,
  targetDate: "2026-10-20", timeZone: "America/New_York",
};

afterEach(() => vi.unstubAllEnvs());

describe("weekly report team selection", () => {
  it("defaults to the account owner's team", async () => {
    vi.stubEnv("YAHOO_DEMO_MODE", "true");
    const result = await getDashboard(options);
    expect(result.selectedTeamKey).toBe(result.league.userTeam.key);
  });

  it("calculates each side of every matchup from the chosen team's perspective", async () => {
    vi.stubEnv("YAHOO_DEMO_MODE", "true");
    const initial = await getDashboard(options);
    for (const matchup of initial.matchups) {
      for (const [team, opponent] of [[matchup.teamA, matchup.teamB], [matchup.teamB, matchup.teamA]]) {
        const result = await getDashboard({ ...options, teamKey: team.teamKey, matchupId: initial.selectedMatchupId });
        expect(result.selectedTeamKey).toBe(team.teamKey);
        expect(result.selectedTeamName).toBe(team.name);
        expect(result.opponentName).toBe(opponent.name);
        expect(result.selectedMatchupId).toBe(matchup.id);
        expect(result.categoryNeeds).toEqual(evaluateMatchup(team, opponent, result.categories));
      }
    }
  });

  it("rejects teams outside the selected league", async () => {
    vi.stubEnv("YAHOO_DEMO_MODE", "true");
    await expect(getDashboard({ ...options, teamKey: "other.l.1.t.1" })).rejects.toThrow("selected team has no matchup data");
  });
});
