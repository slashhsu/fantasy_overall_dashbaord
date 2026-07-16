import "server-only";

import { normalizeTeamAbbreviation } from "@/lib/stats";
import type { NbaScheduleResult } from "@/lib/types";

const BALLDONTLIE_GAMES_URL = "https://api.balldontlie.io/v1/games";
const ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const REQUEST_TIMEOUT_MS = 8_000;

interface BalldontlieTeam {
  abbreviation?: string;
}

interface BalldontlieGame {
  date?: string;
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
  status?: {
    type?: {
      name?: string;
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

export const teamsPlayingFromBalldontlie = (
  data: BalldontlieResponse,
  targetDate: string,
) => {
  const teams = new Set<string>();
  for (const game of data.data ?? []) {
    if (game.postponed || (game.date && game.date !== targetDate)) continue;
    addTeam(teams, game.home_team?.abbreviation);
    addTeam(teams, game.visitor_team?.abbreviation);
  }
  return [...teams].sort();
};

export const teamsPlayingFromEspn = (data: EspnResponse) => {
  const teams = new Set<string>();
  for (const event of data.events ?? []) {
    const status = event.status?.type?.name?.toUpperCase() ?? "";
    if (status.includes("POSTPONED") || status.includes("CANCELED")) continue;
    for (const competition of event.competitions ?? []) {
      for (const competitor of competition.competitors ?? []) {
        addTeam(teams, competitor.team?.abbreviation);
      }
    }
  }
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
  return teamsPlayingFromBalldontlie(data, targetDate);
};

const fetchEspn = async (targetDate: string, fetcher: ScheduleFetcher) => {
  const params = new URLSearchParams({ dates: targetDate.replaceAll("-", ""), limit: "100" });
  const data = await fetchJson<EspnResponse>(
    fetcher,
    `${ESPN_SCOREBOARD_URL}?${params}`,
    "ESPN",
  );
  return teamsPlayingFromEspn(data);
};

export const fetchNbaSchedule = async (
  targetDate: string,
  options: FetchScheduleOptions = {},
): Promise<NbaScheduleResult> => {
  const fetcher = options.fetcher ?? fetch;
  const apiKey = options.apiKey ?? process.env.BALLDONTLIE_API_KEY?.trim();
  const errors: string[] = [];

  if (apiKey) {
    try {
      return {
        teamsPlaying: await fetchBalldontlie(targetDate, apiKey, fetcher),
        schedule: { status: "available", source: "balldontlie", fallbackUsed: false },
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "BALLDONTLIE schedule request failed.");
    }
  }

  try {
    return {
      teamsPlaying: await fetchEspn(targetDate, fetcher),
      schedule: { status: "available", source: "espn", fallbackUsed: true },
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
      message: "Daily NBA schedule is temporarily unavailable; recommendations include all free agents.",
    },
  };
};
