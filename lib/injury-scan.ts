import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { getAuthConfig, getRuntimeConfig } from "@/lib/config";
import { withCache } from "@/lib/cache";
import { withUpdateStatus } from "@/lib/update-status";
import { ValidationError } from "@/lib/errors";
import { findAll, parseXml } from "@/lib/xml";
import { fetchYahooXml } from "@/lib/yahoo-client";
import { parseFreeAgentPage } from "@/lib/yahoo";
import { injuryState, positionsOverlap } from "@/lib/injury-model";
import { parseDailyPlayerStats } from "@/lib/weekly-player-stats";
import type { FreeAgent, UpdateStatus } from "@/lib/types";

type Phase = "metadata" | "stats" | "returns" | "complete";
interface ScanState {
  scope: string; phase: Phase; offset: number; players: FreeAgent[];
  statsKeys: string[]; statsOffset: number; periodIndex: number;
  returnKeys: string[]; returnOffset: number; returnDay: number;
  playedDates: Record<string, string[]>; warnings: string[]; limited: boolean;
  updateStatus?: UpdateStatus;
}
export interface ScanOptions { leagueKey: string; gameKey: string; teamKey: string; observationDate: string; watchKeys: string[]; cursor?: string; forceRefresh: boolean }
const secret = () => getAuthConfig().sessionSecret;
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");
const encode = (state: ScanState) => {
  const payload = deflateSync(JSON.stringify({ expires: Date.now() + 10 * 60_000, state })).toString("base64url");
  return `${payload}.${sign(payload)}`;
};
function decode(cursor: string, scope: string): ScanState {
  try {
    if (cursor.length > 512_000) throw new Error();
    const [payload, signature, extra] = cursor.split(".");
    const expected = sign(payload), actual = Buffer.from(signature ?? "");
    if (extra || actual.length !== expected.length || !timingSafeEqual(actual, Buffer.from(expected))) throw new Error();
    const data = JSON.parse(inflateSync(Buffer.from(payload, "base64url"), { maxOutputLength: 2_000_000 }).toString());
    if (data.expires < Date.now() || data.state.scope !== scope) throw new Error();
    return data.state;
  } catch { throw new ValidationError("傷病掃描續載資料已過期或不符目前隊伍，請重新整理。"); }
}
const available = (player: FreeAgent) => player.availability === "free-agent" || player.availability === "waivers";

