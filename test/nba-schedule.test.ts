import { describe, expect, it, vi } from "vitest";
import {
  fetchNbaSchedule,
  teamsPlayingFromBalldontlie,
  teamsPlayingFromEspn,
} from "@/lib/nba-schedule";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

describe("NBA schedule", () => {
  it("parses BALLDONTLIE games, normalizes teams, and skips other dates or postponements", () => {
    const teams = teamsPlayingFromBalldontlie({
      data: [
        { date: "2025-12-25", home_team: { abbreviation: "GS" }, visitor_team: { abbreviation: "NY" } },
        { date: "2025-12-25", postponed: true, home_team: { abbreviation: "BOS" }, visitor_team: { abbreviation: "MIA" } },
        { date: "2025-12-26", home_team: { abbreviation: "LAL" }, visitor_team: { abbreviation: "HOU" } },
      ],
    }, "2025-12-25");
    expect(teams).toEqual(["GSW", "NYK"]);
  });

  it("parses ESPN competitors and skips canceled games", () => {
    const teams = teamsPlayingFromEspn({
      events: [
        { competitions: [{ competitors: [{ team: { abbreviation: "SA" } }, { team: { abbreviation: "OKC" } }] }] },
        { status: { type: { name: "STATUS_CANCELED" } }, competitions: [{ competitors: [{ team: { abbreviation: "BOS" } }, { team: { abbreviation: "MIA" } }] }] },
      ],
    });
    expect(teams).toEqual(["OKC", "SAS"]);
  });

  it("uses the documented BALLDONTLIE provider when a key is configured", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      data: [{ date: "2025-12-25", home_team: { abbreviation: "NY" }, visitor_team: { abbreviation: "CLE" } }],
    }));

    const result = await fetchNbaSchedule("2025-12-25", { apiKey: "test-key", fetcher });

    expect(result).toEqual({
      teamsPlaying: ["CLE", "NYK"],
      schedule: {
        status: "available", source: "balldontlie", fallbackUsed: false,
        games: [expect.objectContaining({ homeTeam: "NYK", awayTeam: "CLE", status: "scheduled" })],
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("api.balldontlie.io/v1/games");
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("Authorization")).toBe("test-key");
  });

  it("falls back to ESPN when the primary provider fails", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse({
        events: [{ competitions: [{ competitors: [{ team: { abbreviation: "GS" } }, { team: { abbreviation: "DAL" } }] }] }],
      }));

    const result = await fetchNbaSchedule("2025-12-25", { apiKey: "test-key", fetcher });

    expect(result).toEqual({
      teamsPlaying: ["DAL", "GSW"],
      schedule: {
        status: "available", source: "espn", fallbackUsed: true,
        games: [expect.objectContaining({ homeTeam: "GSW", awayTeam: "DAL" })],
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1][0])).toContain("site.api.espn.com");
  });

  it("marks an empty slate unverified when only one provider confirms no games", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ events: [] }));
    const result = await fetchNbaSchedule("2025-07-15", { apiKey: "", fetcher });
    expect(result).toEqual({
      teamsPlaying: [],
      schedule: {
        status: "unverified", source: "espn", fallbackUsed: true, games: [],
        message: "One schedule provider returned an empty slate; player game availability is unverified.",
      },
    });
  });

  it("returns a nonfatal unavailable status when every provider fails", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 503));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await fetchNbaSchedule("2025-12-25", { apiKey: "test-key", fetcher });

    expect(result.schedule).toMatchObject({ status: "unavailable", source: null });
    expect(result.teamsPlaying).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    warning.mockRestore();
  });
});
