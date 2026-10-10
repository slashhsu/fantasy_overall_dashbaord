import type {
  DraftBoardResult,
  DraftCategoryMode,
  DraftCategoryScore,
  DraftPlayer,
  DraftRanking,
  DraftMode,
  LeagueCategory,
  LeagueScoringFormat,
  RosterPosition,
} from "@/lib/types";

const LOWER_IS_BETTER = new Set([
  "Turnovers",
  "Personal Fouls",
  "Technical Fouls",
  "Ejections",
  "Flagrant Fouls",
  "Times Fouled Out",
]);

const STAT_ALIASES: Record<string, string[]> = {
  "Field Goal Percentage": ["Field Goal Percentage"],
  "Free Throw Percentage": ["Free Throw Percentage"],
  "3-point Percentage": ["3-point Percentage"],
  "3-point Shots Made": ["Three-Pointers Made (3PM)", "3-point Shots Made"],
  "Points Scored": ["Points Scored", "Total Points (PTS)"],
  "Offensive Rebounds": ["Offensive Rebounds", "Offensive Rebounds (OREB)"],
  "Defensive Rebounds": ["Defensive Rebounds", "Defensive Rebounds (DREB)"],
  "Total Rebounds": ["Total Rebounds", "Total Rebounds (REB)"],
  Assists: ["Assists", "Assists (AST)"],
  Steals: ["Steals", "Steals (STL)"],
  "Blocked Shots": ["Blocked Shots", "Blocks (BLK)", "Blocks"],
  Turnovers: ["Turnovers", "Turnovers (TO)"],
  "Assist/Turnover Ratio": ["Assist/Turnover Ratio", "A/T"],
  "Double-Doubles": ["Double-Doubles"],
  "Triple-Doubles": ["Triple-Doubles"],
};

const PERCENTAGE_VOLUME: Record<string, { attempted: string[] }> = {
  "Field Goal Percentage": { attempted: ["Field Goals Attempted (FGA)", "Field Goals Attempted"] },
  "Free Throw Percentage": { attempted: ["Free Throws Attempted (FTA)", "Free Throws Attempted"] },
  "3-point Percentage": { attempted: ["Three-Pointers Attempted (3PA)", "3-point Shots Attempted"] },
};

const POSITION_GROUPS: Record<string, string[]> = {
  PG: ["PG"],
  SG: ["SG"],
  G: ["PG", "SG", "G"],
  SF: ["SF"],
  PF: ["PF"],
  F: ["SF", "PF", "F"],
  C: ["C"],
  Util: ["PG", "SG", "SF", "PF", "C", "G", "F", "Util"],
  UTIL: ["PG", "SG", "SF", "PF", "C", "G", "F", "Util", "UTIL"],
  BN: ["PG", "SG", "SF", "PF", "C", "G", "F", "Util", "UTIL", "BN"],
};

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

const mean = (values: number[]) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : 0;

const standardDeviation = (values: number[]) => {
  if (values.length < 2) return 1;
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  const result = Math.sqrt(variance);
  return result > 1e-9 ? result : 1;
};

const erf = (value: number) => {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-x * x));
};

const normalCdf = (value: number) => 0.5 * (1 + erf(value / Math.sqrt(2)));

const firstStat = (player: DraftPlayer, names: string[]) => {
  for (const name of names) {
    const value = player.stats[name];
    if (Number.isFinite(value)) return value;
  }
  return Number.NaN;
};

const marketRank = (player: DraftPlayer) => player.draftAnalysis.averagePick
  ?? player.yahooRank
  ?? 1_000;

const primaryPositions = (player: DraftPlayer) => {
  const positions = player.eligiblePositions.length
    ? player.eligiblePositions
    : player.position.split(",").map((position) => position.trim());
  return positions.filter((position) => ["PG", "SG", "SF", "PF", "C"].includes(position));
};

const categoryMetric = (player: DraftPlayer, category: LeagueCategory, percentageAverage: number) => {
  const aliases = STAT_ALIASES[category.name] ?? [category.name];
  const rawValue = firstStat(player, aliases);
  if (!Number.isFinite(rawValue)) return Number.NaN;
  const percentage = PERCENTAGE_VOLUME[category.name];
  if (percentage) {
    const attempts = firstStat(player, percentage.attempted);
    if (!(attempts > 0)) return Number.NaN;
    return (rawValue - percentageAverage) * attempts;
  }
  return LOWER_IS_BETTER.has(category.name) ? -rawValue : rawValue;
};

