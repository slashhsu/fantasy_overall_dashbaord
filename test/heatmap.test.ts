import { describe, expect, it } from "vitest";
import { buildHeatmapRanges, heatmapCellStyle, parseHeatmapValue } from "@/lib/heatmap";
import type { LeagueCategory, Matchup } from "@/lib/types";

describe("notebook heatmap", () => {
  it("parses Yahoo totals, percentages, and made-attempted ratios", () => {
    expect(parseHeatmapValue("1,024")).toBe(1024);
    expect(parseHeatmapValue("51.2%")).toBeCloseTo(0.512);
    expect(parseHeatmapValue("42/84")).toBe(0.5);
    expect(parseHeatmapValue("--")).toBeNull();
  });

  it("uses PiYG with green highs and reverses lower-is-better values", () => {
    const normal = { min: 10, max: 20, reverse: false };
    const reversed = { min: 10, max: 20, reverse: true };
    expect(heatmapCellStyle(10, normal)?.backgroundColor).toBe("rgb(142, 1, 82)");
    expect(heatmapCellStyle(20, normal)?.backgroundColor).toBe("rgb(39, 100, 25)");
    expect(heatmapCellStyle(10, reversed)?.backgroundColor).toBe("rgb(39, 100, 25)");
    expect(heatmapCellStyle(15, normal)?.backgroundColor).toBe("rgb(247, 247, 247)");
  });

  it("normalizes each category across both teams in every matchup", () => {
    const categories: LeagueCategory[] = [
      { statId: "12", name: "Points Scored", displayName: "PTS", position: 0, enabled: true },
      { statId: "19", name: "Turnovers", displayName: "TO", position: 1, enabled: true },
    ];
    const team = (teamKey: string, points: string, turnovers: string) => ({
      teamKey, name: teamKey, stats: { "12": points, "19": turnovers },
    });
    const matchups: Matchup[] = [{
      id: "one", week: 1, status: "midevent", isPlayoffs: false, isConsolation: false,
      teamA: team("a", "90", "8"), teamB: team("b", "120", "14"),
    }];
    const ranges = buildHeatmapRanges(matchups, categories);
    expect(ranges.get("12")).toEqual({ min: 90, max: 120, reverse: false });
    expect(ranges.get("19")).toEqual({ min: 8, max: 14, reverse: true });
  });
});
