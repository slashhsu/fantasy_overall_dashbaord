import "server-only";

import { withCache } from "@/lib/cache";
import { getRuntimeConfig, isDemoMode } from "@/lib/config";
import { getLeagueSummaries } from "@/lib/dashboard-service";
import { demoCategories, demoFreeAgents } from "@/lib/demo-data";
import type { DraftDataResponse, DraftPlayer, LeagueConfiguration } from "@/lib/types";
import { fetchDraftPlayerPool, fetchDraftResults, fetchLeagueConfiguration } from "@/lib/yahoo";

export const DRAFT_MODEL = {
  id: "dynamic-draft-value",
  name: "Dynamic Draft Value",
  version: "1.0.0",
  method: "roster-aware-h-score",
} as const;

const demoDraftPlayers = (): DraftPlayer[] => demoFreeAgents.map((player, index) => {
  const gamesPlayed = player.stats["Games Played (GP)"] ?? 0;
  const perGame = Object.fromEntries(Object.entries(player.stats).map(([name, value]) => [
    name,
    name === "Games Played (GP)" ? value : gamesPlayed > 0 ? value / gamesPlayed : value,
  ]));
  const fga = perGame["Field Goals Attempted (FGA)"] ?? 0;
  const fgm = perGame["Field Goals Made (FGM)"] ?? 0;
  const fta = perGame["Free Throws Attempted (FTA)"] ?? 0;
  const ftm = perGame["Free Throws Made (FTM)"] ?? 0;
  perGame["Field Goal Percentage"] = fga > 0 ? fgm / fga : 0;
  perGame["Free Throw Percentage"] = fta > 0 ? ftm / fta : 0;
  return {
    playerKey: player.playerKey,
    playerId: player.playerKey.split(".p.")[1] ?? String(index + 1),
    name: player.name,
    position: player.position,
    eligiblePositions: player.position.split(",").map((position) => position.trim()),
    team: player.team,
    headshotUrl: player.headshotUrl,
    status: player.status,
    yahooRank: index + 38,
    draftAnalysis: {
      averagePick: index + 38,
      averageRound: 4 + index / 10,
      averageCost: null,
      percentDrafted: 0.72,
    },
    gamesPlayed,
    projectionSeason: 2025,
    projectionSource: "previous-season",
    stats: perGame,
  };
});

export const getDraftData = async (leagueKey: string, forceRefresh = false): Promise<DraftDataResponse> => {
  const leagueResult = await getLeagueSummaries(forceRefresh);
  const league = leagueResult.leagues.find((item) => item.leagueKey === leagueKey);
  if (!league) throw new Error("The selected league is not available for this Yahoo account.");

  if (isDemoMode()) {
    const configuration: LeagueConfiguration = {
      categories: demoCategories,
      rosterPositions: [
        { position: "PG", count: 1 }, { position: "SG", count: 1 },
        { position: "SF", count: 1 }, { position: "PF", count: 1 },
        { position: "C", count: 2 }, { position: "G", count: 1 },
        { position: "F", count: 1 }, { position: "Util", count: 2 },
        { position: "BN", count: 3 },
      ],
      scoringFormat: league.scoringFormat ?? "each-category",
      teamCount: league.teamCount ?? 10,
      draftStatus: "predraft",
      draftType: "live",
    };
    return {
      generatedAt: new Date().toISOString(),
      cached: false,
      demoMode: true,
      league,
      configuration,
      players: demoDraftPlayers(),
      draftResults: [],
      projectionSeason: 2025,
      projectionSource: "previous-season",
      model: DRAFT_MODEL,
    };
  }

  const { cacheTtlSeconds } = getRuntimeConfig();
  const [configuration, pool, results] = await Promise.all([
    withCache(
      `settings:${league.leagueKey}`,
      cacheTtlSeconds,
      () => fetchLeagueConfiguration(league.leagueKey),
      forceRefresh,
    ),
    withCache(
      `draft-pool:${league.leagueKey}`,
      Math.max(cacheTtlSeconds, 3_600),
      () => fetchDraftPlayerPool(league.leagueKey),
      forceRefresh,
    ),
    withCache(
      `draft-results:${league.leagueKey}`,
      10,
      () => fetchDraftResults(league.leagueKey).catch(() => []),
      forceRefresh,
    ),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    cached: configuration.cached && pool.cached && results.cached && leagueResult.cached,
    demoMode: false,
    league,
    configuration: {
      ...configuration.value,
      teamCount: configuration.value.teamCount ?? league.teamCount,
      draftStatus: configuration.value.draftStatus ?? league.draftStatus,
      draftType: configuration.value.draftType ?? league.draftType,
    },
    players: pool.value.players,
    draftResults: results.value,
    projectionSeason: pool.value.projectionSeason,
    projectionSource: pool.value.projectionSource,
    model: DRAFT_MODEL,
  };
};
