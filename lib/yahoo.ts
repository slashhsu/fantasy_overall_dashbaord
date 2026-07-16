import "server-only";

import { getRuntimeConfig } from "@/lib/config";
import { compactCategoryName, canonicalCategoryName, normalizeTeamAbbreviation, statNameForId } from "@/lib/stats";
import type {
  FreeAgent,
  LeagueCategory,
  LeagueConfiguration,
  LeagueScoringFormat,
  LeagueSummary,
  Matchup,
  MatchupTeam,
  PlayerStatPeriod,
  RosterPlayer,
  RosterPosition,
  RosterSnapshot,
} from "@/lib/types";
import { fetchYahooXml, YahooApiError } from "@/lib/yahoo-client";
import { asArray, directChildren, findAll, objectValue, parseXml, textValue, type XmlNode } from "@/lib/xml";

const numeric = (value: unknown, fallback = 0) => {
  const parsed = Number(textValue(value));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const leagueKeyFromTeam = (teamKey: string) => teamKey.split(".t.")[0] ?? "";

const scoringFormatFor = (value: string): LeagueScoringFormat => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "headone") return "most-categories";
  if (normalized.startsWith("head")) return "each-category";
  return "unknown";
};

const parseTeamSummary = (team: XmlNode) => ({
  key: textValue(team.team_key),
  name: textValue(team.name, "My Team"),
});

const currentLoginTeam = (teams: XmlNode[]) =>
  teams.find((team) =>
    findAll(team.managers ?? team, "manager").some(
      (manager) => textValue(manager.is_current_login) === "1",
    ),
  );

export const parseLeagueDiscovery = (gamesXml: string, teamsXml?: string): LeagueSummary[] => {
  const gameRoot = parseXml(gamesXml);
  const games = findAll(gameRoot, "game")
    .filter((game) => textValue(game.code).toLowerCase() === "nba")
    .sort((left, right) => numeric(right.season) - numeric(left.season) || numeric(right.game_key) - numeric(left.game_key));

  const latestGameWithLeagues = games.find((game) => directChildren(game, "leagues", "league").length > 0);
  if (!latestGameWithLeagues) return [];

  const gameKey = textValue(latestGameWithLeagues.game_key);
  const season = numeric(latestGameWithLeagues.season);
  const userTeams = teamsXml ? findAll(parseXml(teamsXml), "team") : [];

  return directChildren(latestGameWithLeagues, "leagues", "league").map((league) => {
    const leagueKey = textValue(league.league_key);
    const matchingTeam = userTeams.find(
      (team) => leagueKeyFromTeam(textValue(team.team_key)) === leagueKey,
    );
    const embeddedTeams = directChildren(league, "teams", "team");
    const userTeam = matchingTeam ?? currentLoginTeam(embeddedTeams);
    return {
      gameKey,
      leagueKey,
      name: textValue(league.name, leagueKey),
      season,
      currentWeek: numeric(league.current_week, 1),
      startWeek: numeric(league.start_week, 1),
      endWeek: numeric(league.end_week, 24),
      scoringFormat: scoringFormatFor(textValue(league.scoring_type)),
      userTeam: userTeam ? parseTeamSummary(userTeam) : { key: "", name: "My Team" },
    };
  });
};

const fetchCurrentTeamForLeague = async (leagueKey: string) => {
  const xml = await fetchYahooXml(`/league/${leagueKey}/teams`);
  const teams = findAll(parseXml(xml), "team");
  const team = currentLoginTeam(teams);
  return team ? parseTeamSummary(team) : { key: "", name: "My Team" };
};

export const fetchLeagues = async (): Promise<LeagueSummary[]> => {
  const gamesXml = await fetchYahooXml("/users;use_login=1/games;out=leagues");
  const provisional = parseLeagueDiscovery(gamesXml);
  if (!provisional.length) return [];
  const gameKey = provisional[0].gameKey;
  let teamsXml: string | undefined;
  try {
    teamsXml = await fetchYahooXml(`/users;use_login=1/games;game_keys=${gameKey}/teams`);
  } catch (error) {
    if (!(error instanceof YahooApiError)) throw error;
  }

  const leagues = parseLeagueDiscovery(gamesXml, teamsXml);
  return Promise.all(
    leagues.map(async (league) => {
      if (league.userTeam.key) return league;
      try {
        return { ...league, userTeam: await fetchCurrentTeamForLeague(league.leagueKey) };
      } catch {
        return league;
      }
    }),
  );
};

