import type { FreeAgent } from "@/lib/types";
import type { InjuryHistory, InjuryOpportunity, InjuryPlayer, InjuryResponse, ReturnAlert } from "@/lib/injury-types";
export const emptyInjuryHistory = (): InjuryHistory => ({ version: 1, observations: [], healthyBaselines: [] });
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
    weekMinutes: windowMinutes(player, "lastweek"), monthMinutes: windowMinutes(player, "lastmonth"), seasonMinutes: windowMinutes(player, "season"), playedDates: [] };
}
const positions = (position: string) => new Set(position.toUpperCase().split(/[,/\s]+/).filter((part) => ["PG", "SG", "SF", "PF", "C"].includes(part)));
export function positionsOverlap(a: string, b: string) {
  const left = positions(a), right = positions(b);
  return [...left].some((part) => right.has(part));
}
export function findInjuryOpportunities(players: InjuryPlayer[], available: Set<string>, scores: Map<string, { score: number; helps: string[] }>): InjuryOpportunity[] {
  const result: InjuryOpportunity[] = [];
  for (const star of players) {
    if (!star.statusKnown || !["out", "watch"].includes(injuryState(star.status)) || !star.team || star.team === "FA") continue;
    const knownBaselines = [star.seasonMinutes, star.monthMinutes].filter((value): value is number => value !== null);
    const baseline = knownBaselines.length ? Math.max(...knownBaselines) : null;
    // Season/month averages are a proxy, not proof of a healthy-period starter role.
    if (baseline !== null && baseline < 24) continue;
    const candidates = players.filter((player) => player.playerKey !== star.playerKey && available.has(player.playerKey) && player.statusKnown && injuryState(player.status) === "clear" && player.team === star.team && positionsOverlap(player.position, star.position));
    for (const player of candidates) {
      const delta = player.weekMinutes !== null && player.monthMinutes !== null ? player.weekMinutes - player.monthMinutes : null;
      result.push({ id: `${star.playerKey}:${player.playerKey}`, injuredKey: star.playerKey, beneficiaryKey: player.playerKey,
        benefiting: injuryState(star.status) === "out" && (player.weekGames ?? 0) >= 3 && delta !== null && delta >= 4,
        score: scores.get(player.playerKey)?.score ?? null, helps: scores.get(player.playerKey)?.helps ?? [], minutesDelta: delta });
    }
  }
  result.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || Number(b.benefiting) - Number(a.benefiting) || a.id.localeCompare(b.id));
  const perStar = new Map<string, number>();
  return result.filter((item) => { const count = perStar.get(item.injuredKey) ?? 0; perStar.set(item.injuredKey, count + 1); return count < 3; }).slice(0, 18);
}
const validTime = (value: unknown, cutoff: number, now: number): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) >= cutoff && Date.parse(value) <= now;
export function sanitizeInjuryHistory(value: unknown, now = Date.now()): InjuryHistory {
  const empty = emptyInjuryHistory();
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) return empty;
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
      roleDeclined: (backup.weekGames ?? 0) >= 3 && backup.weekMinutes !== null && entry.beneficiaryMinutes !== null && backup.weekMinutes <= entry.beneficiaryMinutes - 4,
      previousMinutes: entry.beneficiaryMinutes, currentMinutes: backup.weekMinutes });
    entry.lastSeenAt = sourceAt;
  }
  for (const opportunity of data.opportunities) {
    const star = players.get(opportunity.injuredKey), backup = players.get(opportunity.beneficiaryKey);
    if (!star?.statusKnown || !backup || injuryState(star.status) !== "out") continue;
    const existing = history.observations.find((entry) => entry.id === opportunity.id);
    if (existing && Date.parse(sourceAt) <= Date.parse(existing.lastSeenAt)) continue;
    if (existing && !existing.closedAt) { existing.lastInjuredAt = sourceAt; existing.lastSeenAt = sourceAt; }
    else {
      history.observations = history.observations.filter((entry) => entry.id !== opportunity.id);
      history.observations.push({ id: opportunity.id, injuredKey: star.playerKey, beneficiaryKey: backup.playerKey, nbaTeam: star.team,
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
