"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  ChevronDown,
  CircleX,
  Clock3,
  RefreshCw,
  RotateCcw,
  Search,
  Target,
  UserPlus,
  Users,
} from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { buildDraftBoard } from "@/lib/draft-model";
import type {
  ApiErrorPayload,
  DraftCategoryMode,
  DraftDataResponse,
  DraftPlayer,
  DraftRanking,
  LeagueSummary,
} from "@/lib/types";

interface LeaguesResponse {
  leagues: LeagueSummary[];
  cached: boolean;
  demoMode: boolean;
}

interface ManualPick {
  playerKey: string;
  isMine: boolean;
  pickedAt: number;
}

interface SavedDraftState {
  manualPicks: ManualPick[];
  draftSlot: number;
  teamCount: number;
  categoryModes: Record<string, DraftCategoryMode>;
}

type RankingSort = "score" | "adp" | "fit" | "scarcity";

const requestJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  const payload = (await response.json()) as T & ApiErrorPayload;
  if (!response.ok) {
    const details = payload.details ? ` ${payload.details}` : "";
    throw Object.assign(new Error(`${payload.error || "Request failed."}${details}`), { status: response.status });
  }
  return payload;
};

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

const scoringLabel = (format: DraftDataResponse["configuration"]["scoringFormat"]) => ({
  "each-category": "H2H Each Category",
  "most-categories": "H2H Most Categories",
  rotisserie: "Rotisserie",
  points: "Points",
  unknown: "Category league",
})[format];

const sourceLabel = (data: DraftDataResponse) => data.projectionSource === "market-only"
  ? "Yahoo ADP only"
  : `${data.projectionSeason ?? "Prior"} actuals + Yahoo ADP`;

const confidenceDescription = (ranking: DraftRanking) => ranking.confidence === "Market"
  ? "Market confidence: ranked from Yahoo ADP because category history is unavailable."
  : `${ranking.confidence} confidence: based on ${ranking.player.gamesPlayed} historical games.`;

const modeOrder: DraftCategoryMode[] = ["target", "balanced", "punt"];

function PlayerIdentity({ player }: { player: DraftPlayer }) {
  return (
    <div className="player-cell draft-player-cell">
      <span className="player-avatar">{initials(player.name)}</span>
      <span>
        <strong>{player.name}</strong>
        <small>{player.team} · {player.position}</small>
      </span>
    </div>
  );
}

function DraftLoading() {
  return (
    <div className="draft-loading" aria-label="Loading draft assistant">
      {[0, 1, 2, 3, 4, 5].map((row) => <div key={row} className="skeleton-row" style={{ opacity: 1 - row * 0.1 }} />)}
    </div>
  );
}

