import { describe, expect, it, vi } from "vitest";
import {
  fetchNbaSchedule,
  gamesFromBalldontlie,
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
      data: [{ date: "2025-12-25", datetime: "2025-12-25T23:00:00Z", status: "7:00 pm ET", home_team: { abbreviation: "NY" }, visitor_team: { abbreviation: "CLE" } }],
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
        events: [{ date: "2025-12-25T23:00:00Z", status: { type: { state: "pre" } }, competitions: [{ competitors: [{ team: { abbreviation: "GS" } }, { team: { abbreviation: "DAL" } }] }] }],
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
        message: "Schedule response lacks confirmed game status, tipoff time or a verified off-day calendar.",
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


it("recognizes documented BALLDONTLIE tipoff text, quarters and canonical lifecycle states", () => {
  const games = gamesFromBalldontlie({ data: [
    { id: 1, date: "2030-01-01", datetime: "2030-01-01T23:00:00Z", status: "7:00 pm ET", home_team: { abbreviation: "BOS" }, visitor_team: { abbreviation: "MIA" } },
    { id: 2, date: "2030-01-01", status: "1st Qtr", home_team: { abbreviation: "NYK" }, visitor_team: { abbreviation: "LAL" } },
    { id: 3, date: "2030-01-01", status: "7:00 pm ET", status_state: "unknown", home_team: { abbreviation: "DEN" }, visitor_team: { abbreviation: "PHX" } },
    { id: 4, date: "2030-01-01", status: "Final", status_state: "in_progress", home_team: { abbreviation: "ORL" }, visitor_team: { abbreviation: "CLE" } },
  ] }, "2030-01-01");
  expect(games.map((game) => game.status)).toEqual(["scheduled", "in-progress", "unknown", "in-progress"]);
});

it("uses ESPN when primary games have no reliable tipoff times", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ data: [{ date: "2030-01-01", status: "7:00 pm ET", home_team: { abbreviation: "BOS" }, visitor_team: { abbreviation: "MIA" } }] }))
    .mockResolvedValueOnce(jsonResponse({ events: [{ date: "2030-01-01T23:00:00Z", status: { type: { state: "pre" } }, competitions: [{ competitors: [{ team: { abbreviation: "BOS" } }, { team: { abbreviation: "MIA" } }] }] }] }));
  const result = await fetchNbaSchedule("2030-01-01", { apiKey: "test-key", fetcher });
  expect(result.schedule).toMatchObject({ status: "available", source: "espn" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("accepts a calendar-confirmed ESPN off-day but rejects malformed or contradictory empty schedules", async () => {
  const leagues = [{ id: "46", abbreviation: "NBA", calendarType: "day", calendarIsWhitelist: true, calendarStartDate: "2029-10-01T07:00Z", calendarEndDate: "2030-06-30T07:00Z", calendar: ["2030-01-01T07:00Z", "2030-01-03T07:00Z"] }];
  const valid = await fetchNbaSchedule("2030-01-02", { apiKey: "", fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ leagues, events: [] })) });
  expect(valid.schedule).toMatchObject({ status: "available", games: [], source: "espn" });
  const contradicted = await fetchNbaSchedule("2030-01-01", { apiKey: "", fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ leagues, events: [] })) });
  expect(contradicted.schedule.status).toBe("unverified");
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const malformed = await fetchNbaSchedule("2030-01-02", { apiKey: "", fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: "no data" })) });
  expect(malformed.schedule.status).toBe("unavailable"); warning.mockRestore();
});