interface CategoryDescriptor {
  category: LeagueCategory;
  zScores: Map<string, number>;
}

const buildCategoryDescriptors = (
  players: DraftPlayer[],
  categories: LeagueCategory[],
  draftableCount: number,
) => {
  const marketSorted = [...players].sort((left, right) => marketRank(left) - marketRank(right));
  const referencePlayers = marketSorted
    .filter((player) => player.gamesPlayed > 0)
    .slice(0, Math.max(30, draftableCount));

  return categories.filter((category) => category.enabled).map((category): CategoryDescriptor => {
    const percentage = PERCENTAGE_VOLUME[category.name];
    const percentageAverage = percentage
      ? (() => {
          let weightedTotal = 0;
          let attemptsTotal = 0;
          for (const player of referencePlayers) {
            const ratio = firstStat(player, STAT_ALIASES[category.name] ?? [category.name]);
            const attempts = firstStat(player, percentage.attempted);
            if (!Number.isFinite(ratio) || !(attempts > 0)) continue;
            weightedTotal += ratio * attempts;
            attemptsTotal += attempts;
          }
          return attemptsTotal > 0 ? weightedTotal / attemptsTotal : 0;
        })()
      : 0;
    const rawValues = new Map(
      players.map((player) => [player.playerKey, categoryMetric(player, category, percentageAverage)]),
    );
    const referenceValues = referencePlayers
      .map((player) => rawValues.get(player.playerKey) ?? Number.NaN)
      .filter(Number.isFinite);
    const average = mean(referenceValues);
    const deviation = standardDeviation(referenceValues);

    const positionMeans = new Map<string, number>();
    for (const position of ["PG", "SG", "SF", "PF", "C"]) {
      const values = referencePlayers
        .filter((player) => primaryPositions(player).includes(position))
        .map((player) => rawValues.get(player.playerKey) ?? Number.NaN)
        .filter(Number.isFinite);
      positionMeans.set(position, values.length ? mean(values) : average);
    }

    const zScores = new Map(players.map((player) => {
      const observed = rawValues.get(player.playerKey) ?? Number.NaN;
      const positions = primaryPositions(player);
      const imputed = positions.length
        ? mean(positions.map((position) => positionMeans.get(position) ?? average))
        : average;
      if (player.gamesPlayed <= 0) return [player.playerKey, 0];
      return [player.playerKey, clamp(((Number.isFinite(observed) ? observed : imputed) - average) / deviation, -3.5, 3.5)];
    }));
    return { category, zScores };
  });
};

const expandedRosterSlots = (positions: RosterPosition[]) => {
  const slots: string[] = [];
  for (const item of positions) {
    if (["IL", "IL+", "NA"].includes(item.position.toUpperCase())) continue;
    for (let index = 0; index < item.count; index += 1) slots.push(item.position);
  }
  return slots.length ? slots : ["PG", "SG", "SF", "PF", "C", "G", "F", "Util", "Util", "BN", "BN", "BN", "BN"];
};

const canUseSlot = (player: DraftPlayer, slot: string) => {
  const allowed = POSITION_GROUPS[slot] ?? [slot];
  const eligible = player.eligiblePositions.length
    ? player.eligiblePositions
    : player.position.split(",").map((position) => position.trim());
  return allowed.some((position) => eligible.includes(position)) || ["BN", "Util", "UTIL"].includes(slot);
};

const assignRoster = (players: DraftPlayer[], slots: string[]) => {
  const assigned = new Map<number, DraftPlayer>();
  const playerToSlot = new Map<string, number>();
  const ordered = [...players].sort((left, right) => {
    const leftOptions = slots.filter((slot) => canUseSlot(left, slot)).length;
    const rightOptions = slots.filter((slot) => canUseSlot(right, slot)).length;
    return leftOptions - rightOptions;
  });

  const place = (player: DraftPlayer, visited: Set<number>): boolean => {
    const compatible = slots
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => canUseSlot(player, slot))
      .sort((left, right) => {
        const priority = (slot: string) => slot === "BN" ? 3 : ["Util", "UTIL"].includes(slot) ? 2 : ["G", "F"].includes(slot) ? 1 : 0;
        return priority(left.slot) - priority(right.slot);
      });
    for (const { index } of compatible) {
      if (visited.has(index)) continue;
      visited.add(index);
      const occupant = assigned.get(index);
      if (!occupant || place(occupant, visited)) {
        assigned.set(index, player);
        playerToSlot.set(player.playerKey, index);
        return true;
      }
    }
    return false;
  };

  for (const player of ordered) place(player, new Set());
  return { assigned, playerToSlot };
};