export function DraftAssistant() {
  const router = useRouter();
  const requestNumber = useRef(0);
  const hydratedLeague = useRef("");
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [leagueKey, setLeagueKey] = useState("");
  const [data, setData] = useState<DraftDataResponse | null>(null);
  const [loadingLeagues, setLoadingLeagues] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [draftSlot, setDraftSlot] = useState(1);
  const [teamCount, setTeamCount] = useState(10);
  const [manualPicks, setManualPicks] = useState<ManualPick[]>([]);
  const [categoryModes, setCategoryModes] = useState<Record<string, DraftCategoryMode>>({});
  const [syncYahooPicks, setSyncYahooPicks] = useState(false);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [rankingSort, setRankingSort] = useState<RankingSort>("score");
  const [selectedPlayerKey, setSelectedPlayerKey] = useState("");

  const handleError = useCallback((requestError: unknown) => {
    const status = typeof requestError === "object" && requestError && "status" in requestError
      ? Number(requestError.status)
      : 0;
    if (status === 401) {
      router.replace("/login");
      router.refresh();
      return;
    }
    setError(requestError instanceof Error ? requestError.message : "The draft assistant could not load.");
  }, [router]);

  useEffect(() => {
    let active = true;
    requestJson<LeaguesResponse>("/api/leagues")
      .then((result) => {
        if (!active) return;
        setLeagues(result.leagues);
        setLeagueKey(result.leagues[0]?.leagueKey ?? "");
      })
      .catch(handleError)
      .finally(() => active && setLoadingLeagues(false));
    return () => { active = false; };
  }, [handleError]);

  const loadDraft = useCallback(async (forceRefresh = false) => {
    if (!leagueKey) return;
    const currentRequest = ++requestNumber.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ leagueKey });
      if (forceRefresh) params.set("forceRefresh", "true");
      const result = await requestJson<DraftDataResponse>(`/api/draft?${params}`);
      if (currentRequest !== requestNumber.current) return;
      setData(result);
      if (hydratedLeague.current !== leagueKey) {
        const savedText = window.localStorage.getItem(`draft-board:${leagueKey}`);
        let saved: Partial<SavedDraftState> = {};
        try {
          saved = savedText ? JSON.parse(savedText) as Partial<SavedDraftState> : {};
        } catch {
          window.localStorage.removeItem(`draft-board:${leagueKey}`);
        }
        setTeamCount(saved.teamCount ?? result.configuration.teamCount ?? result.league.teamCount ?? 10);
        setDraftSlot(saved.draftSlot ?? 1);
        setManualPicks(saved.manualPicks ?? []);
        setCategoryModes(saved.categoryModes ?? {});
        const draftStatus = (result.configuration.draftStatus ?? "").toLowerCase();
        setSyncYahooPicks(draftStatus.includes("drafting") || draftStatus.includes("inprogress"));
        hydratedLeague.current = leagueKey;
      }
    } catch (requestError) {
      if (currentRequest === requestNumber.current) handleError(requestError);
    } finally {
      if (currentRequest === requestNumber.current) setLoading(false);
    }
  }, [handleError, leagueKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDraft(false), 0);
    return () => window.clearTimeout(timer);
  }, [loadDraft]);

  useEffect(() => {
    if (!syncYahooPicks || !leagueKey) return;
    const timer = window.setInterval(() => void loadDraft(false), 20_000);
    return () => window.clearInterval(timer);
  }, [leagueKey, loadDraft, syncYahooPicks]);

  useEffect(() => {
    if (!leagueKey || !data) return;
    const saved: SavedDraftState = { manualPicks, draftSlot, teamCount, categoryModes };
    window.localStorage.setItem(`draft-board:${leagueKey}`, JSON.stringify(saved));
  }, [categoryModes, data, draftSlot, leagueKey, manualPicks, teamCount]);

  const playerByKey = useMemo(() => new Map(data?.players.map((player) => [player.playerKey, player]) ?? []), [data]);
  const yahooDrafted = useMemo(() => syncYahooPicks ? data?.draftResults ?? [] : [], [data, syncYahooPicks]);
  const yahooKeys = useMemo(() => new Set(yahooDrafted.map((result) => result.playerKey)), [yahooDrafted]);
  const effectiveManualPicks = useMemo(
    () => manualPicks.filter((pick) => !yahooKeys.has(pick.playerKey)),
    [manualPicks, yahooKeys],
  );
  const draftedKeys = useMemo(() => [
    ...yahooDrafted.map((result) => result.playerKey),
    ...effectiveManualPicks.map((pick) => pick.playerKey),
  ], [effectiveManualPicks, yahooDrafted]);
  const userKeys = useMemo(() => [
    ...yahooDrafted.filter((result) => result.teamKey === data?.league.userTeam.key).map((result) => result.playerKey),
    ...effectiveManualPicks.filter((pick) => pick.isMine).map((pick) => pick.playerKey),
  ], [data?.league.userTeam.key, effectiveManualPicks, yahooDrafted]);

  const board = useMemo(() => data ? buildDraftBoard({
    players: data.players,
    categories: data.configuration.categories,
    rosterPositions: data.configuration.rosterPositions,
    scoringFormat: data.configuration.scoringFormat,
    teamCount,
    draftSlot,
    draftedPlayerKeys: draftedKeys,
    userPlayerKeys: userKeys,
    categoryModes,
  }) : null, [categoryModes, data, draftSlot, draftedKeys, teamCount, userKeys]);

  const rankings = useMemo(() => {
    if (!board) return [];
    const filtered = board.rankings.filter((ranking) => {
      const matchesSearch = !search.trim() || `${ranking.player.name} ${ranking.player.team}`.toLowerCase().includes(search.trim().toLowerCase());
      const eligible = ranking.player.eligiblePositions.length
        ? ranking.player.eligiblePositions
        : ranking.player.position.split(",").map((item) => item.trim());
      return matchesSearch && (position === "ALL" || eligible.includes(position));
    });
    return [...filtered].sort((left, right) => {
      if (rankingSort === "adp") return (left.player.draftAnalysis.averagePick ?? 999) - (right.player.draftAnalysis.averagePick ?? 999);
      if (rankingSort === "fit") return right.teamFit - left.teamFit;
      if (rankingSort === "scarcity") return right.scarcity - left.scarcity;
      return right.score - left.score;
    });
  }, [board, position, rankingSort, search]);

  const myRoster = useMemo(() => userKeys.map((key) => playerByKey.get(key)).filter((player): player is DraftPlayer => Boolean(player)), [playerByKey, userKeys]);
  const selectedRanking = useMemo(
    () => board?.rankings.find((ranking) => ranking.player.playerKey === selectedPlayerKey) ?? board?.rankings[0],
    [board, selectedPlayerKey],
  );

  const recordPick = (playerKey: string, isMine: boolean) => {
    if (draftedKeys.includes(playerKey)) return;
    setManualPicks((picks) => [...picks, { playerKey, isMine, pickedAt: Date.now() }]);
    setSelectedPlayerKey("");
  };

  const undoLastPick = () => setManualPicks((picks) => picks.slice(0, -1));

  const setCategoryMode = (statId: string, mode: DraftCategoryMode) => {
    setCategoryModes((current) => ({ ...current, [statId]: mode }));
  };

  return (
    <main className="min-h-screen">
      <AppHeader demoMode={data?.demoMode} />
      <div className="workspace-shell draft-workspace">
        <section className="draft-control-bar" aria-label="Draft settings">
          <label className="control-group draft-league-control">
            <span className="control-label">League</span>
            <span className="select-wrap">
              <select value={leagueKey} onChange={(event) => { hydratedLeague.current = ""; setLeagueKey(event.target.value); setData(null); }} disabled={loadingLeagues}>
                {leagues.map((league) => <option key={league.leagueKey} value={league.leagueKey}>{league.name}</option>)}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </span>
          </label>
          <label className="control-group">
            <span className="control-label">Draft slot</span>
            <input className="draft-number-input" type="number" min={1} max={teamCount} value={draftSlot} onChange={(event) => setDraftSlot(Math.max(1, Math.min(teamCount, Number(event.target.value) || 1)))} />
          </label>
          <label className="control-group">
            <span className="control-label">Teams</span>
            <input className="draft-number-input" type="number" min={2} max={30} value={teamCount} onChange={(event) => setTeamCount(Math.max(2, Math.min(30, Number(event.target.value) || 10)))} />
          </label>
          <label className="control-group">
            <span className="control-label">Yahoo board</span>
            <span className="draft-toggle-row">
              <input type="checkbox" checked={syncYahooPicks} onChange={(event) => setSyncYahooPicks(event.target.checked)} />
              <span>{syncYahooPicks ? "Live sync" : "Mock mode"}</span>
            </span>
          </label>
          <button type="button" className="refresh-button" onClick={() => void loadDraft(true)} disabled={loading || !leagueKey}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
        </section>

        {error ? (
          <section className="error-banner" role="alert">
            <AlertCircle size={18} /><div><p className="font-semibold">Draft assistant unavailable</p><p className="mt-0.5 text-xs opacity-80">{error}</p></div>
          </section>
        ) : null}

        <section className="draft-summary-strip">
          <div className="draft-summary-title">
            <p className="eyebrow">Draft room</p>
            <h1>{data?.league.name ?? "Loading league"}</h1>
            <p>{data ? scoringLabel(data.configuration.scoringFormat) : "Reading Yahoo settings"}</p>
          </div>
          <div className="draft-clock">
            <span className={board?.picksUntilTurn === 0 ? "is-on-clock" : ""}><Clock3 size={16} /></span>
            <div><strong>{board?.picksUntilTurn === 0 ? "On the clock" : `${board?.picksUntilTurn ?? "--"} picks away`}</strong><small>Pick {board?.nextUserPick ?? "--"}</small></div>
          </div>
          <div className="draft-summary-metrics">
            <div><strong>{board?.currentPick ?? "--"}</strong><span>Overall pick</span></div>
            <div><strong>{board?.round ?? "--"}</strong><span>Round</span></div>
            <div><strong>{myRoster.length}/{data?.configuration.rosterPositions.reduce((sum, item) => sum + item.count, 0) || "--"}</strong><span>My roster</span></div>
            <div><strong>{data?.players.length ?? "--"}</strong><span>Player pool</span></div>
          </div>
          <div className={`projection-source ${data?.projectionSource === "market-only" ? "is-market" : ""}`}>
            <Check size={14} /><span>{data ? sourceLabel(data) : "Connecting"}</span>
          </div>
        </section>

        {data?.projectionSource === "market-only" ? (
          <div className="draft-data-warning"><AlertCircle size={15} />Category projections are unavailable. Rankings currently use Yahoo ADP, position scarcity, and turn timing.</div>
        ) : null}

        {!data && loading ? <DraftLoading /> : null}
        {data && board ? (
          <div className="draft-layout">
            <section className="draft-board-panel">
              <div className="draft-board-toolbar">
                <div>
                  <p className="eyebrow">Live ranking</p>
                  <h2>Best picks now</h2>
                  <p>{data.model.name} · {data.model.version}</p>
                </div>
                <div className="draft-board-filters">
                  <label className="draft-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search players" aria-label="Search players" /></label>
                  <span className="compact-select"><select value={position} onChange={(event) => setPosition(event.target.value)} aria-label="Position"><option value="ALL">All positions</option>{["PG", "SG", "SF", "PF", "C"].map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></span>
                  <span className="compact-select"><select value={rankingSort} onChange={(event) => setRankingSort(event.target.value as RankingSort)} aria-label="Sort ranking"><option value="score">Draft score</option><option value="adp">Yahoo ADP</option><option value="fit">Team fit</option><option value="scarcity">Scarcity</option></select><ChevronDown size={13} /></span>
                </div>
              </div>
              <div className="table-scroll draft-table-scroll">
                <table className="data-table draft-table">
                  <thead><tr><th>#</th><th>Player</th><th>ADP</th><th>Score</th><th>Confidence</th><th>Team fit</th><th>Scarcity</th><th>Next turn</th><th>Slot</th><th>Why</th><th>Pick</th></tr></thead>
                  <tbody>
                    {rankings.map((ranking, index) => (
                      <tr key={ranking.player.playerKey} className={selectedRanking?.player.playerKey === ranking.player.playerKey ? "selected-draft-row" : ""} onClick={() => setSelectedPlayerKey(ranking.player.playerKey)}>
                        <td><span className={`rank-number ${index < 3 ? "top" : ""}`}>{index + 1}</span></td>
                        <td><PlayerIdentity player={ranking.player} /></td>
                        <td className="numeric-strong">{ranking.player.draftAnalysis.averagePick?.toFixed(1) ?? ranking.player.yahooRank ?? "--"}</td>
                        <td><strong className="draft-score">{ranking.score.toFixed(1)}</strong></td>
                        <td><span className={`draft-confidence-chip ${ranking.confidence.toLowerCase()}`} title={confidenceDescription(ranking)}>{ranking.confidence}</span></td>
                        <td><FeatureMeter value={ranking.teamFit} /></td>
                        <td><FeatureMeter value={ranking.scarcity} /></td>
                        <td>{ranking.availabilityNextTurn === null ? <span className="dash">--</span> : <span className={ranking.availabilityNextTurn < 35 ? "return-risk" : "return-safe"}>{ranking.availabilityNextTurn}%</span>}</td>
                        <td><span className="slot-chip">{ranking.recommendedSlot}</span></td>
                        <td className="draft-reason-cell">{ranking.reasons.slice(0, 2).map((reason) => <span key={reason}>{reason}</span>)}</td>
                        <td>
                          <div className="draft-row-actions" onClick={(event) => event.stopPropagation()}>
                            <button type="button" title="Draft to my team" aria-label={`Draft ${ranking.player.name} to my team`} onClick={() => recordPick(ranking.player.playerKey, true)}><UserPlus size={14} /></button>
                            <button type="button" title="Mark as taken" aria-label={`Mark ${ranking.player.name} as taken`} onClick={() => recordPick(ranking.player.playerKey, false)}><CircleX size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rankings.length ? <div className="empty-state"><Users size={22} /><p className="mt-3 text-sm font-semibold text-[#30343a]">No players match this view</p></div> : null}
              </div>
            </section>

            <aside className="draft-side-panel">
              {selectedRanking ? <PlayerDetail ranking={selectedRanking} onMine={() => recordPick(selectedRanking.player.playerKey, true)} onTaken={() => recordPick(selectedRanking.player.playerKey, false)} /> : null}
              <section className="draft-side-section">
                <div className="draft-side-heading"><div><p className="eyebrow">Build</p><h3>Category plan</h3></div>{board.inferredPunts.length ? <span className="inferred-badge">Auto punt: {board.inferredPunts.join(", ")}</span> : null}</div>
                <div className="category-plan-list">
                  {board.teamProfile.map((category) => (
                    <div className="category-plan-row" key={category.statId}>
                      <div><strong>{category.displayName}</strong><small>{myRoster.length ? `${category.percentile}th percentile` : "No picks yet"}</small></div>
                      <div className="category-mode-control" aria-label={`${category.displayName} strategy`}>
                        {modeOrder.map((mode) => <button key={mode} type="button" className={category.mode === mode ? "active" : ""} onClick={() => setCategoryMode(category.statId, mode)} title={`${mode} ${category.displayName}`}>{mode === "target" ? <Target size={11} /> : mode === "punt" ? "P" : "B"}</button>)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <section className="draft-side-section">
                <div className="draft-side-heading"><div><p className="eyebrow">Roster</p><h3>My team</h3></div><span>{myRoster.length} picks</span></div>
                <div className="my-roster-list">
                  {myRoster.map((player, index) => <div key={player.playerKey}><span>{index + 1}</span><PlayerIdentity player={player} /></div>)}
                  {!myRoster.length ? <p className="side-empty">No players selected.</p> : null}
                </div>
              </section>
              <section className="draft-side-section draft-history-section">
                <div className="draft-side-heading"><div><p className="eyebrow">Board</p><h3>Recent picks</h3></div><button className="undo-button" type="button" onClick={undoLastPick} disabled={!manualPicks.length} title="Undo last manual pick"><RotateCcw size={13} />Undo</button></div>
                <div className="draft-history-list">
                  {[...yahooDrafted.map((result) => ({ playerKey: result.playerKey, isMine: result.teamKey === data.league.userTeam.key, pick: result.pick })), ...effectiveManualPicks.map((pick, index) => ({ ...pick, pick: yahooDrafted.length + index + 1 }))].slice(-8).reverse().map((pick) => (
                    <div key={`${pick.pick}-${pick.playerKey}`}><span>#{pick.pick}</span><strong>{playerByKey.get(pick.playerKey)?.name ?? pick.playerKey}</strong>{pick.isMine ? <small>Mine</small> : null}</div>
                  ))}
                  {!draftedKeys.length ? <p className="side-empty">Waiting for pick 1.</p> : null}
                </div>
              </section>
            </aside>
          </div>
        ) : null}
        {loading && data ? <div className="draft-syncing"><RefreshCw size={14} className="animate-spin" />Syncing Yahoo</div> : null}
      </div>
    </main>
  );
}

function FeatureMeter({ value }: { value: number }) {
  return <span className="feature-meter"><i style={{ width: `${Math.max(4, Math.min(100, value))}%` }} /><small>{value.toFixed(0)}</small></span>;
}

function PlayerDetail({ ranking, onMine, onTaken }: { ranking: DraftRanking; onMine: () => void; onTaken: () => void }) {
  return (
    <section className="draft-player-detail">
      <div className="draft-detail-top"><PlayerIdentity player={ranking.player} /><strong>{ranking.score.toFixed(1)}</strong></div>
      <div className="draft-detail-metrics"><div><span>ADP</span><strong>{ranking.player.draftAnalysis.averagePick?.toFixed(1) ?? "--"}</strong></div><div><span>Fit</span><strong>{ranking.teamFit.toFixed(0)}</strong></div><div><span>Return</span><strong>{ranking.availabilityNextTurn === null ? "--" : `${ranking.availabilityNextTurn}%`}</strong></div><div><span>Confidence</span><strong className={`draft-detail-confidence ${ranking.confidence.toLowerCase()}`} title={confidenceDescription(ranking)}>{ranking.confidence}</strong></div></div>
      <div className="draft-category-chips">{ranking.categoryScores.slice(0, 5).map((category) => <span key={category.statId} className={category.zScore >= 0 ? "positive" : "negative"}>{category.displayName} {category.zScore > 0 ? "+" : ""}{category.zScore.toFixed(1)}z</span>)}</div>
      {ranking.watchouts.length ? <div className="draft-watchouts">{ranking.watchouts.map((watchout) => <span key={watchout}>{watchout}</span>)}</div> : null}
      <div className="draft-detail-actions"><button type="button" className="primary-button" onClick={onMine}><UserPlus size={14} />Draft</button><button type="button" className="secondary-button" onClick={onTaken}><CircleX size={14} />Taken</button></div>
    </section>
  );
}
