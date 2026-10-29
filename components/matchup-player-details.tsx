"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { PlayerAvatar } from "@/components/player-avatar";
import { RefreshControl, UpdateNotice } from "@/components/refresh-control";
import type { MatchupPlayersResponse } from "@/lib/types";

interface Props { leagueKey: string; week: number; matchupId: string; selectedTeamKey: string; refreshVersion: number; ready?: boolean }
export function MatchupPlayerDetails(props: Props) {
  const identity = `${props.leagueKey}:${props.week}:${props.matchupId}`;
  // A keyed body clears old data immediately without losing the expanded preference.
  const [expanded, setExpanded] = useState(false);
  return <section className="weekly-player-details">
    <button type="button" className="weekly-player-toggle" aria-expanded={expanded} aria-controls="weekly-player-content" onClick={() => setExpanded((value) => !value)}>
      <span>球員當週數據</span><span aria-hidden="true">{expanded ? "−" : "+"}</span>
    </button>
    {expanded ? props.ready === false ? <p id="weekly-player-content" className="weekly-player-period" role="status">請等待對戰資料載入完成。</p> : <DetailsBody key={identity} {...props} /> : null}
  </section>;
}
function DetailsBody({ leagueKey, week, matchupId, selectedTeamKey, refreshVersion }: Props) {
  const [data, setData] = useState<MatchupPlayersResponse | null>(null);
  const [error, setError] = useState("");
  const [settledKey, setSettledKey] = useState("");
  const [retry, setRetry] = useState(0);
  const requestKey = `${refreshVersion}:${retry}`;
  const loading = settledKey !== requestKey;
  const [teamKey, setTeamKey] = useState(selectedTeamKey);
  const [sort, setSort] = useState({ id: "name", ascending: true });
  const priorRefresh = useRef(refreshVersion);
  useEffect(() => {
    const abort = new AbortController();
    const force = priorRefresh.current !== refreshVersion || retry > 0;
    priorRefresh.current = refreshVersion;
    const params = new URLSearchParams({ leagueKey, week: String(week), matchupId });
    if (force) params.set("forceRefresh", "true");
    fetch(`/api/matchup-players?${params}`, { signal: abort.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "球員數據暫時無法取得，請稍後重試。");
        return payload as MatchupPlayersResponse;
      }).then((result) => {
        if (abort.signal.aborted) return;
        setData(result); setError("");
      }).catch((reason) => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "球員數據無法取得。"); })
      .finally(() => { if (!abort.signal.aborted) setSettledKey(`${refreshVersion}:${retry}`); });
    return () => abort.abort();
  }, [leagueKey, week, matchupId, refreshVersion, retry]);
  const team = data?.teams.find((item) => item.teamKey === teamKey) ?? data?.teams.find((item) => item.teamKey === selectedTeamKey) ?? data?.teams[0];
  const players = [...(team?.players ?? [])].sort((a, b) => {
    if (sort.id === "name") return (sort.ascending ? 1 : -1) * a.name.localeCompare(b.name);
    const left = a.stats[sort.id], right = b.stats[sort.id];
    if (left == null) return right == null ? a.name.localeCompare(b.name) : 1;
    if (right == null) return -1;
    return (sort.ascending ? 1 : -1) * (left - right);
  });
  const categories = data ? [{ statId: "0", displayName: "GP", name: "Games Played" }, ...data.categories.filter((item) => item.statId !== "0")] : [];
  const changeSort = (id: string) => setSort((current) => ({ id, ascending: current.id === id ? !current.ascending : id === "name" }));
  const format = (id: string, value: number | null | undefined) => value == null ? "—" : ["5", "8", "11"].includes(id) ? `${(value * 100).toFixed(1)}%` : Number.isInteger(value) ? String(value) : value.toFixed(2);
  return <div id="weekly-player-content" className="weekly-player-content" aria-busy={loading}>
    <p className="inline-notice">該 Fantasy 球隊的當週計分貢獻：只計入球員當天在此隊且排在有效先發位置的 NBA 成績。交易後在別隊、板凳及 IL 日期均不計入。</p>
    {data ? <p className="weekly-player-period">Week {week} · {data.startDate} – {data.endDate} · 已統計至 {data.throughDate ?? "尚未開始"}（Yahoo 太平洋時間）{data.demoMode ? " · Demo 示範數據" : ""}</p> : null}
    {loading ? <p className="weekly-player-period" role="status">正在取得每日陣容與球員成績，首次載入可能較久…</p> : null}
    {error ? <p className="status-error" role="alert">{error}</p> : null}
    <div className="weekly-player-toolbar">
      <div role="tablist" aria-label="對戰球隊" className="tab-bar">
        {data?.teams.map((item) => <button key={item.teamKey} role="tab" aria-selected={team?.teamKey === item.teamKey} className={team?.teamKey === item.teamKey ? "active" : ""} onClick={() => setTeamKey(item.teamKey)}>{item.name}</button>)}
      </div>
      <RefreshControl loading={loading} disabled={!matchupId} status={data?.updateStatus} onRefresh={() => { setRetry((value) => value + 1); }} />
    </div>
    <UpdateNotice status={data?.updateStatus} />
    {data?.status === "not-started" ? <p className="weekly-player-period">此週尚未開始，尚無球員數據。</p> : null}
    {data?.status === "partial" ? <p className="inline-notice warning">資料不完整：數字僅累計已確認在此隊先發計分的日期；缺少名單、先發位置或數據時，不推測歸屬，尚不代表完整貢獻；「*」是部分日期的比率，「—」表示未取得數據。未將缺值補成零，球員名單也可能不完整。</p> : null}
    {team?.scoreboardCheck?.status === "matched" ? <p className="weekly-player-period">已取得完整數據的分類合計與 Yahoo 球隊週報比分一致。</p> : null}
    {team?.scoreboardCheck?.status === "different" ? <p className="inline-notice warning">球員合計與 Yahoo 球隊週報尚未一致（{team.scoreboardCheck.differences.map((item) => item.displayName).join("、")}），可能有即時更新或數據更正；以 Yahoo 官方比分為準，本站不會調整球員數字湊比分。</p> : null}
    {team?.missingRosterDates.length ? <p className="weekly-player-period">缺少陣容日期：{team.missingRosterDates.join(", ")}</p> : null}
    {team && data?.status !== "not-started" ? <div className="table-scroll">
      <table className="data-table weekly-player-table" aria-label={`${team.name} 球員週數據`}>
        <thead><tr><th><button className="sort-button" onClick={() => changeSort("name")}>Player</button></th><th>NBA</th><th>Position</th>{categories.map((category) => <th key={category.statId} aria-sort={sort.id === category.statId ? sort.ascending ? "ascending" : "descending" : "none"}><button className="sort-button" onClick={() => changeSort(category.statId)}>{category.displayName}{sort.id === category.statId ? sort.ascending ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}</button></th>)}</tr></thead>
        <tbody>{players.map((player) => <tr key={player.playerKey}>
          <td><div className="player-cell"><PlayerAvatar name={player.name} headshotUrl={player.headshotUrl} /><span><strong>{player.name}</strong>{player.scoringDates ? <details><summary>計分陣容日期（{player.scoringDates.length} 天）</summary><small>{player.scoringDates.join(", ") || "此週沒有已確認的先發計分日期"}</small></details> : null}{player.missingDates.length ? <small>缺值日期：{player.missingDates.join(", ")}</small> : null}</span></div></td>
          <td>{player.team || "—"}</td><td>{player.position || "—"}</td>{categories.map((category) => <td key={category.statId}>{format(category.statId, player.stats[category.statId])}{player.stats[category.statId] != null && player.incompleteStats?.includes(category.statId) && ["5", "8", "11", "20"].includes(category.statId) ? <><span>*</span></> : ""}</td>)}
        </tr>)}</tbody>
      </table>
      {!players.length ? <p className="weekly-player-period">此隊暫無可用球員資料。</p> : null}
    </div> : null}
  </div>;
}