const recommendedSlot = (roster: DraftPlayer[], candidate: DraftPlayer, slots: string[]) => {
  const assignment = assignRoster([...roster, candidate], slots);
  const slotIndex = assignment.playerToSlot.get(candidate.playerKey);
  if (slotIndex === undefined) return "Roster full";
  return slots[slotIndex]?.toUpperCase() ?? "UTIL";
};

export const nextSnakePicks = (currentPick: number, teamCount: number, draftSlot: number) => {
  const safeTeams = clamp(Math.floor(teamCount), 2, 30);
  const safeSlot = clamp(Math.floor(draftSlot), 1, safeTeams);
  const pickInRound = (roundNumber: number) => roundNumber % 2 === 1
    ? (roundNumber - 1) * safeTeams + safeSlot
    : roundNumber * safeTeams - safeSlot + 1;
  let roundNumber = Math.max(1, Math.floor((currentPick - 1) / safeTeams) + 1);
  while (pickInRound(roundNumber) < currentPick) roundNumber += 1;
  const nextUserPick = pickInRound(roundNumber);
  const followingUserPick = pickInRound(roundNumber + 1);
  return {
    nextUserPick,
    followingUserPick,
    round: Math.floor((currentPick - 1) / safeTeams) + 1,
    picksUntilTurn: Math.max(0, nextUserPick - currentPick),
  };
};

export const nextLinearPicks = (currentPick: number, teamCount: number, draftSlot: number) => {
  const safeTeams = clamp(Math.floor(teamCount), 2, 30);
  const safeSlot = clamp(Math.floor(draftSlot), 1, safeTeams);
  let nextUserPick = safeSlot;
  while (nextUserPick < currentPick) nextUserPick += safeTeams;
  return {
    nextUserPick,
    followingUserPick: nextUserPick + safeTeams,
    round: Math.floor((currentPick - 1) / safeTeams) + 1,
    picksUntilTurn: Math.max(0, nextUserPick - currentPick),
  };
};

const poissonBinomialMajority = (probabilities: number[]) => {
  const distribution = Array(probabilities.length + 1).fill(0) as number[];
  distribution[0] = 1;
  probabilities.forEach((probability, index) => {
    for (let wins = index + 1; wins >= 0; wins -= 1) {
      distribution[wins] = (distribution[wins] ?? 0) * (1 - probability)
        + (wins > 0 ? (distribution[wins - 1] ?? 0) * probability : 0);
    }
  });
  const majority = Math.floor(probabilities.length / 2) + 1;
  return distribution.slice(majority).reduce((sum, probability) => sum + probability, 0);
};

const categoryWeight = (mode: DraftCategoryMode, currentProbability: number, rosterSize: number) => {
  if (mode === "punt") return 0;
  const explicit = mode === "target" ? 1.35 : 1;
  if (rosterSize < 3) return explicit;
  if (currentProbability < 0.2) return explicit * 0.25;
  if (currentProbability < 0.35) return explicit * 0.6;
  if (currentProbability > 0.82) return explicit * 0.7;
  return explicit;
};

const featureScale = (value: number, values: number[]) => {
  const deviation = standardDeviation(values);
  return normalCdf((value - mean(values)) / deviation) * 100;
};

