import "server-only";

import { withCache } from "@/lib/cache";
import { getRuntimeConfig } from "@/lib/config";
import { compactCategoryName, canonicalCategoryName, normalizeTeamAbbreviation, statNameForId } from "@/lib/stats";
import type {
  FreeAgent,
  DraftAnalysis,
  DraftMode,
  DraftPlayer,
  DraftResult,
  LeagueCategory,
  LeagueConfiguration,
  LeagueScoringFormat,
  LeagueSummary,
  LeagueTeamStats,
  DataQualitySummary,
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
  if (normalized === "roto") return "rotisserie";
  if (normalized === "point" || normalized === "points") return "points";
  return "unknown";
};

export const draftModeFor = (value: string): DraftMode => {
  const normalized = value.trim().toLowerCase().replaceAll(/[^a-z]/g, "");
  if (normalized.includes("auction") || normalized.includes("salarycap")) return "salary-cap";
  if (normalized.includes("linear")) return "linear";
  if (normalized.includes("offline")) return "offline";
  if (normalized.includes("live") || normalized.includes("snake") || normalized.includes("standard")) return "snake";
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
      teamCount: numeric(league.num_teams) || undefined,
      draftStatus: textValue(league.draft_status) || undefined,
      draftType: textValue(league.draft_type) || undefined,
      userTeam: userTeam ? parseTeamSummary(userTeam) : { key: "", name: "My Team" },
    };
  });
};

export const parseLeagueTeams = (xml: string) => findAll(parseXml(xml), "team")
  .map(parseTeamSummary)
  .filter((team) => team.key);