/** Signed, compressed continuation state travels in POST bodies, so cold starts need no sticky session. */
export async function scanInjuryPlayers(options: ScanOptions) {
  const { leagueKey, gameKey, teamKey, observationDate, watchKeys, cursor, forceRefresh } = options;
  const scope = `${leagueKey}:${gameKey}:${teamKey}:${observationDate}:${[...watchKeys].sort().join(",")}`;
  const state: ScanState = cursor ? decode(cursor, scope) : { scope, phase: "metadata", offset: 0, players: [], statsKeys: [], statsOffset: 0, periodIndex: 0, returnKeys: [], returnOffset: 0, returnDay: 0, playedDates: {}, warnings: [], limited: false };
  const ttl = getRuntimeConfig().cacheTtlSeconds;
  state.warnings = state.warnings.filter((warning) => warning !== "部分傷病來源暫時無法取得，可繼續載入未完成的批次。");
  const started = Date.now();
  let blocked = false;
  let calls = 0;
  const warn = (message: string) => { if (!state.warnings.includes(message)) state.warnings.push(message); state.limited = true; };
  async function load<T extends object>(key: string, producer: () => Promise<T>): Promise<T> {
    calls++;
    const data = await withUpdateStatus(() => withCache(key, ttl, producer, forceRefresh));
    if (data.stale) warn("部分傷病來源使用備援資料。");
    if (data.updateStatus) {
      const previous = state.updateStatus;
      state.updateStatus = { fetchedAt: previous && previous.fetchedAt < data.updateStatus.fetchedAt ? previous.fetchedAt : data.updateStatus.fetchedAt,
        nextRefreshAt: data.updateStatus.nextRefreshAt, stale: Boolean(previous?.stale || data.updateStatus.stale) };
    }
    return data.value;
  }
  while (state.phase !== "complete" && calls < 6 && Date.now() - started < 18_000) {
    try {
      if (state.phase === "metadata") {
        const page = await load(`injury-market:${leagueKey}:${observationDate}:${state.offset}`, async () => {
          const xml = await fetchYahooXml(`/league/${leagueKey}/players;start=${state.offset};count=25;out=metadata,ownership,percent_owned`);
          if (!findAll(parseXml(xml), "players").length) throw new Error("Missing Yahoo player collection");
          return { players: parseFreeAgentPage(xml, "unavailable") };
        });
        const seen = new Set(state.players.map((player) => player.playerKey));
        const fresh = page.players.filter((player) => !seen.has(player.playerKey));
        if (page.players.length && !fresh.length) {
          warn("Yahoo 球員分頁重複，無法確認已掃描全部球員。"); blocked = true; break;
        }
        if (fresh.length !== page.players.length) warn("球員分頁有重疊，完整性尚未確認。");
        state.players.push(...fresh);
        state.offset += 25;
        if (page.players.length < 25) {
          state.phase = "stats";
          const injured = state.players.filter((player) => ["out", "watch"].includes(injuryState(player.status ?? "")));
          state.statsKeys = state.players.filter((player) => injured.includes(player) || watchKeys.includes(player.playerKey)
            || (available(player) && injuryState(player.status ?? "") === "clear" && injured.some((star) => star.team === player.team && positionsOverlap(star.position, player.position))))
            .map((player) => player.playerKey);
          state.returnKeys = state.players.filter((player) => watchKeys.includes(player.playerKey) && injuryState(player.status ?? "") === "clear").map((player) => player.playerKey);
          if (state.players.some((player) => player.availability === "unknown")) warn("部分球員持有狀態未知，不會推定可取得。");
        }
      } else if (state.phase === "stats") {
        if (state.statsOffset >= state.statsKeys.length) { state.phase = "returns"; continue; }
        const keys = state.statsKeys.slice(state.statsOffset, state.statsOffset + 25);
        const period = (["lastweek", "lastmonth", "season"] as const)[state.periodIndex];
        const signature = createHash("sha256").update(keys.join(",")).digest("hex");
        const rows = await load(`injury-window:${gameKey}:${period}:${signature}`, async () => ({ players: parseFreeAgentPage(await fetchYahooXml(`/game/${gameKey}/players;player_keys=${keys.join(",")}/stats;type=${period}`), period) }));
        for (const key of keys) {
          const player = state.players.find((item) => item.playerKey === key)!;
          const stats = rows.players.find((item) => item.playerKey === key)?.stats;
          if (!stats || !Object.keys(stats).length) warn("部分球員統計未回傳，缺值不當作零。");
          player.statWindows = { ...player.statWindows, [period]: stats ?? {} };
        }
        if (++state.periodIndex === 3) { state.periodIndex = 0; state.statsOffset += keys.length; }
      } else {
        if (state.returnOffset >= state.returnKeys.length) { state.phase = "complete"; continue; }
        const keys = state.returnKeys.slice(state.returnOffset, state.returnOffset + 25);
        const day = new Date(Date.parse(observationDate) - state.returnDay * 86400000).toISOString().slice(0, 10);
        const signature = createHash("sha256").update(keys.join(",")).digest("hex");
        const rows = await load(`injury-played:${gameKey}:${day}:${signature}`, async () => ({ players: parseDailyPlayerStats(await fetchYahooXml(`/game/${gameKey}/players;player_keys=${keys.join(",")}/stats;type=date;date=${day}`), day) }));
        for (const player of rows.players) if (keys.includes(player.playerKey) && (player.stats["0"] ?? 0) > 0) state.playedDates[player.playerKey] = [...new Set([...(state.playedDates[player.playerKey] ?? []), day])];
        if (++state.returnDay === 7) { state.returnDay = 0; state.returnOffset += keys.length; }
      }
    } catch {
      // Preserve the exact page/window/day; the next request retries it using shared per-batch caches.
      state.warnings.push("部分傷病來源暫時無法取得，可繼續載入未完成的批次。");
      blocked = true;
      break;
    }
  }
  // Finishing the last data task should not require an extra request just to advance an empty phase.
  if (state.phase === "stats" && state.statsOffset >= state.statsKeys.length && !state.returnKeys.length) state.phase = "complete";
  if (state.phase === "returns" && state.returnOffset >= state.returnKeys.length) state.phase = "complete";
  return { players: state.players, playedDates: state.playedDates, warnings: state.warnings, limited: state.limited, updateStatus: state.updateStatus,
    scan: { phase: state.phase, blocked, complete: state.phase === "complete", playersScanned: state.players.length, statsProcessed: Math.min(state.statsOffset, state.statsKeys.length), statsTotal: state.statsKeys.length,
      cursor: state.phase === "complete" ? undefined : encode(state) } };
}
