"use client";
import { useEffect, useRef, useState } from "react";
import { PlayerAvatar } from "@/components/player-avatar";
import { RefreshControl, UpdateNotice } from "@/components/refresh-control";
import { applyInjurySnapshot, emptyInjuryHistory, sanitizeInjuryHistory } from "@/lib/injury-model";
import type { InjuryHistory, InjuryOpportunity, InjuryResponse, ReturnAlert } from "@/lib/injury-types";

interface Props { leagueKey: string; teamKey: string; week: number; date: string; timeZone: string; refreshVersion: number }
export const injuryStorageKey = (leagueKey: string, teamKey: string) => `fantasy-injury:v2:${leagueKey}:${teamKey}`;
function readHistory(key: string, fallback: InjuryHistory) {
  try { const raw = localStorage.getItem(key); return raw ? sanitizeInjuryHistory(JSON.parse(raw)) : fallback; }
  catch { return fallback; }
}
export function InjuryAdvice(props: Props) {
  const element = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let active = true;
    if (typeof IntersectionObserver === "undefined") { queueMicrotask(() => { if (active) setVisible(true); }); return () => { active = false; }; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    });
    if (element.current) observer.observe(element.current);
    return () => { active = false; observer.disconnect(); };
  }, []);
  return <section ref={element} className="injury-advice" aria-label="傷病機會與復出提醒">
    <div className="panel-heading"><div><p className="eyebrow">Injury & rotation watch</p><h2>傷病機會與復出提醒</h2><p>以 Yahoo 狀態與上場時間推估短期機會，請自行決定是否調整陣容。</p></div></div>
    {visible ? <AdviceBody key={`${props.leagueKey}:${props.teamKey}:${props.week}:${props.date}:${props.timeZone}`} {...props} /> : <p className="injury-message">進入此區後載入傷病建議。</p>}
  </section>;
}
function AdviceBody({ leagueKey, teamKey, week, date, timeZone, refreshVersion }: Props) {
  const [view, setView] = useState<{ data: InjuryResponse; history: InjuryHistory; alerts: ReturnAlert[] } | null>(null);
  const [error, setError] = useState("");
  const [storageFailed, setStorageFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [settled, setSettled] = useState("");
  const requestKey = `${refreshVersion}:${retry}`;
  const loading = requestKey !== settled;
  const history = useRef(emptyInjuryHistory());
  const previousRefresh = useRef(refreshVersion);
  const key = injuryStorageKey(leagueKey, teamKey);
  useEffect(() => {
    const controller = new AbortController();
    const previous = readHistory(key, history.current);
    history.current = previous;
    const watch = [...new Set(previous.observations.map((entry) => entry.injuredKey))].filter((id) => /^[a-zA-Z0-9-]+\.p\.\d+$/.test(id)).slice(0, 50);
    const params = new URLSearchParams({ leagueKey, teamKey, week: String(week), date, timeZone });
    if (watch.length) params.set("watch", watch.join(","));
    if (previousRefresh.current !== refreshVersion || retry > 0) params.set("forceRefresh", "true");
    previousRefresh.current = refreshVersion;
    fetch(`/api/injury-advice?${params}`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "傷病資料暫時無法取得。");
      if (data.leagueKey !== leagueKey || data.teamKey !== teamKey) throw new Error("傷病資料不屬於目前隊伍，請重試。");
      return data as InjuryResponse;
    }).then((data) => {
      if (controller.signal.aborted) return;
      const updated = applyInjurySnapshot(readHistory(key, history.current), data);
      history.current = updated.history;
      try { localStorage.removeItem(key.replace("fantasy-injury:v2:", "fantasy-injury:v1:")); localStorage.setItem(key, JSON.stringify(updated.history)); setStorageFailed(false); }
      catch { setStorageFailed(true); }
      setView({ data, ...updated }); setError("");
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "傷病資料暫時無法取得。"); })
      .finally(() => { if (!controller.signal.aborted) setSettled(`${refreshVersion}:${retry}`); });
    return () => controller.abort();
  }, [leagueKey, teamKey, week, date, timeZone, refreshVersion, retry, key]);
  const dismiss = (id: string) => {
    if (!view) return;
    const updated = readHistory(key, history.current);
    for (const entry of updated.observations) if (`${entry.id}:${entry.episodeAt}` === id) entry.dismissed = true;
    history.current = updated;
    try { localStorage.setItem(key, JSON.stringify(updated)); } catch { setStorageFailed(true); }
    setView({ ...view, history: updated, alerts: view.alerts.filter((alert) => alert.id !== id) });
  };
  const data = view?.data;
  const players = new Map(data?.players.map((player) => [player.playerKey, player]));
  const minutes = (value: number | null) => value === null ? "資料不足" : `${value.toFixed(1)} 分鐘`;
  return <div className="injury-body" aria-busy={loading}>
    <div className="injury-toolbar"><p className="injury-message">{data?.demoMode ? "Demo 示範資料 · " : ""}僅提供本站提醒；更換裝置或清除瀏覽器資料後，可能無法辨識先前傷病。觀察紀錄保留 30 天。</p>
      <RefreshControl label="Refresh injury advice" status={data?.updateStatus} loading={loading} disabled={false} onRefresh={() => setRetry((value) => value + 1)} /></div>
    {loading ? <p role="status" className="injury-message">正在查詢傷病與輪替資料，不影響下方推薦名單…</p> : null}
    {error ? <p role="alert" className="status-error">{error}</p> : null}
    {storageFailed ? <p className="inline-notice warning">此瀏覽器無法保存觀察紀錄，復出提醒與忽略設定可能在離開後遺失。</p> : null}
    <UpdateNotice status={data?.updateStatus} />
    {data?.warnings.map((warning) => <p key={warning} className="inline-notice warning">{warning}</p>)}
    {data && data.status !== "historical" ? <>
      <h3 className="injury-section-title">精選補人</h3>
      <div className="injury-card-grid">{data.opportunities.map((item) => <OpportunityCard key={item.id} item={item} players={players} />)}</div>
      {!data.opportunities.length ? <p className="injury-message">目前沒有符合嚴格門檻的精選替補，不代表需要補人。{Object.entries(data.exclusionCounts).map(([reason, count]) => `${reason}（${count}）；`).join("")}</p> : null}
      <details className="injury-watchlist">
        <summary>觀察名單（{data.watchlist.length}）</summary>
        <p className="injury-message">傷病待確認、正向增幅樣本不足或來源受限，暫不列為精選；觀察名單不建立新的復出追蹤。</p>
        <div className="injury-card-grid">{data.watchlist.map((item) => <OpportunityCard key={item.id} item={item} players={players} />)}</div>
        {!data.watchlist.length ? <p className="injury-message">目前沒有符合條件的觀察候選。</p> : null}
      </details>
      <h3 className="injury-section-title">考慮釋出／重新評估</h3>
      {!loading && !error ? <div className="injury-card-grid">{view?.alerts.map((alert) => <article key={alert.id} className="injury-card injury-return-card">
        <p className="eyebrow">{alert.confirmed ? "已恢復出賽" : "傷病標記解除，可能復出（待確認）"}</p>
        <p className="injury-relationship">{alert.injured.name} → 重新評估 {alert.beneficiary.name}</p>
        <div className="player-cell"><PlayerAvatar name={alert.beneficiary.name} headshotUrl={alert.beneficiary.headshotUrl} /><span><strong>{alert.beneficiary.name}</strong><small>仍在你目前選中的隊伍陣容</small></span></div>
        <p className="injury-evidence">{alert.roleDeclined ? `替補近期時間已下降：觀察時 ${minutes(alert.previousMinutes)} → 現在 ${minutes(alert.currentMinutes)}／場（近 7 天至少 3 場）。` : "回歸球員可能壓縮輪替；目前尚未確認替補時間下降，不代表必須丟棄。"}</p>
        <p className="injury-evidence">{alert.confirmed ? `傷病觀察後出賽日期：${alert.playedAfterInjury.join(", ")}` : "僅有標記解除，尚無傷病觀察後的每日出賽證據。"}</p>
        <p className="injury-evidence">可信程度：{alert.confirmed && alert.roleDeclined ? "中（仍需評估長期價值）" : "低"} · 請對照下方分類補強價值再決定。</p>
        <button type="button" className="row-action" onClick={() => dismiss(alert.id)}>忽略此提醒</button>
      </article>)}</div> : null}
      {!loading && !error && !view?.alerts.length ? <p className="injury-message">目前沒有可確認的復出釋出提醒。此功能需要先前觀察紀錄，且資料必須完整、新鮮。</p> : null}
      <p className="injury-message">觀察時間：{new Date(data.updateStatus?.fetchedAt ?? data.generatedAt).toLocaleString()}。規則尚未經回測驗證，不會自動加人或丟人。</p>
    </> : null}
  </div>;
}