export const parseLeagueSettings = (xml: string): LeagueCategory[] => {
  const root = parseXml(xml);
  const settings = findAll(root, "settings")[0] ?? root;
  const statCategory = objectValue(settings.stat_categories);
  const stats = findAll(statCategory, "stat");
  return stats
    .map((stat, index) => {
      const statId = textValue(stat.stat_id);
      const sourceName = textValue(stat.display_name) || textValue(stat.name) || statNameForId(statId);
      const name = canonicalCategoryName(sourceName, statId);
      return {
        statId,
        name,
        displayName: compactCategoryName(name),
        position: numeric(stat.position, index),
        enabled: textValue(stat.is_only_display_stat) !== "1",
      };
    })
    .filter((stat) => stat.statId)
    .sort((left, right) => left.position - right.position);
};

const parseRosterPositions = (root: XmlNode): RosterPosition[] => {
  const settings = findAll(root, "settings")[0] ?? root;
  return findAll(objectValue(settings.roster_positions), "roster_position")
    .map((item) => ({
      position: textValue(item.position),
      count: Math.max(0, numeric(item.count, 1)),
    }))
    .filter((item) => item.position && item.count > 0);
};

export const parseLeagueConfiguration = (xml: string): LeagueConfiguration => {
  const root = parseXml(xml);
  const league = findAll(root, "league")[0] ?? root;
  return {
    categories: parseLeagueSettings(xml),
    rosterPositions: parseRosterPositions(root),
    scoringFormat: scoringFormatFor(textValue(league.scoring_type)),
  };
};

export const fetchLeagueSettings = async (leagueKey: string) =>
  parseLeagueSettings(await fetchYahooXml(`/league/${leagueKey}/settings`));

export const fetchLeagueConfiguration = async (leagueKey: string) =>
  parseLeagueConfiguration(await fetchYahooXml(`/league/${leagueKey}/settings`));

const parseTeam = (team: XmlNode): MatchupTeam => {
  const stats: Record<string, string> = {};
  const statsRoot = objectValue(team.team_stats);
  for (const stat of findAll(statsRoot, "stat")) {
    const statId = textValue(stat.stat_id);
    if (statId) stats[statId] = textValue(stat.value);
  }
  const teamLogo = findAll(team.team_logos, "team_logo")[0];
  return {
    teamKey: textValue(team.team_key),
    name: textValue(team.name, "Unknown Team"),
    logoUrl: teamLogo ? textValue(teamLogo.url) : undefined,
    points: textValue(objectValue(team.team_points).total) ? numeric(objectValue(team.team_points).total) : undefined,
    projectedPoints: textValue(objectValue(team.team_projected_points).total)
      ? numeric(objectValue(team.team_projected_points).total)
      : undefined,
    stats,
  };
};

export const parseScoreboard = (xml: string, fallbackWeek: number): Matchup[] => {
  const root = parseXml(xml);
  return findAll(root, "matchup")
    .map((matchup, index) => {
      const teams = directChildren(matchup, "teams", "team");
      if (teams.length < 2) return null;
      const teamA = parseTeam(teams[0]);
      const teamB = parseTeam(teams[1]);
      return {
        id: `${teamA.teamKey}::${teamB.teamKey}` || String(index),
        week: numeric(matchup.week, fallbackWeek),
        status: textValue(matchup.status, "unknown"),
        isPlayoffs: textValue(matchup.is_playoffs) === "1",
        isConsolation: textValue(matchup.is_consolation) === "1",
        teamA,
        teamB,
      } satisfies Matchup;
    })
    .filter((matchup): matchup is Matchup => matchup !== null);
};

export const fetchScoreboard = async (leagueKey: string, week: number) =>
  parseScoreboard(
    await fetchYahooXml(`/league/${leagueKey}/scoreboard;week=${week}`),
    week,
  );

const parsePlayer = (player: XmlNode, period: FreeAgent["period"]): FreeAgent => {
  const stats: Record<string, number> = {};
  const playerStats = objectValue(player.player_stats);
  for (const stat of findAll(playerStats, "stat")) {
    const statId = textValue(stat.stat_id);
    const value = Number(textValue(stat.value).replaceAll(",", ""));
    if (statId && Number.isFinite(value)) stats[statNameForId(statId)] = value;
  }
  const nameNode = objectValue(player.name);
  const headshot = objectValue(player.headshot);
  const eligiblePositions = asArray(objectValue(player.eligible_positions).position)
    .map((position) => textValue(position))
    .filter(Boolean);
  const selectedPosition = textValue(objectValue(player.selected_position).position) || undefined;
  return {
    playerKey: textValue(player.player_key),
    name: textValue(nameNode.full, "Unknown Player"),
    position: textValue(player.display_position, "--"),
    team: normalizeTeamAbbreviation(textValue(player.editorial_team_abbr, "FA")),
    teamName: textValue(player.editorial_team_full_name),
    headshotUrl: textValue(headshot.url) || undefined,
    status: textValue(player.status),
    eligiblePositions,
    selectedPosition,
    period: Object.keys(stats).length ? period : "unavailable",
    stats,
    statWindows: period === "unavailable" || !Object.keys(stats).length
      ? undefined
      : { [period]: stats },
  };
};

