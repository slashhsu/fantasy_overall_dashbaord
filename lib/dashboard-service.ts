import "server-only";

import { withCache } from "@/lib/cache";
import { getRuntimeConfig, isDemoMode } from "@/lib/config";
import { demoCategories, demoFreeAgents, demoLeagues, demoTeamsPlaying, getDemoMatchups } from "@/lib/demo-data";
import { fetchNbaSchedule } from "@/lib/nba-schedule";
import { categoryValidationCoverage, evaluateMatchup, recommendFreeAgents, toNumber } from "@/lib/recommender";
import { RECOMMENDER_MODEL } from "@/lib/recommender-model";
import type { DashboardResponse, DataQualitySummary, LeagueConfiguration, LeagueSummary, LeagueTeamStats, Matchup, RosterSnapshot, ScheduleInfo } from "@/lib/types";
import { ValidationError } from "@/lib/errors";
import { fetchFreeAgentPool, fetchLeagueConfiguration, fetchLeagueStandings, fetchLeagueTeamStats, fetchLeagues, fetchRoster, fetchScoreboard } from "@/lib/yahoo";

const leaguesCacheKey = "leagues:current";

const optionalCached = async <T,>(loader: () => Promise<{ value: T; cached: boolean; stale: boolean }>, fallback: T) => {
  try { return { ...(await loader()), failed: false }; }
  catch { return { value: fallback, cached: false, stale: false, failed: true }; }
};

export const getLeagueSummaries = async (forceRefresh = false) => {
  if (isDemoMode()) return { leagues: demoLeagues, cached: false, demoMode: true };
  const { cacheTtlSeconds } = getRuntimeConfig();
  const result = await withCache<LeagueSummary[]>(
    leaguesCacheKey,
    cacheTtlSeconds,
    fetchLeagues,
    forceRefresh,
  );
  return { leagues: result.value, cached: result.cached, demoMode: false };
};

interface DashboardOptions {
  leagueKey: string;
  week: number;
  targetDate: string;
  timeZone: string;
  matchupId?: string;
  teamKey?: string;
  forceRefresh?: boolean;
}

const findSelectedMatchup = (
  matchups: Matchup[],
  requestedId: string | undefined,
  userTeamKey: string,
) => {
  const requested = requestedId ? matchups.find((matchup) => matchup.id === requestedId) : undefined;
  return requested ?? matchups.find(
    (matchup) => matchup.teamA.teamKey === userTeamKey || matchup.teamB.teamKey === userTeamKey,
  ) ?? matchups[0];
};

const objectiveFor = (format: LeagueConfiguration["scoringFormat"]): DashboardResponse["objective"] => {
  if (format === "most-categories") return "matchup-probability";
  if (format === "points") return "fantasy-points";
  if (format === "rotisserie") return "roto-points";
  return "expected-categories";
};

const mergeStandings = (standings: LeagueTeamStats[], stats: LeagueTeamStats[]) => stats.map((team) => ({
  ...team,
  rank: standings.find((item) => item.teamKey === team.teamKey)?.rank,
}));

const rotoMatchup = (league: LeagueSummary, week: number, teams: LeagueTeamStats[]): Matchup | undefined => {
  const selected = teams.find((team) => team.teamKey === league.userTeam.key);
  if (!selected) return undefined;
  const statIds = new Set(teams.flatMap((team) => Object.keys(team.stats)));
  const averageStats = Object.fromEntries([...statIds].map((statId) => {
    const values = teams.map((team) => toNumber(team.stats[statId])).filter(Number.isFinite);
    return [statId, values.length ? String(values.reduce((sum, value) => sum + value, 0) / values.length) : ""];
  }));
  return {
    id: `${selected.teamKey}::league-average`, week, status: "standings", isPlayoffs: false, isConsolation: false,
    teamA: { teamKey: selected.teamKey, name: selected.name, stats: selected.stats },
    teamB: { teamKey: "league-average", name: "League average", stats: averageStats },
  };
};