export const fetchLeagueTeams = async (leagueKey: string) =>
  parseLeagueTeams(await fetchYahooXml(`/league/${leagueKey}/teams`));

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
  const modifiers = new Map(
    findAll(objectValue(settings.stat_modifiers), "stat")
      .map((stat) => [textValue(stat.stat_id), numeric(stat.value, Number.NaN)] as const)
      .filter((entry) => entry[0] && Number.isFinite(entry[1])),
  );
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
        ...(modifiers.has(statId) ? { scoringModifier: modifiers.get(statId) } : {}),
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
  const settings = findAll(root, "settings")[0] ?? root;
  const draftType = textValue(settings.draft_type) || textValue(league.draft_type) || undefined;
  return {
    categories: parseLeagueSettings(xml),
    rosterPositions: parseRosterPositions(root),
    scoringFormat: scoringFormatFor(textValue(league.scoring_type)),
    teamCount: numeric(league.num_teams) || undefined,
    draftStatus: textValue(league.draft_status) || undefined,
    draftType,
    draftMode: draftModeFor(draftType ?? ""),
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

export const parseLeagueTeamStats = (xml: string): LeagueTeamStats[] => findAll(parseXml(xml), "team")
  .map((team) => {
    const parsed = parseTeam(team);
    const standings = objectValue(team.team_standings);
    return {
      teamKey: parsed.teamKey,
      name: parsed.name,
      rank: numeric(standings.rank) || undefined,
      stats: parsed.stats,
    };
  })
  .filter((team) => team.teamKey);

export const fetchLeagueStandings = async (leagueKey: string) =>
  parseLeagueTeamStats(await fetchYahooXml(`/league/${leagueKey}/standings`));

export const fetchLeagueTeamStats = async (leagueKey: string) =>
  parseLeagueTeamStats(await fetchYahooXml(`/league/${leagueKey}/teams;out=stats`));

export const parseScoreboard = (xml: string, fallbackWeek: number): Matchup[] => {
  const root = parseXml(xml);
  return findAll(root, "matchup")
    .map((matchup, index): Matchup | null => {
      const teams = directChildren(matchup, "teams", "team");
      if (teams.length < 2) return null;
      const teamA = parseTeam(teams[0]);
      const teamB = parseTeam(teams[1]);
      return {
        id: `${teamA.teamKey}::${teamB.teamKey}` || String(index),
        week: numeric(matchup.week, fallbackWeek),
        startDate: textValue(matchup.week_start) || undefined,
        endDate: textValue(matchup.week_end) || undefined,
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
    playerId: textValue(player.player_id) || textValue(player.player_key).split(".p.")[1] || undefined,
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

export const mergePlayerWindows = (players: FreeAgent[]): FreeAgent | undefined => {
  const preferred = players.find((player) => player.period === "lastmonth")
    ?? players.find((player) => player.period === "lastweek")
    ?? players.find((player) => player.period === "season")
    ?? players[0];
  if (!preferred) return undefined;
  const statWindows: Partial<Record<PlayerStatPeriod, Record<string, number>>> = {};
  for (const player of players) {
    if (player.period !== "unavailable" && (player.stats["Games Played (GP)"] ?? 0) > 0) {
      statWindows[player.period] = player.stats;
    }
  }
  return Object.keys(statWindows).length ? { ...preferred, statWindows } : undefined;
};

export interface FreeAgentPoolResult {
  players: FreeAgent[];
  dataQuality: DataQualitySummary;
}

const saneWindow = (stats: Record<string, number>) => {
  const games = stats["Games Played (GP)"] ?? 0;
  if (!(games > 0)) return false;
  const limits: Record<string, number> = {
    "Points Scored": 80,
    "Total Rebounds": 40,
    Assists: 30,
    Steals: 10,
    "Blocked Shots": 10,
    "3-point Shots Made": 20,
    Turnovers: 15,
  };
  return Object.entries(limits).every(([name, limit]) => {
    const value = stats[name];
    return value === undefined || (Number.isFinite(value) && value >= 0 && value / games <= limit);
  });
};

export const fetchFreeAgentPool = async (leagueKey: string): Promise<FreeAgentPoolResult> => {
  const { freeAgentLimit } = getRuntimeConfig();
  const allPlayers = new Map<string, FreeAgent>();
  const gameKey = leagueKey.split(".l.")[0] ?? "";
  const failedWindows = new Set<PlayerStatPeriod>();
  let invalidWindows = 0;

  for (let start = 0; start < freeAgentLimit; start += 25) {
    const metadata = parseFreeAgentPage(
      await fetchYahooXml(`/league/${leagueKey}/players;status=A;start=${start}`),
      "unavailable",
    );
    if (!metadata.length) break;
    const playerKeys = metadata.map((player) => player.playerKey).join(",");
    let responses = await Promise.allSettled(
      PERIODS.map(async (period) => ({ period, xml: await fetchYahooXml(
        `/game/${gameKey}/players;player_keys=${playerKeys}/stats;type=${period}`,
      ) })),
    );
    let successful = responses.filter(
      (response): response is PromiseFulfilledResult<{ period: (typeof PERIODS)[number]; xml: string }> =>
        response.status === "fulfilled",
    );
    responses.forEach((response, index) => {
      if (response.status === "rejected") failedWindows.add(PERIODS[index]);
    });
    if (!successful.length) {
      responses = await Promise.allSettled(
        PERIODS.map(async (period) => ({ period, xml: await fetchYahooXml(
          `/league/${leagueKey}/players;player_keys=${playerKeys}/stats;type=${period}`,
        ) })),
      );
      successful = responses.filter(
        (response): response is PromiseFulfilledResult<{ period: (typeof PERIODS)[number]; xml: string }> =>
          response.status === "fulfilled",
      );
      responses.forEach((response, index) => {
        if (response.status === "rejected") failedWindows.add(PERIODS[index]);
      });
    }

    const pageByPeriod = successful.map(({ value }) => ({
      period: value.period,
      players: parseFreeAgentPage(value.xml, value.period).map((player) => {
        if (!saneWindow(player.stats)) invalidWindows += 1;
        return saneWindow(player.stats) ? player : { ...player, period: "unavailable" as const, stats: {}, statWindows: undefined };
      }),
    }));
    const pageKeys = new Set(metadata.map((player) => player.playerKey));

    for (const playerKey of pageKeys) {
      const playerMetadata = metadata.find((player) => player.playerKey === playerKey);
      const candidates = pageByPeriod
        .map(({ players }) => players.find((player) => player.playerKey === playerKey))
        .filter((player): player is FreeAgent => Boolean(player));
      const best = mergePlayerWindows(candidates);
      if (playerMetadata && !allPlayers.has(playerKey)) {
        allPlayers.set(playerKey, {
          ...playerMetadata,
          ...(best ? {
            period: best.period,
            stats: best.stats,
            statWindows: best.statWindows,
            projectionSource: "current-season" as const,
          } : {
            period: "unavailable" as const,
            stats: {},
            projectionSource: "market-only" as const,
          }),
          name: playerMetadata.name,
          position: playerMetadata.position,
          team: playerMetadata.team,
          teamName: playerMetadata.teamName,
          headshotUrl: playerMetadata.headshotUrl,
          status: playerMetadata.status,
          eligiblePositions: playerMetadata.eligiblePositions,
        });
      }
    }

    if (metadata.length < 25) break;
  }

  let players = [...allPlayers.values()].slice(0, freeAgentLimit);
  const currentUsable = players.filter((player) => player.projectionSource === "current-season").length;
  let previousSeason: number | null = null;
  if (players.length && currentUsable < 20) {
    try {
      const historyXml = await fetchYahooXml("/users;use_login=1/games");
      const history = parseNbaGameHistory(historyXml);
      const current = history.find((game) => game.gameKey === gameKey);
      const previous = history.find((game) => game.season < (current?.season ?? Number.POSITIVE_INFINITY));
      if (previous) {
        const previousPlayers = await fetchDraftPages(
          (start) => `/game/${previous.gameKey}/players;start=${start};count=25;sort=AR/stats;type=season`,
        );
        const previousById = new Map(previousPlayers.map((player) => [player.playerId, player]));
        previousSeason = previous.season;
        players = players.map((player) => {
          if (player.projectionSource === "current-season") return { ...player, projectionSeason: current?.season ?? null };
          const prior = previousById.get(player.playerId ?? "");
          if (!prior || prior.gamesPlayed < 3 || !saneWindow(prior.stats)) return player;
          return {
            ...player,
            period: "season" as const,
            stats: prior.stats,
            statWindows: { season: prior.stats },
            projectionSource: "previous-season" as const,
            projectionSeason: previous.season,
          };
        });
      }
    } catch {
      // Market-only players remain visible when historical Yahoo data is unavailable.
    }
  }

  const sources = new Set(players.map((player) => player.projectionSource ?? "market-only"));
  const marketOnly = players.filter((player) => player.projectionSource === "market-only").length;
  const warnings: string[] = [];
  if (failedWindows.size) warnings.push(`Yahoo did not return ${[...failedWindows].join(", ")} statistics for every page.`);
  if (invalidWindows) warnings.push(`${invalidWindows} invalid or zero-game stat windows were ignored.`);
  if (previousSeason) warnings.push(`Previous-season ${previousSeason} statistics fill players without current-season samples.`);
  if (marketOnly) warnings.push(`${marketOnly} players have market metadata but no valid category projection.`);
  return {
    players,
    dataQuality: {
      status: players.length === 0 ? "unavailable" : warnings.length ? "partial" : "complete",
      projectionSource: sources.size > 1 ? "mixed" : (sources.values().next().value ?? "market-only"),
      failedWindows: [...failedWindows],
      warnings,
      stale: false,
    },
  };
};

export const fetchFreeAgents = async (leagueKey: string) => (await fetchFreeAgentPool(leagueKey)).players;

const playerIdFromKey = (playerKey: string) => playerKey.split(".p.")[1] ?? playerKey;

const parseDraftAnalysis = (player: XmlNode): DraftAnalysis => {
  const analysis = objectValue(player.draft_analysis);
  const optionalNumber = (value: unknown) => {
    const parsed = numeric(value, Number.NaN);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    averagePick: optionalNumber(analysis.average_pick),
    averageRound: optionalNumber(analysis.average_round),
    averageCost: optionalNumber(analysis.average_cost),
    percentDrafted: optionalNumber(analysis.percent_drafted),
  };
};

export const parseDraftPlayerPage = (xml: string): DraftPlayer[] => {
  const root = parseXml(xml);
  return findAll(root, "player")
    .map((node): DraftPlayer => {
      const parsed = parsePlayer(node, "season");
      const gamesPlayed = parsed.stats[statNameForId("0")] ?? 0;
      const yahooRank = parsed.stats[statNameForId("1")];
      return {
        playerKey: parsed.playerKey,
        playerId: textValue(node.player_id) || playerIdFromKey(parsed.playerKey),
        name: parsed.name,
        position: parsed.position,
        eligiblePositions: parsed.eligiblePositions ?? [],
        team: parsed.team,
        headshotUrl: parsed.headshotUrl,
        status: parsed.status,
        yahooRank: Number.isFinite(yahooRank) && yahooRank > 0 ? yahooRank : null,
        draftAnalysis: parseDraftAnalysis(node),
        gamesPlayed,
        projectionSeason: null,
        projectionSource: "market-only",
        stats: parsed.stats,
      };
    })
    .filter((player) => player.playerKey);
};

export const parseDraftResults = (xml: string): DraftResult[] => {
  const root = parseXml(xml);
  return findAll(root, "draft_result")
    .map((result): DraftResult => {
      const cost = numeric(result.cost, Number.NaN);
      return {
        pick: numeric(result.pick),
        round: numeric(result.round),
        teamKey: textValue(result.team_key),
        playerKey: textValue(result.player_key),
        ...(Number.isFinite(cost) ? { cost } : {}),
      };
    })
    .filter((result) => result.pick > 0 && result.playerKey)
    .sort((left, right) => left.pick - right.pick);
};

interface YahooNbaGame {
  gameKey: string;
  season: number;
}

export const parseNbaGameHistory = (xml: string): YahooNbaGame[] => findAll(parseXml(xml), "game")
  .filter((game) => textValue(game.code).toLowerCase() === "nba")
  .map((game) => ({ gameKey: textValue(game.game_key), season: numeric(game.season) }))
  .filter((game) => game.gameKey && game.season > 0)
  .sort((left, right) => right.season - left.season || numeric(right.gameKey) - numeric(left.gameKey));

const fetchDraftPages = async (pathFor: (start: number) => string) => {
  const { freeAgentLimit } = getRuntimeConfig();
  const players: DraftPlayer[] = [];
  for (let start = 0; start < freeAgentLimit; start += 25) {
    const page = parseDraftPlayerPage(await fetchYahooXml(pathFor(start)));
    players.push(...page);
    if (page.length < 25) break;
  }
  return players.slice(0, freeAgentLimit);
};

const isRateStat = (name: string) => name.includes("Percentage") || name.includes("Ratio") || name === "Rank";

const perGameStats = (stats: Record<string, number>, gamesPlayed: number) => {
  if (!(gamesPlayed > 0)) return {};
  return Object.fromEntries(Object.entries(stats).map(([name, value]) => {
    if (name === "Games Played (GP)") return [name, gamesPlayed];
    return [name, isRateStat(name) ? value : value / gamesPlayed];
  }));
};

const mergeDraftProjection = (
  market: DraftPlayer[],
  projectionPool: DraftPlayer[],
  projectionSeason: number | null,
  projectionSource: DraftPlayer["projectionSource"],
) => {
  const projections = new Map(projectionPool.map((player) => [player.playerId, player]));
  return market.map((player): DraftPlayer => {
    const projection = projections.get(player.playerId);
    const gamesPlayed = projection?.gamesPlayed ?? 0;
    const hasProjection = gamesPlayed > 0 && saneWindow(projection?.stats ?? {});
    return {
      ...player,
      yahooRank: player.yahooRank ?? projection?.yahooRank ?? null,
      gamesPlayed,
      projectionSeason: hasProjection ? projectionSeason : null,
      projectionSource: hasProjection ? projectionSource : "market-only",
      stats: hasProjection ? perGameStats(projection?.stats ?? {}, gamesPlayed) : {},
    };
  });
};

const usableProjectionCount = (players: DraftPlayer[]) => players.filter((player) => player.gamesPlayed >= 3 && saneWindow(player.stats)).length;

export const fetchDraftPlayerPool = async (leagueKey: string) => {
  const currentGameKey = leagueKey.split(".l.")[0] ?? "";
  const [historyXml, marketResult, currentStatsResult] = await Promise.all([
    fetchYahooXml("/users;use_login=1/games"),
    fetchDraftPages((start) => `/league/${leagueKey}/players;start=${start};count=25;sort=AR/draft_analysis`)
      .catch(() => [] as DraftPlayer[]),
    fetchDraftPages((start) => `/game/${currentGameKey}/players;start=${start};count=25;sort=AR/stats;type=season`)
      .catch(() => [] as DraftPlayer[]),
  ]);
  const history = parseNbaGameHistory(historyXml);
  const currentGame = history.find((game) => game.gameKey === currentGameKey);
  let market = marketResult;
  if (!market.length) market = currentStatsResult;

  if (usableProjectionCount(currentStatsResult) >= 20) {
    return {
      players: mergeDraftProjection(market, currentStatsResult, currentGame?.season ?? null, "current-season"),
      projectionSeason: currentGame?.season ?? null,
      projectionSource: "current-season" as const,
    };
  }

  const previousGame = history.find((game) => game.season < (currentGame?.season ?? Number.POSITIVE_INFINITY));
  if (previousGame) {
    const previousStats = await fetchDraftPages(
      (start) => `/game/${previousGame.gameKey}/players;start=${start};count=25;sort=AR/stats;type=season`,
    ).catch(() => [] as DraftPlayer[]);
    if (usableProjectionCount(previousStats) >= 20) {
      return {
        players: mergeDraftProjection(market, previousStats, previousGame.season, "previous-season"),
        projectionSeason: previousGame.season,
        projectionSource: "previous-season" as const,
      };
    }
  }

  return {
    players: mergeDraftProjection(market, [], null, "market-only"),
    projectionSeason: null,
    projectionSource: "market-only" as const,
  };
};

export const fetchDraftResults = async (leagueKey: string) =>
  parseDraftResults(await fetchYahooXml(`/league/${leagueKey}/draftresults`));

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
  forceRefresh = false,
): Promise<RosterSnapshot> => {
  const metadata = parseRoster(await fetchYahooXml(`/team/${teamKey}/roster;date=${date}/players`));
  if (!metadata.length) return { available: true, players: [] };
  const gameKey = leagueKey.split(".l.")[0] ?? "";

  let statsStale = false;
  const windowsByPlayer = new Map<string, FreeAgent[]>();
  for (const playerChunk of chunked([...metadata].sort((a, b) => a.playerKey.localeCompare(b.playerKey)), 25)) {
    const playerKeys = playerChunk.map((player) => player.playerKey).join(",");
    const responses = await Promise.allSettled(
      PERIODS.map(async (period) => {
        const result = await withCache(`roster-stats:${gameKey}:${period}:${playerKeys}`, getRuntimeConfig().cacheTtlSeconds,
          () => fetchYahooXml(`/game/${gameKey}/players;player_keys=${playerKeys}/stats;type=${period}`), forceRefresh);
        statsStale ||= result.stale;
        return { period, xml: result.value };
      }),
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
    stale: statsStale,
    available: playersWithStats > 0,
    players,
    message: playersWithStats > 0 ? undefined : "Yahoo returned the dated roster without player stat windows.",
  };
};