const projectionConfidence = (player: DraftPlayer) => {
  if (player.projectionSource === "market-only" || player.gamesPlayed <= 0) {
    return { label: "Market" as const, score: 15, reasons: ["Yahoo market signal only", "No category projection"] };
  }
  let score = Math.min(90, 30 + player.gamesPlayed * 1.5);
  const reasons = [`${player.gamesPlayed} projection games`];
  if (player.projectionSource === "previous-season") {
    score = Math.min(score, 69);
    reasons.push("Previous-season data is capped at Medium");
  } else {
    reasons.push("Current-season data");
  }
  if (player.draftAnalysis.averagePick === null && player.yahooRank === null) {
    score -= 15;
    reasons.push("No Yahoo market coverage");
  }
  if (player.status) {
    score -= 15;
    reasons.push(`Yahoo health status ${player.status}`);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { label: score >= 75 ? "High" as const : score >= 45 ? "Medium" as const : "Low" as const, score, reasons };
};

export interface BuildDraftBoardOptions {
  players: DraftPlayer[];
  categories: LeagueCategory[];
  rosterPositions: RosterPosition[];
  scoringFormat: LeagueScoringFormat;
  teamCount: number;
  draftSlot: number;
  draftedPlayerKeys: Iterable<string>;
  userPlayerKeys: Iterable<string>;
  categoryModes?: Record<string, DraftCategoryMode>;
  draftMode?: DraftMode;
  auctionBudget?: number;
  userSpent?: number;
  auctionSpent?: number;
  auctionExpectedSpent?: number;
}

export const buildDraftBoard = (options: BuildDraftBoardOptions): DraftBoardResult => {
  const draftedKeys = new Set(options.draftedPlayerKeys);
  const userKeys = new Set(options.userPlayerKeys);
  const playerByKey = new Map(options.players.map((player) => [player.playerKey, player]));
  const userRoster = [...userKeys].map((key) => playerByKey.get(key)).filter((player): player is DraftPlayer => Boolean(player));
  const slots = expandedRosterSlots(options.rosterPositions);
  const totalRosterSize = slots.length;
  const currentPick = draftedKeys.size + 1;
  const draftMode = options.draftMode ?? "snake";
  const turn = draftMode === "linear"
    ? nextLinearPicks(currentPick, options.teamCount, options.draftSlot)
    : nextSnakePicks(currentPick, options.teamCount, options.draftSlot);
  const activeCategories = options.categories.filter((category) => category.enabled);
  const descriptors = buildCategoryDescriptors(
    options.players,
    activeCategories,
    options.teamCount * totalRosterSize,
  );
  const teamSums = new Map(descriptors.map((descriptor) => [
    descriptor.category.statId,
    userRoster.reduce((sum, player) => sum + (descriptor.zScores.get(player.playerKey) ?? 0), 0),
  ]));
  const probabilitySigma = Math.sqrt(Math.max(totalRosterSize, 1));
  const currentProbabilities = descriptors.map((descriptor) => normalCdf(
    (teamSums.get(descriptor.category.statId) ?? 0) / probabilitySigma,
  ));
  const weights = descriptors.map((descriptor, index) => categoryWeight(
    options.categoryModes?.[descriptor.category.statId] ?? "balanced",
    currentProbabilities[index] ?? 0.5,
    userRoster.length,
  ));
  const effectiveCurrentProbabilities = currentProbabilities.map((probability, index) => (
    (options.categoryModes?.[descriptors[index]?.category.statId ?? ""] ?? "balanced") === "punt"
      ? 0
      : probability
  ));

  const currentObjective = options.scoringFormat === "most-categories"
    ? poissonBinomialMajority(effectiveCurrentProbabilities)
    : currentProbabilities.reduce((sum, probability, index) => sum + probability * (weights[index] ?? 1), 0);

  const available = options.players.filter((player) => !draftedKeys.has(player.playerKey));
  const raw = available.map((player) => {
    const categoryScores: DraftCategoryScore[] = descriptors.map((descriptor, index) => {
      const zScore = descriptor.zScores.get(player.playerKey) ?? 0;
      const weight = weights[index] ?? 1;
      return {
        statId: descriptor.category.statId,
        displayName: descriptor.category.displayName,
        zScore,
        weightedScore: weight === 0 ? 0 : zScore * weight,
      };
    });
    const projectedProbabilities = descriptors.map((descriptor) => normalCdf(
      ((teamSums.get(descriptor.category.statId) ?? 0) + (descriptor.zScores.get(player.playerKey) ?? 0)) / probabilitySigma,
    ));
    let dynamicValue: number;
    if (options.scoringFormat === "rotisserie") {
      dynamicValue = projectedProbabilities.reduce((sum, probability, index) => {
        const before = currentProbabilities[index] ?? 0.5;
        return sum + (probability - before) * Math.max(1, options.teamCount - 1) * (weights[index] ?? 1);
      }, 0);
    } else if (options.scoringFormat === "most-categories") {
      const effectiveProjected = projectedProbabilities.map((probability, index) => (
        (options.categoryModes?.[descriptors[index]?.category.statId ?? ""] ?? "balanced") === "punt"
          ? 0
          : probability
      ));
      dynamicValue = poissonBinomialMajority(effectiveProjected) - currentObjective;
    } else if (options.scoringFormat === "points") {
      dynamicValue = activeCategories.reduce((sum, category) => {
        const value = firstStat(player, STAT_ALIASES[category.name] ?? [category.name]);
        return sum + (Number.isFinite(value) ? value * (category.scoringModifier ?? 0) : 0);
      }, 0);
      if (!Number.isFinite(dynamicValue) || dynamicValue === 0) dynamicValue = -marketRank(player) / 100;
    } else {
      dynamicValue = projectedProbabilities.reduce(
        (sum, probability, index) => sum + probability * (weights[index] ?? 1),
        0,
      ) - currentObjective;
    }
    const weightedCategories = categoryScores.filter((score) => (
      options.categoryModes?.[score.statId] ?? "balanced"
    ) !== "punt");
    const baseValue = weightedCategories.length
      ? mean(weightedCategories.map((score) => score.weightedScore))
      : 0;
    const adp = player.draftAnalysis.averagePick ?? player.yahooRank;
    const availabilityNextTurn = adp === null
      ? null
      : normalCdf((adp - turn.followingUserPick) / Math.max(6, adp * 0.12));
    return {
      player,
      categoryScores,
      dynamicValue,
      baseValue,
      availabilityNextTurn,
      slot: recommendedSlot(userRoster, player, slots),
    };
  });

  const baseValues = raw.map((item) => item.baseValue);
  const positionScarcity = raw.map((item) => {
    const positions = primaryPositions(item.player);
    const futureAlternatives = raw.filter((alternative) => {
      if (alternative.player.playerKey === item.player.playerKey) return false;
      if (!primaryPositions(alternative.player).some((position) => positions.includes(position))) return false;
      const rank = marketRank(alternative.player);
      return rank >= turn.followingUserPick - 5;
    });
    const replacement = futureAlternatives.length
      ? Math.max(...futureAlternatives.map((alternative) => alternative.baseValue))
      : mean(baseValues);
    const openSlotBonus = item.slot === "Roster full" ? -0.75 : item.slot === "BN" ? 0 : 0.2;
    return item.baseValue - replacement + openSlotBonus;
  });
  const urgency = raw.map((item, index) => {
    const returnRisk = item.availabilityNextTurn === null ? 0.5 : 1 - item.availabilityNextTurn;
    return Math.max(0, item.dynamicValue) * returnRisk + Math.max(0, positionScarcity[index] ?? 0) * 0.15;
  });
  const dynamicValues = raw.map((item) => item.dynamicValue);
  const marketValues = raw.map((item) => -marketRank(item.player));
  const scarcityValues = positionScarcity;
  const urgencyValues = urgency;

  const scored = raw.map((item, index) => {
    const dynamicPercentile = featureScale(item.dynamicValue, dynamicValues);
    const basePercentile = featureScale(item.baseValue, baseValues);
    const scarcityPercentile = featureScale(scarcityValues[index] ?? 0, scarcityValues);
    const urgencyPercentile = featureScale(urgencyValues[index] ?? 0, urgencyValues);
    const marketPercentile = featureScale(marketValues[index] ?? -1_000, marketValues);
    const marketOnly = item.player.gamesPlayed <= 0;
    const composite = marketOnly
      ? marketPercentile * 0.25 + scarcityPercentile * 0.15 + urgencyPercentile * 0.1
      : dynamicPercentile * 0.4 + marketPercentile * 0.25 + scarcityPercentile * 0.15 + basePercentile * 0.1 + urgencyPercentile * 0.1;
    const sortedCategories = [...item.categoryScores].sort((left, right) => right.weightedScore - left.weightedScore);
    const reasons = sortedCategories
      .filter((category) => category.weightedScore > 0.25)
      .slice(0, 2)
      .map((category) => `${category.displayName} +${round(category.zScore, 1)}z`);
    if (item.slot !== "Roster full" && reasons.length < 3) reasons.push(`Fills ${item.slot}`);
    if (scarcityPercentile >= 75 && reasons.length < 3) reasons.push("Position scarcity");
    if (item.availabilityNextTurn !== null && item.availabilityNextTurn < 0.35 && reasons.length < 3) {
      reasons.push(`Unlikely back at ${turn.followingUserPick}`);
    }
    const watchouts = sortedCategories
      .filter((category) => category.weightedScore < -0.45)
      .sort((left, right) => left.weightedScore - right.weightedScore)
      .slice(0, 2)
      .map((category) => `${category.displayName} ${round(category.zScore, 1)}z`);
    if (marketOnly) watchouts.unshift("ADP only; no category history");
    if (item.slot === "Roster full") watchouts.unshift("No roster slot");
    if (item.availabilityNextTurn !== null && item.availabilityNextTurn > 0.82 && turn.picksUntilTurn > 0) {
      watchouts.push(`May last to pick ${turn.followingUserPick}`);
    }
    if (item.player.status) watchouts.push(`Yahoo status: ${item.player.status}`);
    return {
      item,
      composite,
      basePercentile,
      dynamicPercentile,
      scarcityPercentile,
      urgencyPercentile,
      reasons: reasons.slice(0, 3),
      watchouts: watchouts.slice(0, 3),
    };
  }).sort((left, right) => right.composite - left.composite || marketRank(left.item.player) - marketRank(right.item.player));

  const budget = Math.max(totalRosterSize, options.auctionBudget ?? 200);
  const remainingSlots = Math.max(1, totalRosterSize - userRoster.length);
  const maxBid = Math.max(1, budget - (options.userSpent ?? 0) - (remainingSlots - 1));
  const draftable = scored.slice(0, Math.min(scored.length, options.teamCount * totalRosterSize));
  const replacement = draftable.length ? draftable[draftable.length - 1].composite : 0;
  const marginalTotal = draftable.reduce((sum, entry) => sum + Math.max(0, entry.composite - replacement), 0);
  const discretionaryPool = Math.max(0, (budget - totalRosterSize) * options.teamCount);
  const inflation = (options.auctionExpectedSpent ?? 0) > 0
    ? clamp((options.auctionSpent ?? 0) / (options.auctionExpectedSpent ?? 1), 0.75, 1.5)
    : 1;
  const rankings: DraftRanking[] = scored.map((entry, index) => {
    const confidence = projectionConfidence(entry.item.player);
    const marginalValue = Math.max(0, entry.composite - replacement);
    const recommendedPrice = draftMode === "salary-cap"
      ? Math.min(maxBid, Math.max(1, Math.round((1 + (marginalTotal > 0 ? discretionaryPool * marginalValue / marginalTotal : 0)) * inflation)))
      : null;
    const yahooAav = entry.item.player.draftAnalysis.averageCost;
    return {
      player: entry.item.player,
      rank: index + 1,
      score: round(entry.composite),
      baseValue: round(entry.basePercentile),
      teamFit: round(entry.dynamicPercentile),
      scarcity: round(entry.scarcityPercentile),
      turnUrgency: round(entry.urgencyPercentile),
      availabilityNextTurn: entry.item.availabilityNextTurn === null ? null : round(entry.item.availabilityNextTurn * 100),
      estimatedReturn: draftMode === "snake" || draftMode === "linear"
        ? (entry.item.availabilityNextTurn === null ? null : round(entry.item.availabilityNextTurn * 100))
        : null,
      recommendedPrice,
      maxBid: draftMode === "salary-cap" ? maxBid : null,
      auctionValue: recommendedPrice === null || yahooAav === null ? null : round(recommendedPrice - yahooAav),
      recommendedSlot: entry.item.slot,
      confidence: confidence.label,
      confidenceScore: confidence.score,
      confidenceReasons: confidence.reasons,
      categoryScores: [...entry.item.categoryScores].sort((left, right) => right.weightedScore - left.weightedScore),
      reasons: entry.reasons,
      watchouts: entry.watchouts,
    };
  });

  const teamProfile = descriptors.map((descriptor) => {
    const mode = options.categoryModes?.[descriptor.category.statId] ?? "balanced";
    const zScore = (teamSums.get(descriptor.category.statId) ?? 0) / Math.sqrt(Math.max(userRoster.length, 1));
    return {
      statId: descriptor.category.statId,
      displayName: descriptor.category.displayName,
      zScore: round(zScore, 2),
      percentile: round(normalCdf(zScore) * 100),
      mode,
    };
  });
  const inferredPunts = userRoster.length < 3
    ? []
    : teamProfile.filter((category, index) => category.mode === "balanced" && (weights[index] ?? 1) < 0.5).map((category) => category.displayName);

  return {
    rankings,
    teamProfile,
    currentPick,
    ...turn,
    inferredPunts,
  };
};
