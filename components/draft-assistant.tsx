"use client";
import { HelpTip } from "@/components/help-tip";

import { RefreshControl, UpdateNotice } from "@/components/refresh-control";
import { PlayerAvatar } from "@/components/player-avatar";
import { ArenaIntro } from "@/components/arena-intro";

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
  DraftMode,
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
  teamKey?: string;
  cost?: number;
  pickedAt: number;
}

interface SavedDraftState {
  version: 2;
  manualPicks: ManualPick[];
  draftSlot: number;
  teamCount: number;
  draftMode: DraftMode;
  auctionBudget: number;
  categoryModes: Record<string, DraftCategoryMode>;
}

type RankingSort = "score" | "adp" | "fit" | "scarcity";

const requestJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  const payload = (await response.json()) as T & ApiErrorPayload;
  if (!response.ok) {
    throw Object.assign(new Error(payload.error || "Request failed."), { status: response.status });
  }
  return payload;
};

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

const draftStateKey = (leagueKey: string, season: number, draftMode: DraftMode) => `draft-board:v2:${leagueKey}:${season}:${draftMode}`;

const modeOrder: DraftCategoryMode[] = ["target", "balanced", "punt"];

function PlayerIdentity({ player, avatarSize = 32 }: { player: DraftPlayer; avatarSize?: number }) {
  return (
    <div className="player-cell draft-player-cell">
      <PlayerAvatar name={player.name} headshotUrl={player.headshotUrl} size={avatarSize} />
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
  const skipNextSave = useRef(false);
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [leagueKey, setLeagueKey] = useState("");
  const [data, setData] = useState<DraftDataResponse | null>(null);
  const [loadingLeagues, setLoadingLeagues] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [draftSlot, setDraftSlot] = useState(1);
  const [teamCount, setTeamCount] = useState(10);
  const [draftMode, setDraftMode] = useState<DraftMode>("snake");
  const [auctionBudget, setAuctionBudget] = useState(200);
  const [manualPicks, setManualPicks] = useState<ManualPick[]>([]);
  const [categoryModes, setCategoryModes] = useState<Record<string, DraftCategoryMode>>({});
  const [syncYahooPicks, setSyncYahooPicks] = useState(false);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [rankingSort, setRankingSort] = useState<RankingSort>("score");
  const [selectedPlayerKey, setSelectedPlayerKey] = useState("");
  const [pickDialog, setPickDialog] = useState<{ playerKey: string; teamKey: string; cost: number } | null>(null);

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
        if (!result.leagues.length) setError("No leagues are available for this login.");
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
      if (!hydratedLeague.current.startsWith(`${leagueKey}:`)) {
        setTeamCount(result.configuration.teamCount ?? result.league.teamCount ?? 10);
        setDraftMode(result.draftMode === "unknown" ? "snake" : result.draftMode);
        setAuctionBudget(result.auction.defaultBudget);
        const draftStatus = (result.configuration.draftStatus ?? "").toLowerCase();
        setSyncYahooPicks(draftStatus.includes("drafting") || draftStatus.includes("inprogress"));
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
    const key = draftStateKey(leagueKey, data.league.season, draftMode);
    if (hydratedLeague.current === `${leagueKey}:${key}`) return;
    let saved: Partial<SavedDraftState> = {};
    try {
      const savedText = window.localStorage.getItem(key) ?? window.localStorage.getItem(`draft-board:${leagueKey}`);
      saved = savedText ? JSON.parse(savedText) as Partial<SavedDraftState> : {};
    } catch {
      window.localStorage.removeItem(key);
    }
    setTeamCount(saved.teamCount ?? data.configuration.teamCount ?? data.league.teamCount ?? 10);
    setDraftSlot(saved.draftSlot ?? 1);
    setManualPicks(saved.manualPicks ?? []);
    setCategoryModes(saved.categoryModes ?? {});
    setAuctionBudget(saved.auctionBudget ?? data.auction.defaultBudget);
    skipNextSave.current = true;
    hydratedLeague.current = `${leagueKey}:${key}`;
  }, [data, draftMode, leagueKey]);

  useEffect(() => {
    if (!leagueKey || !data || !hydratedLeague.current) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const saved: SavedDraftState = { version: 2, manualPicks, draftSlot, teamCount, draftMode, auctionBudget, categoryModes };
    window.localStorage.setItem(draftStateKey(leagueKey, data.league.season, draftMode), JSON.stringify(saved));
  }, [auctionBudget, categoryModes, data, draftMode, draftSlot, leagueKey, manualPicks, teamCount]);

  const playerByKey = useMemo(() => new Map(data?.players.map((player) => [player.playerKey, player]) ?? []), [data]);
  const userTeamKey = data?.league.userTeam.key ?? "";
  const yahooDrafted = useMemo(() => syncYahooPicks ? [...(data?.draftResults ?? [])].sort((left, right) => left.pick - right.pick) : [], [data, syncYahooPicks]);
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
    ...yahooDrafted.filter((result) => result.teamKey === userTeamKey).map((result) => result.playerKey),
    ...effectiveManualPicks.filter((pick) => pick.teamKey ? pick.teamKey === userTeamKey : pick.isMine).map((pick) => pick.playerKey),
  ], [effectiveManualPicks, userTeamKey, yahooDrafted]);
  const userSpent = useMemo(() => (
    yahooDrafted.filter((pick) => pick.teamKey === userTeamKey).reduce((sum, pick) => sum + (pick.cost ?? 0), 0)
    + effectiveManualPicks.filter((pick) => pick.teamKey ? pick.teamKey === userTeamKey : pick.isMine).reduce((sum, pick) => sum + (pick.cost ?? 0), 0)
  ), [effectiveManualPicks, userTeamKey, yahooDrafted]);
  const auctionMarket = useMemo(() => {
    const picks = [...yahooDrafted, ...effectiveManualPicks];
    return {
      spent: picks.reduce((sum, pick) => sum + (pick.cost ?? 0), 0),
      expected: picks.reduce((sum, pick) => sum + (playerByKey.get(pick.playerKey)?.draftAnalysis.averageCost ?? pick.cost ?? 0), 0),
    };
  }, [effectiveManualPicks, playerByKey, yahooDrafted]);

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
    draftMode,
    auctionBudget,
    userSpent,
    auctionSpent: auctionMarket.spent,
    auctionExpectedSpent: auctionMarket.expected,
  }) : null, [auctionBudget, auctionMarket.expected, auctionMarket.spent, categoryModes, data, draftMode, draftSlot, draftedKeys, teamCount, userKeys, userSpent]);

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
  const teamBudgets = useMemo(() => (data?.draftTeams ?? []).map((team) => {
    const yahoo = yahooDrafted.filter((pick) => pick.teamKey === team.key);
    const manual = effectiveManualPicks.filter((pick) => pick.teamKey === team.key || (!pick.teamKey && pick.isMine && team.key === data?.league.userTeam.key));
    const spent = [...yahoo, ...manual].reduce((sum, pick) => sum + (pick.cost ?? 0), 0);
    const picks = yahoo.length + manual.length;
    const rosterSize = data?.configuration.rosterPositions.reduce((sum, item) => sum + item.count, 0) ?? 13;
    const reserve = Math.max(0, rosterSize - picks - 1);
    return { ...team, spent, remaining: auctionBudget - spent, maxBid: Math.max(1, auctionBudget - spent - reserve) };
  }), [auctionBudget, data, effectiveManualPicks, yahooDrafted]);

  const recordPick = (playerKey: string, isMine: boolean) => {
    if (draftedKeys.includes(playerKey) || syncYahooPicks) return;
    if (draftMode === "salary-cap" && data) {
      const suggested = board?.rankings.find((ranking) => ranking.player.playerKey === playerKey)?.recommendedPrice ?? 1;
      const otherTeam = data.draftTeams.find((team) => team.key !== data.league.userTeam.key)?.key ?? data.league.userTeam.key;
      setPickDialog({ playerKey, teamKey: isMine ? data.league.userTeam.key : otherTeam, cost: suggested });
      return;
    }
    setManualPicks((picks) => [...picks, { playerKey, isMine, teamKey: isMine ? data?.league.userTeam.key : undefined, pickedAt: Date.now() }]);
    setSelectedPlayerKey("");
  };

  const confirmAuctionPick = () => {
    if (!pickDialog || !data) return;
    setManualPicks((picks) => [...picks, {
      playerKey: pickDialog.playerKey,
      teamKey: pickDialog.teamKey,
      isMine: pickDialog.teamKey === data.league.userTeam.key,
      cost: Math.max(1, Math.round(pickDialog.cost)),
      pickedAt: Date.now(),
    }]);
    setPickDialog(null);
    setSelectedPlayerKey("");
  };

  const undoLastPick = () => setManualPicks((picks) => picks.slice(0, -1));

  const resetDraft = () => {
    if (data) window.localStorage.removeItem(draftStateKey(leagueKey, data.league.season, draftMode));
    setManualPicks([]);
    setCategoryModes({});
    setDraftSlot(1);
    setTeamCount(data?.configuration.teamCount ?? data?.league.teamCount ?? 10);
    setAuctionBudget(data?.auction.defaultBudget ?? 200);
  };

  const setCategoryMode = (statId: string, mode: DraftCategoryMode) => {
    setCategoryModes((current) => ({ ...current, [statId]: mode }));
  };

  return (
    <main className="min-h-screen">
      <AppHeader demoMode={data?.demoMode} />
      <div className="workspace-shell draft-workspace">
        <ArenaIntro draft />
        <section className="draft-control-bar" aria-label="Draft settings">
          <div className="control-group draft-league-control">
            <div className="control-label"><label htmlFor="draft-control-1">League</label></div>
            <span className="select-wrap">
              <select id="draft-control-1" aria-label="League" value={leagueKey} onChange={(event) => { hydratedLeague.current = ""; setLeagueKey(event.target.value); setData(null); }} disabled={loadingLeagues}>
                {leagues.map((league) => <option key={league.leagueKey} value={league.leagueKey}>{league.name}</option>)}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </span>
          </div>
          <div className="control-group">
            <div className="control-label"><label htmlFor="draft-control-2">Draft slot</label></div>
            <input id="draft-control-2" aria-label="Draft slot" className="draft-number-input" type="number" min={1} max={teamCount} value={draftSlot} onChange={(event) => setDraftSlot(Math.max(1, Math.min(teamCount, Number(event.target.value) || 1)))} />
          </div>
          <div className="control-group">
            <div className="control-label"><label htmlFor="draft-control-3">Teams</label></div>
            <input id="draft-control-3" aria-label="Teams" className="draft-number-input" type="number" min={2} max={30} value={teamCount} onChange={(event) => setTeamCount(Math.max(2, Math.min(30, Number(event.target.value) || 10)))} />
          </div>
          <div className="control-group">
            <div className="control-label"><label htmlFor="draft-control-4">Draft mode</label></div>
            <span className="select-wrap"><select id="draft-control-4" aria-label="Draft mode" value={draftMode} disabled={syncYahooPicks} onChange={(event) => setDraftMode(event.target.value as DraftMode)}><option value="snake">Snake</option><option value="linear">Linear</option><option value="salary-cap">Salary Cap</option><option value="offline">Offline</option></select><ChevronDown size={15} /></span>
          </div>
          {draftMode === "salary-cap" ? <div className="control-group"><div className="control-label"><label htmlFor="draft-control-5">Budget</label></div><input id="draft-control-5" aria-label="Auction budget" className="draft-number-input" type="number" min={20} max={1000} value={auctionBudget} onChange={(event) => setAuctionBudget(Math.max(20, Number(event.target.value) || 200))} /></div> : null}
          <div className="control-group">
            <div className="control-label"><label htmlFor="draft-control-6">Yahoo board</label></div>
            <span className="draft-toggle-row">
              <input id="draft-control-6" aria-label="Yahoo board synchronization" type="checkbox" checked={syncYahooPicks} onChange={(event) => { const checked = event.target.checked; setSyncYahooPicks(checked); if (checked && data?.draftMode !== "unknown") setDraftMode(data?.draftMode ?? "snake"); }} />
              <span className="draft-toggle-visual" aria-hidden="true"><span /></span>
              <span>{syncYahooPicks ? "Live sync" : "Mock mode"}</span>
            </span>
          </div>
          <RefreshControl status={data?.league.leagueKey === leagueKey ? data.updateStatus : undefined} loading={loading} disabled={!leagueKey} onRefresh={() => void loadDraft(true)} />
          <button type="button" className="icon-command" onClick={resetDraft} title="Reset mock draft" aria-label="Reset mock draft" disabled={syncYahooPicks}><RotateCcw size={16} /></button>
        </section>

        <UpdateNotice status={data?.league.leagueKey === leagueKey ? data.updateStatus : undefined} />

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
            <div><strong>{draftMode === "salary-cap" ? `$${Math.max(0, auctionBudget - userSpent)} left` : board?.picksUntilTurn === 0 ? "On the clock" : `${board?.picksUntilTurn ?? "--"} picks away`}</strong><small>{draftMode === "salary-cap" ? `$${userSpent} spent` : `Pick ${board?.nextUserPick ?? "--"}`}</small></div>
          </div>
          <div className="draft-summary-metrics">
            <div><strong>{board?.currentPick ?? "--"}</strong><span>Overall pick</span></div>
            <div><strong>{board?.round ?? "--"}</strong><span>Round</span></div>
            <div><strong>{myRoster.length}/{data?.configuration.rosterPositions.reduce((sum, item) => sum + item.count, 0) || "--"}</strong><span>My roster</span></div>
            <div><strong>{data ? data.players.length - draftedKeys.length : "--"}</strong><span>Remaining</span></div>
          </div>
          <div className={`projection-source ${data?.projectionSource === "market-only" ? "is-market" : ""}`}>
            <Check size={14} /><span>{data ? `${sourceLabel(data)} · ${data.sync.status}${data.sync.lastSuccessfulAt ? ` ${new Date(data.sync.lastSuccessfulAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}` : "Connecting"}</span>
          </div>
        </section>

        {data?.projectionSource === "market-only" ? (
          <div className="draft-data-warning"><AlertCircle size={15} />Category projections are unavailable. Rankings currently use Yahoo ADP, position scarcity, and turn timing.</div>
        ) : null}
        {data && syncYahooPicks && data.sync.status !== "live" ? <div className="draft-data-warning"><AlertCircle size={15} />{data.sync.message ?? "Yahoo live sync is stale."}</div> : null}
        {syncYahooPicks ? <div className="inline-notice">Live mode uses Yahoo pick ordering. Manual board controls are locked.</div> : null}

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
                  <thead><tr><th>#</th><th>Player</th><th>ADP</th><th>Score<HelpTip topic="draftScore" label="Score" /></th><th>Confidence<HelpTip topic="confidence" label="Confidence" /></th><th>Team fit<HelpTip topic="fit" label="Team fit" /></th><th>Scarcity<HelpTip topic="scarcity" label="Scarcity" /></th>{draftMode === "salary-cap" ? <><th>AAV</th><th>Price<HelpTip topic="price" label="Price" /></th><th>Value<HelpTip topic="price" label="Value" /></th><th>Max bid<HelpTip topic="price" label="Max bid" /></th></> : <th>Estimated return<HelpTip topic="estimatedReturn" label="Estimated return" /></th>}<th>Slot<HelpTip topic="modelSlot" label="Slot" /></th><th>Why<HelpTip topic="modelWhy" label="Why" /></th><th>Pick</th></tr></thead>
                  <tbody>
                    {rankings.map((ranking, index) => (
                      <tr key={ranking.player.playerKey} tabIndex={0} aria-selected={selectedRanking?.player.playerKey === ranking.player.playerKey} className={selectedRanking?.player.playerKey === ranking.player.playerKey ? "selected-draft-row" : ""} onClick={() => setSelectedPlayerKey(ranking.player.playerKey)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedPlayerKey(ranking.player.playerKey); } }}>
                        <td><span className={`rank-number ${index < 3 ? "top" : ""}`}>{index + 1}</span></td>
                        <td><PlayerIdentity player={ranking.player} /></td>
                        <td className="numeric-strong">{ranking.player.draftAnalysis.averagePick?.toFixed(1) ?? ranking.player.yahooRank ?? "--"}{ranking.player.draftAnalysis.averagePick === null && ranking.player.yahooRank !== null ? <small className="adp-proxy">Yahoo rank 代理，非 ADP</small> : null}</td>
                        <td><strong className="draft-score">{ranking.score.toFixed(1)}</strong></td>
                        <td><details className="info-popover confidence-popover"><summary className={`draft-confidence-chip ${ranking.confidence.toLowerCase()}`}>{ranking.confidence} {ranking.confidenceScore}</summary><div>{ranking.confidenceReasons.map((reason) => <span key={reason}>{reason}</span>)}</div></details></td>
                        <td><FeatureMeter value={ranking.teamFit} /></td>
                        <td><FeatureMeter value={ranking.scarcity} /></td>
                        {draftMode === "salary-cap" ? <><td>${ranking.player.draftAnalysis.averageCost?.toFixed(0) ?? "--"}</td><td className="numeric-strong">${ranking.recommendedPrice ?? "--"}</td><td className={(ranking.auctionValue ?? 0) >= 0 ? "score-positive" : "score-negative"}>{ranking.auctionValue === null ? "--" : `${ranking.auctionValue >= 0 ? "+" : ""}$${ranking.auctionValue}`}</td><td>${ranking.maxBid ?? "--"}</td></> : <td>{ranking.estimatedReturn === null ? <span className="dash">--</span> : <span className={ranking.estimatedReturn < 35 ? "return-risk" : "return-safe"}>{ranking.estimatedReturn}%</span>}</td>}
                        <td><span className="slot-chip">{ranking.recommendedSlot}</span></td>
                        <td className="draft-reason-cell">{ranking.reasons.slice(0, 2).map((reason) => <span key={reason}>{reason}</span>)}</td>
                        <td>
                          <div className="draft-row-actions" onClick={(event) => event.stopPropagation()}>
                            <button type="button" title="Draft to my team" aria-label={`Draft ${ranking.player.name} to my team`} disabled={syncYahooPicks} onClick={() => recordPick(ranking.player.playerKey, true)}><UserPlus size={14} /></button>
                            <button type="button" title="Mark as taken" aria-label={`Mark ${ranking.player.name} as taken`} disabled={syncYahooPicks} onClick={() => recordPick(ranking.player.playerKey, false)}><CircleX size={14} /></button>
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
              {selectedRanking ? <PlayerDetail ranking={selectedRanking} draftMode={draftMode} disabled={syncYahooPicks} onMine={() => recordPick(selectedRanking.player.playerKey, true)} onTaken={() => recordPick(selectedRanking.player.playerKey, false)} /> : null}
              {draftMode === "salary-cap" ? <section className="draft-side-section"><div className="draft-side-heading"><div><p className="eyebrow">Budgets</p><h3>League bankroll</h3></div><span>${auctionBudget} cap</span></div><div className="budget-list">{teamBudgets.map((team) => <div key={team.key}><strong>{team.name}</strong><span>${team.remaining} left · max ${team.maxBid}</span></div>)}</div></section> : null}
              <section className="draft-side-section">
                <div className="draft-side-heading"><div><p className="eyebrow">Build</p><h3>Category plan<HelpTip topic="categoryProfile" /></h3></div>{board.inferredPunts.length ? <span className="inferred-badge">Auto punt: {board.inferredPunts.join(", ")}</span> : null}</div>
                <div className="category-plan-list">
                  {board.teamProfile.map((category) => (
                    <div className="category-plan-row" key={category.statId}>
                      <div><strong>{category.displayName}</strong><small>{myRoster.length ? `${category.percentile}th percentile` : "No picks yet"}</small></div>
                      <div className="category-mode-control" role="radiogroup" aria-label={`${category.displayName} strategy`}>
                        {modeOrder.map((mode) => <button key={mode} type="button" role="radio" aria-checked={category.mode === mode} className={category.mode === mode ? "active" : ""} onClick={() => setCategoryMode(category.statId, mode)} title={`${mode} ${category.displayName}`}>{mode === "target" ? <Target size={11} /> : mode === "punt" ? "P" : "B"}</button>)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <section className="draft-side-section">
                <div className="draft-side-heading"><div><p className="eyebrow">Roster</p><h3>My team</h3></div><span>{myRoster.length} picks</span></div>
                <div className="my-roster-list">
                  {myRoster.map((player, index) => <div key={player.playerKey}><span>{index + 1}</span><PlayerIdentity player={player} avatarSize={26} /></div>)}
                  {!myRoster.length ? <p className="side-empty">No players selected.</p> : null}
                </div>
              </section>
              <section className="draft-side-section draft-history-section">
                <div className="draft-side-heading"><div><p className="eyebrow">Board</p><h3>Recent picks</h3></div><button className="undo-button" type="button" onClick={undoLastPick} disabled={syncYahooPicks || !manualPicks.length} title="Undo last manual pick"><RotateCcw size={13} />Undo</button></div>
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
        {pickDialog && data ? <div className="modal-backdrop" role="presentation" onMouseDown={() => setPickDialog(null)}><section className="pick-dialog" role="dialog" aria-modal="true" aria-labelledby="pick-dialog-title" onMouseDown={(event) => event.stopPropagation()}><div><p className="eyebrow">Auction result</p><h2 id="pick-dialog-title">Record {playerByKey.get(pickDialog.playerKey)?.name ?? "player"}</h2></div><label>Team<select value={pickDialog.teamKey} onChange={(event) => setPickDialog((current) => current ? { ...current, teamKey: event.target.value } : null)}>{data.draftTeams.map((team) => <option key={team.key} value={team.key}>{team.name}</option>)}</select></label><label>Winning bid<input type="number" min={1} max={auctionBudget} value={pickDialog.cost} onChange={(event) => setPickDialog((current) => current ? { ...current, cost: Math.max(1, Number(event.target.value) || 1) } : null)} /></label><div className="pick-dialog-actions"><button type="button" className="secondary-button" onClick={() => setPickDialog(null)}>Cancel</button><button type="button" className="primary-button" onClick={confirmAuctionPick}>Record pick</button></div></section></div> : null}
      </div>
    </main>
  );
}

function FeatureMeter({ value }: { value: number }) {
  return <span className="feature-meter"><i style={{ width: `${Math.max(4, Math.min(100, value))}%` }} /><small>{value.toFixed(0)}</small></span>;
}

function PlayerDetail({ ranking, draftMode, disabled, onMine, onTaken }: { ranking: DraftRanking; draftMode: DraftMode; disabled: boolean; onMine: () => void; onTaken: () => void }) {
  return (
    <section className="draft-player-detail">
      <div className="draft-detail-top"><PlayerIdentity player={ranking.player} /><strong>{ranking.score.toFixed(1)}<HelpTip topic="draftScore" /></strong></div>
      <div className="draft-detail-metrics"><div><span>ADP</span><strong>{ranking.player.draftAnalysis.averagePick?.toFixed(1) ?? "--"}</strong></div><div><span>Fit<HelpTip topic="fit" /></span><strong>{ranking.teamFit.toFixed(0)}</strong></div><div><span>{draftMode === "salary-cap" ? "Price" : "Return"}<HelpTip topic={draftMode === "salary-cap" ? "price" : "estimatedReturn"} /></span><strong>{draftMode === "salary-cap" ? `$${ranking.recommendedPrice ?? "--"}` : ranking.estimatedReturn === null ? "--" : `${ranking.estimatedReturn}%`}</strong></div><div><span>Confidence<HelpTip topic="confidence" /></span><details className="info-popover confidence-popover"><summary className={`draft-detail-confidence ${ranking.confidence.toLowerCase()}`}>{ranking.confidence} {ranking.confidenceScore}</summary><div>{ranking.confidenceReasons.map((reason) => <span key={reason}>{reason}</span>)}</div></details></div></div>
      <div className="draft-category-chips"><HelpTip topic="zScore" />{ranking.categoryScores.slice(0, 5).map((category) => <span key={category.statId} className={category.zScore >= 0 ? "positive" : "negative"}>{category.displayName} {category.zScore > 0 ? "+" : ""}{category.zScore.toFixed(1)}z</span>)}</div>
      {ranking.watchouts.length ? <div className="draft-watchouts"><HelpTip topic="helps" />{ranking.watchouts.map((watchout) => <span key={watchout}>{watchout}</span>)}</div> : null}
      <div className="draft-detail-actions"><button type="button" className="primary-button" disabled={disabled} onClick={onMine}><UserPlus size={14} />Draft</button><button type="button" className="secondary-button" disabled={disabled} onClick={onTaken}><CircleX size={14} />Taken</button></div>
    </section>
  );
}
