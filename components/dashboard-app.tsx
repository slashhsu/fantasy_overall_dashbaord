"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  LogOut,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Trophy,
} from "lucide-react";
import type {
  ApiErrorPayload,
  DashboardResponse,
  LeagueSummary,
  Matchup,
  MatchupCategoryRow,
  Recommendation,
} from "@/lib/types";

type Tab = "recommendations" | "report" | "matchups" | "raw";
type SortKey = "score" | "name" | "team" | keyof Recommendation["projections"];

interface LeaguesResponse {
  leagues: LeagueSummary[];
  cached: boolean;
  demoMode: boolean;
}

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "recommendations", label: "Recommendations" },
  { id: "report", label: "Weekly Report" },
  { id: "matchups", label: "Matchups" },
  { id: "raw", label: "Raw Data" },
];

const today = () => new Date().toISOString().slice(0, 10);

const requestJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const payload = (await response.json()) as T & ApiErrorPayload;
  if (!response.ok) {
    const details = payload.details ? ` ${payload.details}` : "";
    throw Object.assign(new Error(`${payload.error || "Request failed."}${details}`), {
      status: response.status,
    });
  }
  return payload;
};

const matchupLabel = (matchup: Matchup) => `${matchup.teamA.name} vs ${matchup.teamB.name}`;

const resultClass = (side: MatchupCategoryRow["side"]) => {
  if (side === "Win") return "result-win";
  if (side === "Lose") return "result-lose";
  if (side === "Draw") return "result-draw";
  return "result-neutral";
};

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

const formatUpdatedAt = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <Search size={22} aria-hidden="true" />
      <p className="mt-3 text-sm font-semibold text-[#30343a]">{title}</p>
      <p className="mt-1 text-xs leading-5 text-[#747b85]">{detail}</p>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="p-5" aria-label="Loading dashboard">
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="skeleton-row" style={{ opacity: 1 - row * 0.11 }} />
      ))}
    </div>
  );
}