function OpportunityCard({ item, players }: { item: InjuryOpportunity; players: Map<string, InjuryResponse["players"][number]> }) {
  const backup = players.get(item.beneficiaryKey);
  if (!backup) return null;
  const reasons = {
    "rotation-gain": "近期輪替受益（相關性推估）",
    "unconfirmed-absence": "傷病觀察，尚未確認缺陣",
    "small-sample": "上場時間有正向變化，但出賽樣本不足",
    "limited-data": "來源不完整或使用備援資料，暫列觀察",
  };
  return <article className="injury-card">
    <p className="eyebrow">{item.group === "featured" ? "精選補人" : "觀察候選"} · {item.relatedInjuries.map((entry) => players.get(entry.playerKey)?.status).filter(Boolean).join("／")}</p>
    <p className="injury-relationship">{item.relatedInjuries.map((entry) => players.get(entry.playerKey)?.name ?? entry.playerKey).join("、")} → {backup.name}</p>
    <div className="player-cell"><PlayerAvatar name={backup.name} headshotUrl={backup.headshotUrl} /><span><strong>{backup.name}</strong><small>{backup.team} · {backup.position}</small></span></div>
    <p className="injury-evidence">{reasons[item.reason]}</p>
    {item.relatedInjuries.map((entry) => <p key={entry.playerKey} className="injury-evidence">傷員基準：{players.get(entry.playerKey)?.name} · {entry.period === "lastmonth" ? "近 30 天" : "賽季"} {entry.games} 場、{entry.minutes.toFixed(1)} 分鐘／場（平均時間代理，非已確認傷前健康期）。</p>)}
    <p className="injury-evidence">近 7 天：{backup.weekMinutes?.toFixed(1) ?? "—"} 分鐘／場（{backup.weekGames ?? "—"} 場）；近 30 天：{backup.monthMinutes?.toFixed(1) ?? "—"} 分鐘／場（{backup.monthGames ?? "—"} 場）；變化 +{item.minutesDelta.toFixed(1)} 分鐘。</p>
    <div className="tag-list"><span className="watch-tag">可信程度：{item.group === "featured" ? "中・規則推估" : "低"}</span>{item.helps.map((help) => <span key={help} className="help-tag">{help}</span>)}</div>
    <p className="injury-evidence">目前推薦分數 {item.score.toFixed(2)}；沿用所選聯盟與隊伍的推薦需求排序。</p>
  </article>;
}
