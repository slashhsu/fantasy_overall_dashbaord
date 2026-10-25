import type { FreeAgent } from "@/lib/types";
import type { InjuryHistory, InjuryOpportunity, InjuryPlayer, InjuryResponse, ReturnAlert } from "@/lib/injury-types";
export const emptyInjuryHistory = (): InjuryHistory => ({ version: 2, observations: [], healthyBaselines: [] });
export const injuryState = (status: string) => {
  const value = status.trim().toUpperCase();
  if (["O", "OUT", "INJ", "IL", "IL+"].includes(value)) return "out";
  if (["Q", "GTD", "DTD", "D", "DAY-TO-DAY"].includes(value)) return "watch";
  if (["", "HEALTHY", "ACTIVE"].includes(value)) return "clear";
  return "unknown";
};
const windowMinutes = (player: FreeAgent, period: "lastweek" | "lastmonth" | "season") => {
  const stats = player.statWindows?.[period];
  const games = stats?.["Games Played (GP)"];
  const minutes = stats?.["Minutes Played"];
  return games && games > 0 && minutes !== undefined && Number.isFinite(minutes) && minutes >= 0 && minutes / games <= 60 ? minutes / games : null;
};
export function injuryPlayer(player: FreeAgent): InjuryPlayer {
  return { playerKey: player.playerKey, name: player.name, team: player.team, position: player.position,
    headshotUrl: player.headshotUrl, status: player.status ?? "", statusKnown: player.status !== undefined,
    weekGames: player.statWindows?.lastweek?.["Games Played (GP)"] ?? null,
    weekMinutes: windowMinutes(player, "lastweek"), monthGames: player.statWindows?.lastmonth?.["Games Played (GP)"] ?? null, seasonGames: player.statWindows?.season?.["Games Played (GP)"] ?? null,
    monthMinutes: windowMinutes(player, "lastmonth"), seasonMinutes: windowMinutes(player, "season"), playedDates: [] };
}
const positions = (position: string) => new Set(position.toUpperCase().split(/[,/\s]+/).filter((part) => ["PG", "SG", "SF", "PF", "C"].includes(part)));
export function positionsOverlap(a: string, b: string) {
  const left = positions(a), right = positions(b);
  return [...left].some((part) => right.has(part));
}
export const INJURY_RULES = {
  baselineGames: 5, importantMinutes: 28, recentGames: 3, recentMinutes: 24,
  minutesGain: 5, perInjuredPlayer: 2, perSection: 5, recommendationLimit: 50,
  returnDecline: 4,
} as const;
const validGames = (games: number | null): games is number => games !== null && Number.isInteger(games) && games >= 0;
const validMinutes = (minutes: number | null): minutes is number => minutes !== null && Number.isFinite(minutes) && minutes >= 0 && minutes <= 60;
export function importantBaseline(player: InjuryPlayer) {
  for (const [period, games, minutes] of [
    ["lastmonth", player.monthGames, player.monthMinutes], ["season", player.seasonGames, player.seasonMinutes],
  ] as const) {
    if (validGames(games) && games >= INJURY_RULES.baselineGames && validMinutes(minutes)) {
      // A sufficient recent sample takes precedence, even when the season average is higher.
      return minutes >= INJURY_RULES.importantMinutes ? { playerKey: player.playerKey, period, games, minutes } : null;
    }
  }
  return null;
}
export function findInjuryOpportunities(
  players: InjuryPlayer[], available: Set<string>, scores: Map<string, { score: number; helps: string[] }>,
  options: { points?: boolean; limitedData?: boolean } = {},
): { opportunities: InjuryOpportunity[]; watchlist: InjuryOpportunity[]; exclusionCounts: Record<string, number> } {
  const featured: InjuryOpportunity[] = [], watch: InjuryOpportunity[] = [];
  const exclusionCounts: Record<string, number> = {};
  const exclude = (reason: string) => { exclusionCounts[reason] = (exclusionCounts[reason] ?? 0) + 1; };
  const ranked = new Map([...scores].slice(0, INJURY_RULES.recommendationLimit));
  for (const star of players) {
    if (!star.statusKnown || !["out", "watch"].includes(injuryState(star.status)) || !star.team || star.team === "FA") continue;
    const baseline = importantBaseline(star);
    if (!baseline) { exclude("傷員重要性不足或基準資料不足"); continue; }
    const candidates = players.filter((player) => player.playerKey !== star.playerKey && available.has(player.playerKey) && player.statusKnown && injuryState(player.status) === "clear" && player.team === star.team && positionsOverlap(player.position, star.position));
    if (!candidates.length) exclude("沒有可取得的同隊相近位置球員");
    for (const player of candidates) {
      const score = ranked.get(player.playerKey);
      if (!score || !Number.isFinite(score.score) || (!options.points && !score.helps.length)) { exclude("未符合目前推薦需求"); continue; }
      if (!validMinutes(player.weekMinutes) || !validMinutes(player.monthMinutes) || !validGames(player.weekGames) || player.weekGames === 0 || !validGames(player.monthGames) || player.monthGames === 0) {
        exclude("替補上場資料不足"); continue;
      }
      const delta = player.weekMinutes - player.monthMinutes;
      const enoughGames = player.weekGames >= INJURY_RULES.recentGames && player.monthGames >= INJURY_RULES.baselineGames;
      const meetsMinutes = player.weekMinutes >= INJURY_RULES.recentMinutes && delta >= INJURY_RULES.minutesGain;
      // A full sample that fails the thresholds is not rescued by a Q flag or a source warning.
      if ((enoughGames && !meetsMinutes) || (!enoughGames && delta <= 0)) { exclude("替補時間或增幅未達門檻"); continue; }
      const benefiting = enoughGames && meetsMinutes && injuryState(star.status) === "out";
      const group = benefiting && !options.limitedData ? "featured" : "watch";
      const reason = options.limitedData ? "limited-data" : injuryState(star.status) === "watch" ? "unconfirmed-absence" : !enoughGames ? "small-sample" : "rotation-gain";
      const item: InjuryOpportunity = { id: `${star.playerKey}:${player.playerKey}`, injuredKey: star.playerKey, beneficiaryKey: player.playerKey,
        benefiting, score: score.score, helps: score.helps, minutesDelta: delta, group, reason, relatedInjuries: [baseline] };
      (group === "featured" ? featured : watch).push(item);
    }
  }
  const compare = (a: InjuryOpportunity, b: InjuryOpportunity) => b.score - a.score || b.minutesDelta - a.minutesDelta || a.beneficiaryKey.localeCompare(b.beneficiaryKey) || a.injuredKey.localeCompare(b.injuredKey);
  function select(items: InjuryOpportunity[], excluded = new Set<string>()) {
    const selected: InjuryOpportunity[] = [], perStar = new Map<string, number>();
    for (const item of items.sort(compare)) {
      if (excluded.has(item.beneficiaryKey) || (perStar.get(item.injuredKey) ?? 0) >= INJURY_RULES.perInjuredPlayer) continue;
      const existing = selected.find((entry) => entry.beneficiaryKey === item.beneficiaryKey);
      if (existing) existing.relatedInjuries.push(...item.relatedInjuries);
      else if (selected.length < INJURY_RULES.perSection) selected.push({ ...item, relatedInjuries: [...item.relatedInjuries] });
      else continue;
      perStar.set(item.injuredKey, (perStar.get(item.injuredKey) ?? 0) + 1);
    }
    return selected;
  }
  const opportunities = select(featured);
  return { opportunities, watchlist: select(watch, new Set(opportunities.map((item) => item.beneficiaryKey))), exclusionCounts };
}
const validTime = (value: unknown, cutoff: number, now: number): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) >= cutoff && Date.parse(value) <= now;
export function sanitizeInjuryHistory(value: unknown, now = Date.now()): InjuryHistory {
  const empty = emptyInjuryHistory();
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 2) return empty;
  const input = value as InjuryHistory, cutoff = now - 30 * 86_400_000;
  empty.observations = (Array.isArray(input.observations) ? input.observations : []).filter((entry) => entry && typeof entry.id === "string" && typeof entry.injuredKey === "string" && typeof entry.beneficiaryKey === "string" && typeof entry.nbaTeam === "string" && validTime(entry.episodeAt, cutoff, now) && validTime(entry.lastSeenAt, cutoff, now) && validTime(entry.lastInjuredAt, cutoff, now) && (entry.beneficiaryMinutes === null || Number.isFinite(entry.beneficiaryMinutes))).slice(-50).map((entry) => ({ ...entry }));
  empty.healthyBaselines = (Array.isArray(input.healthyBaselines) ? input.healthyBaselines : []).filter((entry) => entry && typeof entry.playerKey === "string" && typeof entry.team === "string" && Number.isFinite(entry.minutes) && validTime(entry.observedAt, cutoff, now)).slice(-50).map((entry) => ({ ...entry }));
  return empty;
}
export function applyInjurySnapshot(previous: InjuryHistory, data: InjuryResponse, now = Date.now()): { history: InjuryHistory; alerts: ReturnAlert[] } {
  const history = sanitizeInjuryHistory(previous, now);
  const alerts: ReturnAlert[] = [];
  const fresh = data.status === "complete" && !data.updateStatus?.stale && Date.parse(data.generatedAt) >= now - 10 * 60_000 && Date.parse(data.generatedAt) <= now + 60_000;
  if (!fresh) return { history, alerts };
  const players = new Map(data.players.map((player) => [player.playerKey, player]));
  const sourceAt = data.updateStatus?.fetchedAt ?? data.generatedAt;
  if (!Number.isFinite(Date.parse(sourceAt)) || now - Date.parse(sourceAt) > 10 * 60_000 || Date.parse(sourceAt) > now + 60_000) return { history, alerts };
  for (const entry of history.observations) {
    const star = players.get(entry.injuredKey), backup = players.get(entry.beneficiaryKey);
    if (!star?.statusKnown || !backup || star.team !== entry.nbaTeam || backup.team !== entry.nbaTeam) continue;
    if (Date.parse(sourceAt) < Date.parse(entry.lastSeenAt)) continue;
    if (injuryState(star.status) === "out") {
      if (entry.closedAt && Date.parse(sourceAt) <= Date.parse(entry.lastSeenAt)) continue;
      if (entry.closedAt && !data.opportunities.some((item) => item.relatedInjuries.some((related) => related.playerKey === star.playerKey) && item.beneficiaryKey === backup.playerKey)) continue;
      if (entry.closedAt) { entry.episodeAt = sourceAt; entry.closedAt = undefined; entry.dismissed = false; entry.beneficiaryMinutes = backup.weekMinutes; }
      entry.lastInjuredAt = sourceAt; entry.lastSeenAt = sourceAt;
      continue;
    }
    if (injuryState(star.status) !== "clear" || Date.parse(sourceAt) <= Date.parse(entry.lastInjuredAt)) continue;
    entry.closedAt ??= sourceAt;
    if (entry.dismissed || !data.rosterKeys.includes(backup.playerKey)) continue;
    const playedAfterInjury = star.playedDates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= data.observationDate && date > entry.lastInjuredAt.slice(0, 10));
    const confirmed = playedAfterInjury.length > 0;
    alerts.push({ id: `${entry.id}:${entry.episodeAt}`, injured: star, beneficiary: backup, confirmed, playedAfterInjury,
      roleDeclined: (backup.weekGames ?? 0) >= 3 && backup.weekMinutes !== null && entry.beneficiaryMinutes !== null && backup.weekMinutes <= entry.beneficiaryMinutes - INJURY_RULES.returnDecline,
      previousMinutes: entry.beneficiaryMinutes, currentMinutes: backup.weekMinutes });
    entry.lastSeenAt = sourceAt;
  }
  for (const opportunity of data.opportunities) for (const related of opportunity.relatedInjuries) {
    if (opportunity.group !== "featured") continue;
    const pairId = `${related.playerKey}:${opportunity.beneficiaryKey}`;
    const star = players.get(related.playerKey), backup = players.get(opportunity.beneficiaryKey);
    if (!star?.statusKnown || !backup || injuryState(star.status) !== "out") continue;
    const existing = history.observations.find((entry) => entry.id === pairId);
    if (existing && Date.parse(sourceAt) <= Date.parse(existing.lastSeenAt)) continue;
    if (existing && !existing.closedAt) { existing.lastInjuredAt = sourceAt; existing.lastSeenAt = sourceAt; }
    else {
      history.observations = history.observations.filter((entry) => entry.id !== pairId);
      history.observations.push({ id: pairId, injuredKey: star.playerKey, beneficiaryKey: backup.playerKey, nbaTeam: star.team,
        episodeAt: sourceAt, lastInjuredAt: sourceAt, lastSeenAt: sourceAt, beneficiaryMinutes: backup.weekMinutes });
    }
  }
  for (const player of data.players) {
    if (!player.statusKnown || injuryState(player.status) !== "clear" || (player.weekGames ?? 0) < 3 || player.weekMinutes === null) continue;
    if (history.healthyBaselines.some((entry) => entry.playerKey === player.playerKey && Date.parse(entry.observedAt) >= Date.parse(sourceAt))) continue;
    history.healthyBaselines = history.healthyBaselines.filter((entry) => entry.playerKey !== player.playerKey);
    history.healthyBaselines.push({ playerKey: player.playerKey, team: player.team, minutes: player.weekMinutes, observedAt: sourceAt });
  }
  history.observations = history.observations.sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt)).slice(-50).map((entry) => ({ ...entry }));
  history.healthyBaselines = history.healthyBaselines.slice(-50);
  return { history, alerts };
}