export function DashboardApp() {
  const router = useRouter();
  const requestNumber = useRef(0);
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [leagueKey, setLeagueKey] = useState("");
  const [week, setWeek] = useState(1);
  const [targetDate, setTargetDate] = useState(today);
  const [matchupId, setMatchupId] = useState("");
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("recommendations");
  const [loadingLeagues, setLoadingLeagues] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const selectedLeague = useMemo(
    () => leagues.find((league) => league.leagueKey === leagueKey),
    [leagueKey, leagues],
  );

  const handleRequestError = useCallback((requestError: unknown) => {
    const status = typeof requestError === "object" && requestError && "status" in requestError
      ? Number(requestError.status)
      : 0;
    if (status === 401) {
      router.replace("/login");
      router.refresh();
      return;
    }
    setError(requestError instanceof Error ? requestError.message : "The dashboard could not load.");
  }, [router]);

  useEffect(() => {
    let active = true;
    requestJson<LeaguesResponse>("/api/leagues")
      .then((result) => {
        if (!active) return;
        setLeagues(result.leagues);
        if (result.leagues[0]) {
          setLeagueKey(result.leagues[0].leagueKey);
          setWeek(result.leagues[0].currentWeek);
        }
      })
      .catch(handleRequestError)
      .finally(() => active && setLoadingLeagues(false));
    return () => { active = false; };
  }, [handleRequestError]);

  const loadDashboard = useCallback(async (forceRefresh = false, requestedMatchupId?: string) => {
    if (!leagueKey || !week || !targetDate) return;
    const currentRequest = ++requestNumber.current;
    setLoadingDashboard(true);
    setError("");
    const params = new URLSearchParams({
      leagueKey,
      week: String(week),
      date: targetDate,
    });
    const nextMatchupId = requestedMatchupId ?? matchupId;
    if (nextMatchupId) params.set("matchupId", nextMatchupId);
    if (forceRefresh) params.set("forceRefresh", "true");
    try {
      const result = await requestJson<DashboardResponse>(`/api/dashboard?${params}`);
      if (currentRequest !== requestNumber.current) return;
      setDashboard(result);
      setMatchupId(result.selectedMatchupId);
    } catch (requestError) {
      if (currentRequest === requestNumber.current) handleRequestError(requestError);
    } finally {
      if (currentRequest === requestNumber.current) setLoadingDashboard(false);
    }
  }, [handleRequestError, leagueKey, matchupId, targetDate, week]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (leagueKey && week) void loadDashboard(false, matchupId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [leagueKey, loadDashboard, matchupId, targetDate, week]);

  const chooseLeague = (nextLeagueKey: string) => {
    const nextLeague = leagues.find((league) => league.leagueKey === nextLeagueKey);
    setLeagueKey(nextLeagueKey);
    setWeek(nextLeague?.currentWeek ?? 1);
    setMatchupId("");
    setDashboard(null);
  };

  const chooseMatchup = (nextMatchupId: string) => {
    setMatchupId(nextMatchupId);
  };

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  const sortedRecommendations = useMemo(() => {
    if (!dashboard) return [];
    const valueFor = (item: Recommendation) => {
      if (sortKey in item.projections) return item.projections[sortKey as keyof Recommendation["projections"]];
      return item[sortKey as "score" | "name" | "team"];
    };
    return [...dashboard.recommendations].sort((left, right) => {
      const a = valueFor(left);
      const b = valueFor(right);
      const comparison = typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b));
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [dashboard, sortDirection, sortKey]);

  const setSort = (key: SortKey) => {
    if (sortKey === key) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDirection(key === "name" || key === "team" ? "asc" : "desc");
    }
  };

  const summary = useMemo(() => {
    const needs = dashboard?.categoryNeeds ?? [];
    return {
      wins: needs.filter((row) => row.side === "Win").length,
      losses: needs.filter((row) => row.side === "Lose").length,
      close: needs.filter((row) => row.priorityWeight >= 2.75).length,
    };
  }, [dashboard]);

  return (
    <main className="min-h-screen">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand-lockup">
            <span className="brand-icon"><Trophy size={17} aria-hidden="true" /></span>
            <div>
              <p className="brand-title">Fantasy Basketball Desk</p>
              <p className="brand-subtitle">Yahoo weekly intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {dashboard?.demoMode ? <span className="demo-badge">Demo data</span> : null}
            <button className="icon-button" onClick={logout} title="Sign out" aria-label="Sign out">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </header>

      <div className="workspace-shell">
        <section className="control-bar" aria-label="Dashboard filters">
          <label className="control-group control-league">
            <span className="control-label">League</span>
            <span className="select-wrap">
              <select
                aria-label="League"
                value={leagueKey}
                onChange={(event) => chooseLeague(event.target.value)}
                disabled={loadingLeagues || !leagues.length}
              >
                {leagues.map((league) => (
                  <option key={league.leagueKey} value={league.leagueKey}>{league.name}</option>
                ))}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </span>
          </label>

          <div className="control-group">
            <span className="control-label">Week</span>
            <div className="stepper" aria-label="Week selector">
              <button
                type="button"
                title="Previous week"
                aria-label="Previous week"
                onClick={() => setWeek((value) => Math.max(selectedLeague?.startWeek ?? 1, value - 1))}
                disabled={!selectedLeague || week <= selectedLeague.startWeek}
              ><Minus size={14} /></button>
              <span>Week {week}</span>
              <button
                type="button"
                title="Next week"
                aria-label="Next week"
                onClick={() => setWeek((value) => Math.min(selectedLeague?.endWeek ?? 24, value + 1))}
                disabled={!selectedLeague || week >= selectedLeague.endWeek}
              ><Plus size={14} /></button>
            </div>
          </div>

          <label className="control-group">
            <span className="control-label">Streaming date</span>
            <span className="date-wrap">
              <CalendarDays size={15} aria-hidden="true" />
              <input
                aria-label="Streaming date"
                type="date"
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
              />
            </span>
          </label>

          <label className="control-group control-matchup">
            <span className="control-label">Matchup</span>
            <span className="select-wrap">
              <select
                aria-label="Matchup"
                value={matchupId}
                onChange={(event) => chooseMatchup(event.target.value)}
                disabled={!dashboard?.matchups.length}
              >
                {(dashboard?.matchups ?? []).map((matchup) => (
                  <option key={matchup.id} value={matchup.id}>{matchupLabel(matchup)}</option>
                ))}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </span>
          </label>

          <button
            type="button"
            className="refresh-button"
            onClick={() => void loadDashboard(true)}
            disabled={loadingDashboard || !leagueKey}
          >
            <RefreshCw size={16} className={loadingDashboard ? "animate-spin" : ""} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </section>

        {error ? (
          <section className="error-banner" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <div><p className="font-semibold">Dashboard unavailable</p><p className="mt-0.5 text-xs opacity-80">{error}</p></div>
          </section>
        ) : null}

        <section className="summary-strip" aria-label="Matchup summary">
          <div className="summary-primary">
            <p className="eyebrow">Selected team</p>
            <h1>{dashboard?.selectedTeamName ?? selectedLeague?.userTeam.name ?? "Loading league"}</h1>
            <p className="summary-opponent">
              {dashboard ? `vs ${dashboard.opponentName}` : "Preparing your weekly report"}
            </p>
          </div>
          <div className="summary-metrics">
            <div><span className="metric-value text-[#18845e]">{dashboard ? summary.wins : "--"}</span><span className="metric-label">Winning</span></div>
            <div><span className="metric-value text-[#c94e43]">{dashboard ? summary.losses : "--"}</span><span className="metric-label">Behind</span></div>
            <div><span className="metric-value text-[#2878d0]">{dashboard ? summary.close : "--"}</span><span className="metric-label">In play</span></div>
            <div><span className="metric-value">{dashboard?.recommendations.length ?? "--"}</span><span className="metric-label">Streams</span></div>
          </div>
          <div className="summary-status">
            {dashboard ? <CheckCircle2 size={16} className="text-[#18845e]" /> : <Clock3 size={16} />}
            <span>{dashboard ? `${dashboard.cached ? "Cached" : "Live"} at ${formatUpdatedAt(dashboard.generatedAt)}` : "Connecting"}</span>
          </div>
        </section>

        <nav className="tab-bar" aria-label="Dashboard views">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
              aria-current={activeTab === tab.id ? "page" : undefined}
            >{tab.label}</button>
          ))}
        </nav>

        <section className="content-panel">
          {loadingDashboard && !dashboard ? <LoadingRows /> : null}
          {!loadingDashboard && !dashboard && !error ? (
            <EmptyState title="No dashboard data yet" detail="Choose a league to load its current matchup." />
          ) : null}
          {dashboard && activeTab === "recommendations" ? (
            <RecommendationsView
              dashboard={dashboard}
              recommendations={sortedRecommendations}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={setSort}
            />
          ) : null}
          {dashboard && activeTab === "report" ? <WeeklyReportView dashboard={dashboard} /> : null}
          {dashboard && activeTab === "matchups" ? <MatchupsView dashboard={dashboard} onChoose={chooseMatchup} /> : null}
          {dashboard && activeTab === "raw" ? <RawDataView dashboard={dashboard} /> : null}
          {loadingDashboard && dashboard ? <div className="panel-loading"><RefreshCw size={16} className="animate-spin" /> Updating</div> : null}
        </section>
      </div>
    </main>
  );
}

