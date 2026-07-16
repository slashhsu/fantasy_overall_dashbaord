import "server-only";

import { withCache } from "@/lib/cache";
import { getRuntimeConfig, isDemoMode } from "@/lib/config";
import { demoCategories, demoFreeAgents, demoLeagues, demoTeamsPlaying, getDemoMatchups } from "@/lib/demo-data";
import { fetchNbaSchedule } from "@/lib/nba-schedule";
import { evaluateMatchup, recommendFreeAgents } from "@/lib/recommender";
import { RECOMMENDER_MODEL } from "@/lib/recommender-model";
import type { DashboardResponse, LeagueConfiguration, LeagueSummary, Matchup, RosterSnapshot, ScheduleInfo } from "@/lib/types";
import { fetchFreeAgents, fetchLeagueConfiguration, fetchLeagues, fetchRoster, fetchScoreboard } from "@/lib/yahoo";

const leaguesCacheKey = "leagues:current";

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
  matchupId?: string;
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

export const getDashboard = async (options: DashboardOptions): Promise<DashboardResponse> => {
  const demoMode = isDemoMode();
  const leagueResult = await getLeagueSummaries(Boolean(options.forceRefresh));
  const league = leagueResult.leagues.find((item) => item.leagueKey === options.leagueKey);
  if (!league) throw new Error("The selected league is not available for this Yahoo account.");
  if (options.week < league.startWeek || options.week > league.endWeek) {
    throw new Error(`Week must be between ${league.startWeek} and ${league.endWeek}.`);
  }

  const { cacheTtlSeconds } = getRuntimeConfig();
  let cached = false;
  let base: {
    configuration: LeagueConfiguration;
    matchups: ReturnType<typeof getDemoMatchups>;
    freeAgents: typeof demoFreeAgents;
    teamsPlaying: typeof demoTeamsPlaying;
    schedule: ScheduleInfo;
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
      schedule: { status: "available", source: "demo", fallbackUsed: false },
    };
  } else {
    const forceRefresh = Boolean(options.forceRefresh);
    const [configuration, matchups, freeAgents, nbaSchedule] = await Promise.all([
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
        () => fetchFreeAgents(league.leagueKey),
        forceRefresh,
      ),
      withCache(
        `nba-schedule:${options.targetDate}`,
        cacheTtlSeconds,
        () => fetchNbaSchedule(options.targetDate),
        forceRefresh,
      ),
    ]);
    base = {
      configuration: configuration.value,
      matchups: matchups.value,
      freeAgents: freeAgents.value,
      teamsPlaying: nbaSchedule.value.teamsPlaying,
      schedule: nbaSchedule.value.schedule,
    };
    cached = configuration.cached && matchups.cached && freeAgents.cached && nbaSchedule.cached;
  }

  const selectedMatchup = findSelectedMatchup(
    base.matchups,
    options.matchupId,
    league.userTeam.key,
  );
  if (!selectedMatchup) throw new Error("Yahoo returned no matchup for the selected week.");

  const selectedTeamIsB = selectedMatchup.teamB.teamKey === league.userTeam.key;
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
    topN: 50,
  });

  return {
    generatedAt: new Date().toISOString(),
    cached: cached && leagueResult.cached,
    demoMode,
    league,
    week: options.week,
    targetDate: options.targetDate,
    selectedMatchupId: selectedMatchup.id,
    selectedTeamKey: selectedTeam.teamKey,
    selectedTeamName: selectedTeam.name,
    opponentName: opponent.name,
    categories: base.configuration.categories,
    matchups: base.matchups,
    categoryNeeds,
    schedule: base.schedule,
    model: RECOMMENDER_MODEL,
    lineupAvailable: roster.available,
    lineupMessage: roster.message,
    teamsPlaying: base.teamsPlaying,
    freeAgentCount: base.freeAgents.length,
    recommendations,
  };
};
