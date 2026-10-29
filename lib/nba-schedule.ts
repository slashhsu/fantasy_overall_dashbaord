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
  status_state?: string;
  period?: number;
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
  leagues?: Array<{ id?: string; abbreviation?: string; calendarType?: string; calendarIsWhitelist?: boolean; calendarStartDate?: string; calendarEndDate?: string; calendar?: string[] }>;
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
  if (normalized.includes("PROGRESS") || normalized === "IN" || /\b[1-4](?:ST|ND|RD|TH) QTR\b|HALFTIME|OVERTIME/.test(normalized)) return "in-progress";
  if (normalized.includes("SCHEDULE") || normalized === "PRE" || /^\d{1,2}:\d{2}\s*[AP]M(?:\s*(?:ET|EST|EDT))?$/.test(normalized.trim())) return "scheduled";
  return "unknown";
};

export const gamesFromBalldontlie = (data: BalldontlieResponse, targetDate: string): ScheduleGame[] =>
  (data.data ?? []).flatMap((game, index) => {
    const date = String(game.date ?? game.datetime ?? "").slice(0, 10);
    if (game.postponed || (date && date !== targetDate)) return [];
    const status = gameStatus(game.status_state ?? game.status ?? "unknown");
    if (status === "postponed") return [];
    const homeTeam = normalizeTeamAbbreviation(game.home_team?.abbreviation ?? "");
    const awayTeam = normalizeTeamAbbreviation(game.visitor_team?.abbreviation ?? "");
    if (!homeTeam || !awayTeam) return [];
    return [{
      id: String(game.id ?? `bdl-${targetDate}-${index}`),
      date: targetDate,
      startTime: game.datetime ?? null,
      status,
      homeTeam,
      awayTeam,
    }];
  });

export const gamesFromEspn = (data: EspnResponse, targetDate = ""): ScheduleGame[] =>
  (data.events ?? []).flatMap((event, index) => {
    const statusName = event.status?.type?.name ?? "";
    const status = gameStatus(/POSTPONED|CANCELED/.test(statusName.toUpperCase()) ? statusName : event.status?.type?.state ?? statusName, event.status?.type?.completed);
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
  if (!Array.isArray(data.data)) throw new Error("BALLDONTLIE returned an invalid game list.");
  const games = gamesFromBalldontlie(data, targetDate);
  const confirmedEmpty = data.data.length === 0 || data.data.every((game) => game.postponed || gameStatus(game.status_state ?? game.status ?? "unknown") === "postponed");
  return { teams: teamsPlayingFromBalldontlie(data, targetDate), games, confirmedEmpty };
};

const fetchEspn = async (targetDate: string, fetcher: ScheduleFetcher) => {
  const params = new URLSearchParams({ dates: targetDate.replaceAll("-", ""), limit: "100" });
  const data = await fetchJson<EspnResponse>(
    fetcher,
    `${ESPN_SCOREBOARD_URL}?${params}`,
    "ESPN",
  );
  if (!Array.isArray(data.events)) throw new Error("ESPN returned an invalid event list.");
  const league = data.leagues?.find((item) => item.id === "46" || item.abbreviation === "NBA");
  const calendarConfirmsOffDay = league?.calendarType === "day" && league.calendarIsWhitelist === true
    && Array.isArray(league.calendar) && league.calendar.length > 0
    && targetDate >= String(league.calendarStartDate ?? "").slice(0, 10)
    && targetDate <= String(league.calendarEndDate ?? "").slice(0, 10)
    && !league.calendar.some((day) => day.slice(0, 10) === targetDate);
  const games = gamesFromEspn(data, targetDate);
  const canceled = data.events.filter((event) => /POSTPONED|CANCELED/.test(event.status?.type?.name ?? "")).length;
  return { teams: teamsPlayingFromEspn(data), games,
    complete: data.events.length === games.length + canceled,
    confirmedEmpty: data.events.length === 0 ? Boolean(calendarConfirmsOffDay) : canceled === data.events.length };

};

export const fetchNbaSchedule = async (
  targetDate: string,
  options: FetchScheduleOptions = {},
): Promise<NbaScheduleResult> => {
  const fetcher = options.fetcher ?? fetch;
  const apiKey = options.apiKey ?? process.env.BALLDONTLIE_API_KEY?.trim();
  const errors: string[] = [];

  let primaryEmpty = false;
  let primaryBackup: { teams: string[]; games: ScheduleGame[] } | undefined;
  const completeGames = (games: ScheduleGame[]) => games.every((game) => game.status !== "unknown" && game.startTime && Number.isFinite(Date.parse(game.startTime)));
  if (apiKey) {
    try {
      const primary = await fetchBalldontlie(targetDate, apiKey, fetcher);
      if (primary.teams.length && completeGames(primary.games)) {
        return {
          teamsPlaying: primary.teams,
          schedule: { status: "available", source: "balldontlie", fallbackUsed: false, games: primary.games },
        };
      }
      if (primary.teams.length) primaryBackup = primary;
      else primaryEmpty = primary.confirmedEmpty;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "BALLDONTLIE schedule request failed.");
    }
  }

  try {
    const fallback = await fetchEspn(targetDate, fetcher);
    if ((primaryBackup && !fallback.teams.length) || (!fallback.teams.length && !primaryEmpty && !fallback.confirmedEmpty) || !fallback.complete || !completeGames(fallback.games)) {
      return {
        teamsPlaying: [],
        schedule: {
          status: "unverified",
          source: "espn",
          fallbackUsed: true,
          games: fallback.games,
          message: "Schedule response lacks confirmed game status, tipoff time or a verified off-day calendar.",
        },
      };
    }
    return {
      teamsPlaying: fallback.teams,
      schedule: {
        status: "available",
        source: fallback.teams.length || fallback.confirmedEmpty ? "espn" : "balldontlie",
        fallbackUsed: true,
        games: fallback.games,
        ...(primaryEmpty && fallback.teams.length ? { message: "Primary schedule was empty; ESPN supplied the confirmed slate." } : {}),
      },
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "ESPN schedule request failed.");
  }

  if (primaryBackup) return { teamsPlaying: primaryBackup.teams, schedule: { status: "unverified", source: "balldontlie", fallbackUsed: true, games: primaryBackup.games, message: "Primary schedule is incomplete and the backup provider is unavailable." } };
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
