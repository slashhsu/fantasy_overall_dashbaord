import { expect, it } from "vitest";
import { findInjuryOpportunities } from "@/lib/injury-model";
import type { InjuryPlayer } from "@/lib/injury-types";
const star: InjuryPlayer = { playerKey: "nba.p.1", name: "Star", team: "BOS", position: "PG", status: "O", statusKnown: true, weekGames: 0, weekMinutes: null, monthGames: 10, seasonGames: 20, monthMinutes: 32, seasonMinutes: 32, playedDates: [] };
it("evaluates every available beneficiary without a score or category map", () => {
  const players = Array.from({ length: 325 }, (_, i) => ({ ...star, playerKey: `nba.p.${i + 2}`, status: "", weekGames: 3, weekMinutes: 30, monthMinutes: 19, percentOwned: i / 4 }));
  const result = findInjuryOpportunities([star, ...players], new Set(players.map((p) => p.playerKey)));
  expect(result.opportunities).toHaveLength(325);
  expect(result.opportunities[0].beneficiaryKey).toBe(players[324].playerKey);
  expect(result.opportunities[0]).not.toHaveProperty("score");
});