interface RecommendationsViewProps {
  dashboard: DashboardResponse;
  recommendations: Recommendation[];
  sortKey: SortKey;
  sortDirection: "asc" | "desc";
  onSort: (key: SortKey) => void;
}

function SortButton({ label, column, active, direction, onSort }: {
  label: string;
  column: SortKey;
  active: boolean;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  return (
    <button type="button" className="sort-button" onClick={() => onSort(column)}>
      {label}
      {active ? (direction === "desc" ? <ArrowDown size={12} /> : <ArrowUp size={12} />) : null}
    </button>
  );
}

function RecommendationsView({ dashboard, recommendations, sortKey, sortDirection, onSort }: RecommendationsViewProps) {
  const scheduleAvailable = dashboard.schedule.status === "available";
  const gameDay = scheduleAvailable && dashboard.teamsPlaying.length > 0;
  const scheduleLabel = !scheduleAvailable
    ? "Schedule unavailable"
    : gameDay
      ? `${dashboard.teamsPlaying.length} NBA teams play`
      : "No NBA games scheduled";
  const scheduleSource = dashboard.schedule.source
    ? `Schedule source: ${dashboard.schedule.source === "balldontlie" ? "BALLDONTLIE" : dashboard.schedule.source.toUpperCase()}`
    : undefined;
  const emptyDetail = !scheduleAvailable
    ? "Yahoo returned no available players to rank."
    : gameDay
      ? "No available player has a game on the selected date."
      : "There are no NBA games on the selected date.";
  return (
    <>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Daily waiver board</p>
          <h2>Best available players</h2>
          <p>{dashboard.freeAgentCount} available players analyzed against the selected matchup.</p>
        </div>
        <div
          className={!scheduleAvailable ? "schedule-status is-unavailable" : gameDay ? "schedule-status is-live" : "schedule-status"}
          title={scheduleSource}
        >
          <CalendarDays size={15} />
          <span>{scheduleLabel}</span>
        </div>
      </div>
      {!recommendations.length ? (
        <EmptyState title="No eligible streamers" detail={emptyDetail} />
      ) : (
        <div className="table-scroll">
          <table className="data-table recommendation-table">
            <thead>
              <tr>
                <th className="rank-column">#</th>
                <th><SortButton label="Player" column="name" active={sortKey === "name"} direction={sortDirection} onSort={onSort} /></th>
                <th><SortButton label="Team" column="team" active={sortKey === "team"} direction={sortDirection} onSort={onSort} /></th>
                <th>Game</th>
                <th><SortButton label="Score" column="score" active={sortKey === "score"} direction={sortDirection} onSort={onSort} /></th>
                <th className="reason-column">Helps</th>
                <th className="reason-column">Watch</th>
                {(["pts", "reb", "ast", "stl", "blk", "threePm", "turnovers"] as const).map((key) => (
                  <th key={key}><SortButton label={{ pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK", threePm: "3PM", turnovers: "TO" }[key]} column={key} active={sortKey === key} direction={sortDirection} onSort={onSort} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recommendations.map((player, index) => (
                <tr key={player.playerKey}>
                  <td className="rank-column"><span className={index < 3 ? "rank-number top" : "rank-number"}>{index + 1}</span></td>
                  <td>
                    <div className="player-cell">
                      <span className="player-avatar">{initials(player.name)}</span>
                      <span><strong>{player.name}</strong><small>{player.position} · {player.period === "lastmonth" ? "Last 30 days" : player.period === "lastweek" ? "Last 7 days" : "Season"}</small></span>
                    </div>
                  </td>
                  <td><span className="team-code">{player.team}</span></td>
                  <td>{!scheduleAvailable ? <span className="muted-chip">Unknown</span> : player.gameToday ? <span className="game-chip"><span /> Plays</span> : <span className="muted-chip">Off</span>}</td>
                  <td><span className={player.score >= 0 ? "score-positive" : "score-negative"}>{player.score.toFixed(2)}</span></td>
                  <td className="reason-column"><div className="tag-list">{player.reason.length ? player.reason.map((reason) => <span className="help-tag" key={reason}>{reason}</span>) : <span className="dash">--</span>}</div></td>
                  <td className="reason-column"><div className="tag-list">{player.watchouts.length ? player.watchouts.map((watchout) => <span className="watch-tag" key={watchout}>{watchout}</span>) : <span className="dash">--</span>}</div></td>
                  <td>{player.projections.pts.toFixed(1)}</td>
                  <td>{player.projections.reb.toFixed(1)}</td>
                  <td>{player.projections.ast.toFixed(1)}</td>
                  <td>{player.projections.stl.toFixed(1)}</td>
                  <td>{player.projections.blk.toFixed(1)}</td>
                  <td>{player.projections.threePm.toFixed(1)}</td>
                  <td>{player.projections.turnovers.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function WeeklyReportView({ dashboard }: { dashboard: DashboardResponse }) {
  return (
    <>
      <div className="panel-heading">
        <div><p className="eyebrow">Week {dashboard.week}</p><h2>{dashboard.selectedTeamName} vs {dashboard.opponentName}</h2><p>Categories are ranked by how much a free-agent pickup can matter.</p></div>
        <span className="need-legend"><span /> Higher priority</span>
      </div>
      <div className="table-scroll">
        <table className="data-table report-table">
          <thead><tr><th>Category</th><th>{dashboard.selectedTeamName}</th><th>{dashboard.opponentName}</th><th>Result</th><th>Priority</th><th>Direction</th></tr></thead>
          <tbody>
            {dashboard.categoryNeeds.map((row) => (
              <tr key={row.statId}>
                <td><strong>{row.displayName}</strong><small className="category-long-name">{row.category}</small></td>
                <td className="numeric-strong">{row.teamRawValue || "--"}</td>
                <td>{row.opponentRawValue || "--"}</td>
                <td><span className={`result-pill ${resultClass(row.side)}`}>{row.result}</span></td>
                <td><div className="priority-cell"><span className="priority-track"><span style={{ width: `${Math.min(100, row.priorityWeight / 4 * 100)}%` }} /></span><strong>{row.priorityWeight.toFixed(2)}</strong></div></td>
                <td className="text-xs text-[#747b85]">{row.lowerIsBetter ? "Lower wins" : "Higher wins"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MatchupsView({ dashboard, onChoose }: { dashboard: DashboardResponse; onChoose: (id: string) => void }) {
  return (
    <>
      <div className="panel-heading"><div><p className="eyebrow">League scoreboard</p><h2>All week {dashboard.week} matchups</h2><p>Select any matchup to recalculate the category board.</p></div></div>
      <div className="table-scroll">
        <table className="data-table matchup-table">
          <thead><tr><th>Matchup</th>{dashboard.categories.filter((category) => category.enabled).map((category) => <th key={category.statId}>{category.displayName}</th>)}<th></th></tr></thead>
          <tbody>
            {dashboard.matchups.map((matchup) => (
              <tr key={matchup.id} className={matchup.id === dashboard.selectedMatchupId ? "selected-row" : ""}>
                <td><strong>{matchup.teamA.name}</strong><small>vs {matchup.teamB.name}</small></td>
                {dashboard.categories.filter((category) => category.enabled).map((category) => (
                  <td key={category.statId}><span className="matchup-value">{matchup.teamA.stats[category.statId] || "--"}</span><small>{matchup.teamB.stats[category.statId] || "--"}</small></td>
                ))}
                <td><button type="button" className="row-action" onClick={() => onChoose(matchup.id)}>{matchup.id === dashboard.selectedMatchupId ? "Selected" : "View"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RawDataView({ dashboard }: { dashboard: DashboardResponse }) {
  return (
    <>
      <div className="panel-heading"><div><p className="eyebrow">Diagnostics</p><h2>Dashboard response</h2><p>Exact normalized data returned by the private server route.</p></div></div>
      <pre className="raw-data">{JSON.stringify(dashboard, null, 2)}</pre>
    </>
  );
}