export const getDashboard = async (options: DashboardOptions): Promise<DashboardResponse> => {
  const demoMode = isDemoMode();
  const leagueResult = await getLeagueSummaries(Boolean(options.forceRefresh));
  const league = leagueResult.leagues.find((item) => item.leagueKey === options.leagueKey);
  if (!league) throw new ValidationError("The selected league is not available for this Yahoo account.");
  if (options.week < league.startWeek || options.week > league.endWeek) {
    throw new ValidationError(`Week must be between ${league.startWeek} and ${league.endWeek}.`);
  }

  const { cacheTtlSeconds } = getRuntimeConfig();
  let cached = false;
  let base: {
    configuration: LeagueConfiguration;
    matchups: ReturnType<typeof getDemoMatchups>;
    freeAgents: typeof demoFreeAgents;
    teamsPlaying: typeof demoTeamsPlaying;
    schedule: ScheduleInfo;
    dataQuality: DataQualitySummary;
    standings: LeagueTeamStats[];
  };
  if (demoMode) {
    base = {
      configuration: {
        categories: demoCategories,
        rosterPositions: [],
        scoringFormat: league.scoringFormat ?? "each-category",
      },
      matchups: getDemoMatchups(league.leagueKey, options.week),
      freeAgents: demoFreeAgents,
      teamsPlaying: demoTeamsPlaying,
      schedule: { status: "available", source: "demo", fallbackUsed: false, games: [] },
      dataQuality: { status: "complete", projectionSource: "current-season", failedWindows: [], warnings: [], stale: false },
      standings: [],
    };
  } else {
    const forceRefresh = Boolean(options.forceRefresh);
    const [configuration, matchups, freeAgents, nbaSchedule, standings, teamStats] = await Promise.all([
      withCache(
        `settings:${league.leagueKey}`,
        cacheTtlSeconds,
        () => fetchLeagueConfiguration(league.leagueKey),
        forceRefresh,
      ),
      withCache(
        `scoreboard:${league.leagueKey}:${options.week}`,
        cacheTtlSeconds,
        () => fetchScoreboard(league.leagueKey, options.week),
        forceRefresh,
      ),
      withCache(
        `free-agents:${league.leagueKey}`,
        cacheTtlSeconds,
        () => fetchFreeAgentPool(league.leagueKey),
        forceRefresh,
      ),
      withCache(
        `nba-schedule:${options.targetDate}:${options.timeZone}`,
        cacheTtlSeconds,
        () => fetchNbaSchedule(options.targetDate),
        forceRefresh,
      ),
      optionalCached(() => withCache(`standings:${league.leagueKey}`, cacheTtlSeconds, () => fetchLeagueStandings(league.leagueKey), forceRefresh), [] as LeagueTeamStats[]),
      optionalCached(() => withCache(`team-stats:${league.leagueKey}`, cacheTtlSeconds, () => fetchLeagueTeamStats(league.leagueKey), forceRefresh), [] as LeagueTeamStats[]),
    ]);
    const mergedStandings = mergeStandings(standings.value, teamStats.value);
    base = {
      configuration: configuration.value,
      matchups: matchups.value.length || configuration.value.scoringFormat !== "rotisserie"
        ? matchups.value
        : [rotoMatchup({ ...league, userTeam: { ...league.userTeam, key: options.teamKey ?? league.userTeam.key } }, options.week, mergedStandings)].filter((item): item is Matchup => Boolean(item)),
      freeAgents: freeAgents.value.players,
      teamsPlaying: nbaSchedule.value.teamsPlaying,
      schedule: nbaSchedule.value.schedule,
      dataQuality: {
        ...freeAgents.value.dataQuality,
        status: freeAgents.value.dataQuality.status === "complete" && (standings.failed || teamStats.failed) ? "partial" : freeAgents.value.dataQuality.status,
        warnings: [
          ...freeAgents.value.dataQuality.warnings,
          ...(standings.failed || teamStats.failed ? ["League standings or team season statistics are temporarily unavailable."] : []),
        ],
        stale: freeAgents.stale || standings.stale || teamStats.stale,
      },
      standings: mergedStandings,
    };
    cached = configuration.cached && matchups.cached && freeAgents.cached && nbaSchedule.cached && standings.cached && teamStats.cached;
  }

  const perspectiveTeamKey = options.teamKey ?? league.userTeam.key;
  const eligibleMatchups = options.teamKey
    ? base.matchups.filter((matchup) => matchup.teamA.teamKey === options.teamKey || matchup.teamB.teamKey === options.teamKey)
    : base.matchups;
  if (options.teamKey && !eligibleMatchups.length) {
    throw new ValidationError("The selected team has no matchup data for this league and week.");
  }
  const selectedMatchup = findSelectedMatchup(
    eligibleMatchups,
    options.matchupId,
    perspectiveTeamKey,
  );
  if (!selectedMatchup) throw new ValidationError("Yahoo returned no matchup or standings data for the selected week.");

  const selectedTeamIsB = selectedMatchup.teamB.teamKey === perspectiveTeamKey;
  const selectedTeam = selectedTeamIsB ? selectedMatchup.teamB : selectedMatchup.teamA;
  const opponent = selectedTeamIsB ? selectedMatchup.teamA : selectedMatchup.teamB;
  const categoryNeeds = evaluateMatchup(selectedTeam, opponent, base.configuration.categories);
  let roster: RosterSnapshot = {
    available: false,
    players: [],
    message: demoMode ? "Lineup optimization is disabled in demo mode." : "Yahoo lineup data was not requested.",
  };
  if (!demoMode && selectedTeam.teamKey) {
    try {
      const rosterResult = await withCache(
        `roster:${selectedTeam.teamKey}:${options.targetDate}`,
        cacheTtlSeconds,
        () => fetchRoster(league.leagueKey, selectedTeam.teamKey, options.targetDate),
        Boolean(options.forceRefresh),
      );
      roster = rosterResult.value;
      cached = cached && rosterResult.cached;
    } catch (error) {
      roster = {
        available: false,
        players: [],
        message: error instanceof Error ? `Lineup optimization unavailable: ${error.message}` : "Lineup optimization unavailable.",
      };
    }
  }
  const recommendations = recommendFreeAgents(base.freeAgents, categoryNeeds, {
    teamsPlaying: base.teamsPlaying,
    strictGameDay: base.schedule.status === "available",
    targetDate: options.targetDate,
    roster: roster.players,
    rosterPositions: base.configuration.rosterPositions,
    lineupAvailable: roster.available,
    scoringFormat: base.configuration.scoringFormat,
    scheduleGames: base.schedule.games,
    categories: base.configuration.categories,
    standingsTeams: base.standings,
    selectedTeamKey: selectedTeam.teamKey,
    topN: 50,
  });

  return {
    generatedAt: new Date().toISOString(),
    cached: cached && leagueResult.cached,
    demoMode,
    league,
    week: options.week,
    targetDate: options.targetDate,
    timeZone: options.timeZone,
    objective: objectiveFor(base.configuration.scoringFormat),
    selectedMatchupId: selectedMatchup.id,
    selectedTeamKey: selectedTeam.teamKey,
    selectedTeamName: selectedTeam.name,
    opponentName: opponent.name,
    categories: base.configuration.categories,
    matchups: base.matchups,
    categoryNeeds,
    schedule: base.schedule,
    model: RECOMMENDER_MODEL,
    dataQuality: base.dataQuality,
    categoryCoverage: base.configuration.categories.filter((category) => category.enabled).map((category) => ({
      statId: category.statId,
      displayName: category.displayName,
      coverage: categoryValidationCoverage(category.name),
    })),
    standingsContext: {
      available: base.standings.length > 0,
      teams: base.standings,
      message: base.standings.length ? undefined : "League standings were unavailable.",
    },
    lineupAvailable: roster.available,
    lineupMessage: roster.message,
    teamsPlaying: base.teamsPlaying,
    freeAgentCount: base.freeAgents.length,
    recommendations,
  };
};