export const parseFreeAgentPage = (xml: string, period: FreeAgent["period"]): FreeAgent[] => {
  const root = parseXml(xml);
  return findAll(root, "player")
    .map((player) => parsePlayer(player, period))
    .filter((player) => player.playerKey);
};

const PERIODS = ["lastmonth", "lastweek", "season"] as const;

const mergePlayerWindows = (players: FreeAgent[]): FreeAgent | undefined => {
  const preferred = players.find((player) => player.period === "lastmonth")
    ?? players.find((player) => player.period === "lastweek")
    ?? players.find((player) => player.period === "season")
    ?? players[0];
  if (!preferred) return undefined;
  const statWindows: Partial<Record<PlayerStatPeriod, Record<string, number>>> = {};
  for (const player of players) {
    if (player.period !== "unavailable" && Object.keys(player.stats).length) {
      statWindows[player.period] = player.stats;
    }
  }
  return { ...preferred, statWindows };
};

export const fetchFreeAgents = async (leagueKey: string): Promise<FreeAgent[]> => {
  const { freeAgentLimit } = getRuntimeConfig();
  const allPlayers = new Map<string, FreeAgent>();

  for (let start = 0; start < freeAgentLimit; start += 25) {
    const responses = await Promise.allSettled(
      PERIODS.map(async (period) => ({
        period,
        xml: await fetchYahooXml(
          `/league/${leagueKey}/players;status=A;start=${start}/stats;type=${period}`,
        ),
      })),
    );
    const successful = responses.filter(
      (response): response is PromiseFulfilledResult<{ period: (typeof PERIODS)[number]; xml: string }> =>
        response.status === "fulfilled",
    );
    if (!successful.length) {
      const failure = responses.find((response) => response.status === "rejected") as PromiseRejectedResult | undefined;
      throw failure?.reason ?? new Error("Yahoo returned no free-agent data.");
    }

    const pageByPeriod = successful.map(({ value }) => ({
      period: value.period,
      players: parseFreeAgentPage(value.xml, value.period),
    }));
    const pageKeys = new Set(pageByPeriod.flatMap(({ players }) => players.map((player) => player.playerKey)));

    for (const playerKey of pageKeys) {
      const candidates = pageByPeriod
        .map(({ players }) => players.find((player) => player.playerKey === playerKey))
        .filter((player): player is FreeAgent => Boolean(player));
      const best = mergePlayerWindows(candidates);
      if (best && !allPlayers.has(playerKey)) allPlayers.set(playerKey, best);
    }

    if (pageKeys.size < 25) break;
  }

  return [...allPlayers.values()].slice(0, freeAgentLimit);
};

export const parseRoster = (xml: string): RosterPlayer[] => {
  const root = parseXml(xml);
  return findAll(root, "player")
    .map((player) => parsePlayer(player, "unavailable") as RosterPlayer)
    .filter((player) => player.playerKey);
};

const chunked = <T>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
};

export const fetchRoster = async (
  leagueKey: string,
  teamKey: string,
  date: string,
): Promise<RosterSnapshot> => {
  const metadata = parseRoster(await fetchYahooXml(`/team/${teamKey}/roster;date=${date}/players`));
  if (!metadata.length) return { available: true, players: [] };

  const windowsByPlayer = new Map<string, FreeAgent[]>();
  for (const playerChunk of chunked(metadata, 25)) {
    const playerKeys = playerChunk.map((player) => player.playerKey).join(",");
    const responses = await Promise.allSettled(
      PERIODS.map(async (period) => ({
        period,
        xml: await fetchYahooXml(
          `/league/${leagueKey}/players;player_keys=${playerKeys}/stats;type=${period}`,
        ),
      })),
    );
    for (const response of responses) {
      if (response.status !== "fulfilled") continue;
      for (const player of parseFreeAgentPage(response.value.xml, response.value.period)) {
        windowsByPlayer.set(player.playerKey, [...(windowsByPlayer.get(player.playerKey) ?? []), player]);
      }
    }
  }

  const players = metadata.map((player) => {
    const withStats = mergePlayerWindows(windowsByPlayer.get(player.playerKey) ?? []);
    return {
      ...player,
      ...(withStats ? {
        period: withStats.period,
        stats: withStats.stats,
        statWindows: withStats.statWindows,
      } : {}),
    };
  });
  const playersWithStats = players.filter((player) => player.period !== "unavailable").length;
  return {
    available: playersWithStats > 0,
    players,
    message: playersWithStats > 0 ? undefined : "Yahoo returned the dated roster without player stat windows.",
  };
};
