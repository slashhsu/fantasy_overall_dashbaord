import "server-only";

import { normalizeTeamAbbreviation } from "@/lib/stats";
import type { NbaScheduleResult, ScheduleGame } from "@/lib/types";

const BALLDONTLIE_GAMES_URL = "https://api.balldontlie.io/v1/games";
const ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const REQUEST_TIMEOUT_MS = 8_000;

interface BalldontlieTeam {
  abbreviation?: string;
}

interface BalldontlieGame {
  id?: number;
  date?: string;
  datetime?: string;
  status?: string;
  postponed?: boolean;
  home_team?: BalldontlieTeam;
  visitor_team?: BalldontlieTeam;
}

interface BalldontlieResponse {
  data?: BalldontlieGame[];
}

interface EspnCompetitor {
  team?: {
    abbreviation?: string;
  };
}

interface EspnEvent {
  id?: string;
  date?: string;
  status?: {
    type?: {
      name?: string;
      state?: string;
      completed?: boolean;
    };
  };
  competitions?: Array<{
    competitors?: EspnCompetitor[];
  }>;
}

interface EspnResponse {
  events?: EspnEvent[];
}

type ScheduleFetcher = typeof fetch;

interface FetchScheduleOptions {
  apiKey?: string;
  fetcher?: ScheduleFetcher;
}

const addTeam = (teams: Set<string>, abbreviation: string | undefined) => {
  if (abbreviation?.trim()) teams.add(normalizeTeamAbbreviation(abbreviation));
};

const gameStatus = (value: string, completed = false): ScheduleGame["status"] => {
  const normalized = value.toUpperCase();
  if (normalized.includes("POSTPONED") || normalized.includes("CANCELED")) return "postponed";
  if (completed || normalized.includes("FINAL") || normalized === "POST") return "final";
  if (normalized.includes("PROGRESS") || normalized === "IN") return "in-progress";
  if (normalized.includes("SCHEDULE") || normalized === "PRE") return "scheduled";
  return "unknown";
};

export const gamesFromBalldontlie = (data: BalldontlieResponse, targetDate: string): ScheduleGame[] =>
  (data.data ?? []).flatMap((game, index) => {
    const date = String(game.date ?? game.datetime ?? "").slice(0, 10);
    if (game.postponed || (date && date !== targetDate)) return [];
    const homeTeam = normalizeTeamAbbreviation(game.home_team?.abbreviation ?? "");
    const awayTeam = normalizeTeamAbbreviation(game.visitor_team?.abbreviation ?? "");
    if (!homeTeam || !awayTeam) return [];
    return [{
      id: String(game.id ?? `bdl-${targetDate}-${index}`),
      date: targetDate,
      startTime: game.datetime ?? null,
      status: gameStatus(game.status ?? "scheduled"),
      homeTeam,
      awayTeam,
    }];
  });

export const gamesFromEspn = (data: EspnResponse, targetDate = ""): ScheduleGame[] =>
  (data.events ?? []).flatMap((event, index) => {
    const statusName = event.status?.type?.name ?? "";
    const status = gameStatus(event.status?.type?.state ?? statusName, event.status?.type?.completed);
    if (status === "postponed") return [];
    const competitors = event.competitions?.[0]?.competitors ?? [];
    const teams = competitors.map((competitor) => normalizeTeamAbbreviation(competitor.team?.abbreviation ?? "")).filter(Boolean);
    if (teams.length < 2) return [];
    return [{
      id: event.id ?? `espn-${targetDate}-${index}`,
      date: String(event.date ?? targetDate).slice(0, 10) || targetDate,
      startTime: event.date ?? null,
      status,
      homeTeam: teams[0],
      awayTeam: teams[1],
    }];
  });

export const teamsPlayingFromBalldontlie = (
  data: BalldontlieResponse,
  targetDate: string,
) => {
  const teams = new Set<string>();
  gamesFromBalldontlie(data, targetDate).forEach((game) => { addTeam(teams, game.homeTeam); addTeam(teams, game.awayTeam); });
  return [...teams].sort();
};

export const teamsPlayingFromEspn = (data: EspnResponse) => {
  const teams = new Set<string>();
  gamesFromEspn(data).forEach((game) => { addTeam(teams, game.homeTeam); addTeam(teams, game.awayTeam); });
  return [...teams].sort();
};

const fetchJson = async <T>(
  fetcher: ScheduleFetcher,
  url: string,
  provider: string,
  headers: HeadersInit = {},
) => {
  const response = await fetcher(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "FantasyBasketballDashboard/1.0",
      ...headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${provider} schedule request failed with status ${response.status}.`);
  }
  return response.json() as Promise<T>;
};

const fetchBalldontlie = async (
  targetDate: string,
  apiKey: string,
  fetcher: ScheduleFetcher,
) => {
  const params = new URLSearchParams({ "dates[]": targetDate, per_page: "100" });
  const data = await fetchJson<BalldontlieResponse>(
    fetcher,
    `${BALLDONTLIE_GAMES_URL}?${params}`,
    "BALLDONTLIE",
    { Authorization: apiKey },
  );
  return { teams: teamsPlayingFromBalldontlie(data, targetDate), games: gamesFromBalldontlie(data, targetDate) };
};

const fetchEspn = async (targetDate: string, fetcher: ScheduleFetcher) => {
  const params = new URLSearchParams({ dates: targetDate.replaceAll("-", ""), limit: "100" });
  const data = await fetchJson<EspnResponse>(
    fetcher,
    `${ESPN_SCOREBOARD_URL}?${params}`,
    "ESPN",
  );
  return { teams: teamsPlayingFromEspn(data), games: gamesFromEspn(data, targetDate) };
};

export const fetchNbaSchedule = async (
  targetDate: string,
  options: FetchScheduleOptions = {},
): Promise<NbaScheduleResult> => {
  const fetcher = options.fetcher ?? fetch;
  const apiKey = options.apiKey ?? process.env.BALLDONTLIE_API_KEY?.trim();
  const errors: string[] = [];

  let primaryEmpty = false;
  if (apiKey) {
    try {
      const primary = await fetchBalldontlie(targetDate, apiKey, fetcher);
      if (primary.teams.length) {
        return {
          teamsPlaying: primary.teams,
          schedule: { status: "available", source: "balldontlie", fallbackUsed: false, games: primary.games },
        };
      }
      primaryEmpty = true;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "BALLDONTLIE schedule request failed.");
    }
  }

  try {
    const fallback = await fetchEspn(targetDate, fetcher);
    if (!fallback.teams.length && !primaryEmpty) {
      return {
        teamsPlaying: [],
        schedule: {
          status: "unverified",
          source: "espn",
          fallbackUsed: true,
          games: [],
          message: "One schedule provider returned an empty slate; player game availability is unverified.",
        },
      };
    }
    return {
      teamsPlaying: fallback.teams,
      schedule: {
        status: "available",
        source: fallback.teams.length ? "espn" : "balldontlie",
        fallbackUsed: true,
        games: fallback.games,
        ...(primaryEmpty && fallback.teams.length ? { message: "Primary schedule was empty; ESPN supplied the confirmed slate." } : {}),
      },
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "ESPN schedule request failed.");
  }

  console.warn("NBA schedule unavailable:", errors.join(" "));
  return {
    teamsPlaying: [],
    schedule: {
      status: "unavailable",
      source: null,
      fallbackUsed: Boolean(apiKey),
      games: [],
      message: "Daily NBA schedule is temporarily unavailable; recommendations include all free agents.",
    },
  };
};
