import { describe, expect, it } from "vitest";
import { teamsPlayingOnDateFromSchedule } from "@/lib/nba-schedule";

describe("NBA schedule", () => {
  it("filters by ISO date and normalizes team tricodes", () => {
    const teams = teamsPlayingOnDateFromSchedule({
      leagueSchedule: {
        gameDates: [
          { gameDate: "02/14/2025 00:00:00", games: [{ homeTeam: { teamTricode: "GS" }, awayTeam: { teamTricode: "NY" } }] },
          { gameDate: "02/15/2025 00:00:00", games: [{ homeTeam: { teamTricode: "BOS" }, awayTeam: { teamTricode: "MIA" } }] },
        ],
      },
    }, "2025-02-14");
    expect(teams).toEqual(["GSW", "NYK"]);
  });
});
