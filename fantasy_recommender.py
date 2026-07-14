from __future__ import annotations

import datetime as _dt
import math
import re
import unicodedata
from typing import Iterable, Sequence

import pandas as pd


LOWER_IS_BETTER = {
    "Turnovers",
    "Personal Fouls",
    "Technical Fouls",
    "Ejections",
    "Flagrant Fouls",
    "Times Fouled Out",
}

PERCENTAGE_CATEGORIES = {
    "Field Goal Percentage": {
        "ratio": "Field Goals Made / Field Goals Attempted",
        "made": ["Field Goals Made (FGM)", "Field Goals Made"],
        "attempted": ["Field Goals Attempted (FGA)", "Field Goals Attempted"],
    },
    "Free Throw Percentage": {
        "ratio": "Free Throws Made / Free Throws Attempted",
        "made": ["Free Throws Made (FTM)", "Free Throws Made"],
        "attempted": ["Free Throws Attempted (FTA)", "Free Throws Attempted"],
    },
    "3-point Percentage": {
        "ratio": None,
        "made": ["Three-Pointers Made (3PM)", "Three-Pointers Made (3PA)", "3-point Shots Made"],
        "attempted": ["Three-Pointers Attempted (3PA)", "3-point Shots Attempted"],
    },
}

COUNT_STAT_CANDIDATES = {
    "Field Goals Made": ["Field Goals Made (FGM)", "Field Goals Made"],
    "Field Goals Attempted": ["Field Goals Attempted (FGA)", "Field Goals Attempted"],
    "Free Throws Made": ["Free Throws Made (FTM)", "Free Throws Made"],
    "Free Throws Attempted": ["Free Throws Attempted (FTA)", "Free Throws Attempted"],
    "3-point Shots Made": ["Three-Pointers Made (3PM)", "Three-Pointers Made (3PA)", "3-point Shots Made"],
    "3-point Shots Attempted": ["Three-Pointers Attempted (3PA)", "3-point Shots Attempted"],
    "Points Scored": ["Total Points (PTS)", "Total Points Game(PTS) ", "Points Scored"],
    "Total Rebounds": ["Total Rebounds (REB)", "Total Rebounds"],
    "Offensive Rebounds": ["Offensive Rebounds (OREB)", "Offensive Rebounds"],
    "Defensive Rebounds": ["Defensive Rebounds (DREB)", "Defensive Rebounds"],
    "Assists": ["Assists (AST)", "Assists"],
    "Steals": ["Steals (STL)", "Steals"],
    "Blocked Shots": ["Blocks (BLK)", "Blocked Shots", "Blocks"],
    "Blocks": ["Blocks (BLK)", "Blocked Shots", "Blocks"],
    "Turnovers": ["Turnovers (TO)", "Turnovers"],
    "Double-Doubles": ["Double-Doubles"],
    "Personal Fouls": ["Personal Fouls (PF)", "Personal Fouls"],
    "Assist/Turnover Ratio": ["Assist/Turnover Ratio (A/T)", "A/T", "Assist/Turnover Ratio"],
}

DEFAULT_PERIOD_PRIORITY = ("lastmonth", "lastweek", "season")


def normalize_name(value: object) -> str:
    """Normalize player names so Yahoo accents/punctuation do not break joins."""
    if pd.isna(value):
        return ""
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def to_number(value: object) -> float:
    if pd.isna(value):
        return math.nan
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if text in {"", "-", "--", "None", "nan", "NaN"}:
        return math.nan
    if "/" in text:
        made, attempted = split_ratio(text)
        return made / attempted if attempted else math.nan
    try:
        return float(text)
    except ValueError:
        return math.nan


def split_ratio(value: object) -> tuple[float, float]:
    if pd.isna(value):
        return math.nan, math.nan
    parts = str(value).strip().split("/")
    if len(parts) != 2:
        return math.nan, math.nan
    return to_number(parts[0]), to_number(parts[1])


def _first_existing(df: pd.DataFrame, candidates: Sequence[str]) -> str | None:
    for col in candidates:
        if col in df.columns:
            return col
    return None


def _clean_match_rows(team_match: pd.DataFrame) -> pd.DataFrame:
    df = team_match.copy()
    if "Team Name" in df.columns:
        df = df[df["Team Name"].astype(str).str.lower() != "match_result"]
    return df.reset_index(drop=True)


def select_matchup(
    match_df: pd.DataFrame,
    *,
    league_key: str | None = None,
    team_name: str | None = None,
    team_row_index: int | None = None,
) -> pd.DataFrame:
    """Select the two matchup rows for one team from Match_df or All_Match_df."""
    df = _clean_match_rows(match_df)
    if league_key and "League Key" in df.columns:
        df = df[df["League Key"].astype(str) == str(league_key)].reset_index(drop=True)

    if df.empty:
        raise ValueError("No matchup rows found for that league/team selection.")

    if team_name:
        matches = df.index[df["Team Name"].astype(str) == str(team_name)].tolist()
        if not matches:
            raise ValueError(f"Could not find team_name={team_name!r} in matchup data.")
        pos = matches[0]
    elif team_row_index is not None:
        pos = int(team_row_index)
    else:
        pos = 0

    pair_start = (pos // 2) * 2
    pair = df.iloc[pair_start : pair_start + 2].reset_index(drop=True)
    if len(pair) != 2:
        raise ValueError("Could not identify a complete two-team matchup pair.")
    return pair


def _result_label(category: str, team_value: float, opponent_value: float) -> tuple[str, str, int | None]:
    if pd.isna(team_value) or pd.isna(opponent_value):
        return "No Data", "No Data", None
    if team_value == opponent_value:
        return "Draw", "Draw", None

    lower_is_better = category in LOWER_IS_BETTER
    winning = team_value < opponent_value if lower_is_better else team_value > opponent_value
    side = "Win" if winning else "Lose"

    base = abs(team_value) if abs(team_value) > 1e-9 else 1.0
    diff_ratio = abs(team_value - opponent_value) / base
    thresholds = (0.05, 0.10, 0.15) if category in PERCENTAGE_CATEGORIES else (0.10, 0.20, 0.30)
    if diff_ratio < thresholds[0]:
        level = 1
    elif diff_ratio < thresholds[1]:
        level = 2
    elif diff_ratio < thresholds[2]:
        level = 3
    else:
        level = 4
    return f"{side} {level}", side, level


def _priority(side: str, level: int | None) -> float:
    if side == "Draw":
        return 3.25
    if level is None:
        return 0.0
    if side == "Lose":
        return {1: 4.0, 2: 2.75, 3: 1.25, 4: 0.35}.get(level, 0.0)
    if side == "Win":
        return {1: 1.10, 2: 0.35, 3: 0.0, 4: 0.0}.get(level, 0.0)
    return 0.0


def evaluate_matchup(team_match: pd.DataFrame, team_row: int = 0, opponent_row: int = 1) -> pd.DataFrame:
    """Compare one matchup and assign category priority weights."""
    df = _clean_match_rows(team_match)
    if len(df) <= max(team_row, opponent_row):
        raise ValueError("team_match needs at least two team rows.")

    ratio_helper_cols = {cfg["ratio"] for cfg in PERCENTAGE_CATEGORIES.values() if cfg.get("ratio")}
    skip_cols = {"League Key", "Team Name", "Unnamed: 0"} | ratio_helper_cols
    rows = []
    for category in [c for c in df.columns if c not in skip_cols]:
        team_value = to_number(df.loc[team_row, category])
        opponent_value = to_number(df.loc[opponent_row, category])
        result, side, level = _result_label(category, team_value, opponent_value)
        rows.append(
            {
                "Category": category,
                "Team Value": team_value,
                "Opponent Value": opponent_value,
                "Result": result,
                "Side": side,
                "Level": level,
                "Priority Weight": _priority(side, level),
                "Lower Is Better": category in LOWER_IS_BETTER,
            }
        )
    return pd.DataFrame(rows).sort_values("Priority Weight", ascending=False).reset_index(drop=True)


def prepare_player_pool(
    free_df: pd.DataFrame,
    player_stats_df: pd.DataFrame,
    periods: Sequence[str] = DEFAULT_PERIOD_PRIORITY,
) -> pd.DataFrame:
    """Join league free agents to recent/season player stats."""
    if free_df.empty:
        return free_df.copy()

    free = free_df.copy()
    if "name" not in free.columns:
        raise ValueError("free_df must have a 'name' column.")
    free["_name_key"] = free["name"].map(normalize_name)

    stats = player_stats_df.copy()
    if "Full Name" not in stats.columns:
        raise ValueError("player_stats_df must have a 'Full Name' column.")
    stats["_name_key"] = stats["Full Name"].map(normalize_name)

    if "Period" in stats.columns:
        rank = {period: i for i, period in enumerate(periods)}
        stats["_period_rank"] = stats["Period"].map(rank).fillna(len(rank)).astype(int)
    else:
        stats["_period_rank"] = 0

    if "Approach" in stats.columns:
        stats["_approach_rank"] = stats["Approach"].map({"Total": 0, "Average": 1}).fillna(2).astype(int)
    else:
        stats["_approach_rank"] = 0

    stats = stats.sort_values(["_name_key", "_period_rank", "_approach_rank"])
    stats = stats.drop_duplicates("_name_key", keep="first")

    suffix_cols = [c for c in ["Full Name", "Period", "Approach", "Player Key", "Player URL"] if c in stats.columns]
    stat_cols = [c for c in stats.columns if c not in {"_period_rank", "_approach_rank"}]
    pool = free.merge(stats[stat_cols], on="_name_key", how="left", suffixes=("", "_stats"))

    for col in suffix_cols:
        if col in pool.columns:
            pool[col] = pool[col]
    return pool


def _per_game(pool: pd.DataFrame, stat_candidates: Sequence[str]) -> pd.Series:
    col = _first_existing(pool, stat_candidates)
    if col is None:
        return pd.Series(0.0, index=pool.index)
    values = pool[col].map(to_number).fillna(0.0)
    gp_col = _first_existing(pool, ["Games Played (GP)", "GP"])
    if gp_col is None:
        return values
    games = pool[gp_col].map(to_number).replace(0, math.nan).fillna(1.0)
    return values / games


def _zscore(series: pd.Series) -> pd.Series:
    values = pd.to_numeric(series, errors="coerce").fillna(0.0)
    std = values.std(ddof=0)
    if std == 0 or pd.isna(std):
        return pd.Series(0.0, index=series.index)
    return (values - values.mean()) / std


def _percentage_context(team_match: pd.DataFrame, category: str, team_row: int, opponent_row: int) -> tuple[float, float]:
    df = _clean_match_rows(team_match)
    cfg = PERCENTAGE_CATEGORIES[category]
    ratio_col = cfg.get("ratio")

    if ratio_col and ratio_col in df.columns:
        team_made, team_attempted = split_ratio(df.loc[team_row, ratio_col])
        opp_made, opp_attempted = split_ratio(df.loc[opponent_row, ratio_col])
        team_pct = team_made / team_attempted if team_attempted else to_number(df.loc[team_row, category])
        opp_pct = opp_made / opp_attempted if opp_attempted else to_number(df.loc[opponent_row, category])
        return team_pct, opp_pct

    return to_number(df.loc[team_row, category]), to_number(df.loc[opponent_row, category])


def score_players(
    pool: pd.DataFrame,
    needs: pd.DataFrame,
    team_match: pd.DataFrame,
    *,
    team_row: int = 0,
    opponent_row: int = 1,
) -> pd.DataFrame:
    """Score free agents against current matchup category needs."""
    scored = pool.copy()
    if scored.empty:
        return scored

    scored["recommendation_score"] = 0.0
    weighted_categories: list[str] = []

    for _, need in needs.iterrows():
        category = need["Category"]
        weight = float(need["Priority Weight"])
        if weight <= 0:
            continue

        if category in PERCENTAGE_CATEGORIES:
            cfg = PERCENTAGE_CATEGORIES[category]
            made_pg = _per_game(scored, cfg["made"])
            attempted_pg = _per_game(scored, cfg["attempted"])
            team_pct, opponent_pct = _percentage_context(team_match, category, team_row, opponent_row)
            target_pct = opponent_pct if need["Side"] in {"Lose", "Draw"} else team_pct
            metric = (made_pg - target_pct * attempted_pg).fillna(0.0)
        elif category in COUNT_STAT_CANDIDATES:
            if category == "Assist/Turnover Ratio":
                col = _first_existing(scored, COUNT_STAT_CANDIDATES[category])
                metric = scored[col].map(to_number).fillna(0.0) if col else pd.Series(0.0, index=scored.index)
            else:
                metric = _per_game(scored, COUNT_STAT_CANDIDATES[category])
                if category in LOWER_IS_BETTER:
                    metric = -metric
        else:
            continue

        contribution_col = f"contrib__{category}"
        scored[contribution_col] = _zscore(metric) * weight
        scored["recommendation_score"] += scored[contribution_col]
        weighted_categories.append(category)

    gp_col = _first_existing(scored, ["Games Played (GP)", "GP"])
    if gp_col:
        games = scored[gp_col].map(to_number).fillna(0.0)
        reliability = (games.clip(lower=0, upper=8) / 8.0).pow(0.5)
        scored["recommendation_score"] = scored["recommendation_score"] * (0.75 + 0.25 * reliability)

    scored["reason"] = scored.apply(lambda row: _reason_text(row, weighted_categories), axis=1)
    scored["watchouts"] = scored.apply(lambda row: _watchout_text(row, weighted_categories), axis=1)
    _add_projection_columns(scored)
    return scored.sort_values("recommendation_score", ascending=False).reset_index(drop=True)


def _reason_text(row: pd.Series, categories: Iterable[str]) -> str:
    items = []
    for category in categories:
        value = row.get(f"contrib__{category}", 0.0)
        if pd.notna(value) and value > 0.35:
            items.append((category, float(value)))
    items.sort(key=lambda item: item[1], reverse=True)
    return ", ".join(category for category, _ in items[:3])


def _watchout_text(row: pd.Series, categories: Iterable[str]) -> str:
    items = []
    for category in categories:
        value = row.get(f"contrib__{category}", 0.0)
        if pd.notna(value) and value < -0.75:
            items.append((category, float(value)))
    items.sort(key=lambda item: item[1])
    return ", ".join(category for category, _ in items[:2])


def _add_projection_columns(scored: pd.DataFrame) -> None:
    projection_map = {
        "PTS_pg": COUNT_STAT_CANDIDATES["Points Scored"],
        "REB_pg": COUNT_STAT_CANDIDATES["Total Rebounds"],
        "AST_pg": COUNT_STAT_CANDIDATES["Assists"],
        "STL_pg": COUNT_STAT_CANDIDATES["Steals"],
        "BLK_pg": COUNT_STAT_CANDIDATES["Blocked Shots"],
        "3PM_pg": COUNT_STAT_CANDIDATES["3-point Shots Made"],
        "TO_pg": COUNT_STAT_CANDIDATES["Turnovers"],
    }
    for new_col, candidates in projection_map.items():
        scored[new_col] = _per_game(scored, candidates).round(2)


def teams_playing_on_date(target_date: str | _dt.date | None = None) -> set[str]:
    """Fetch NBA teams scheduled to play on a date from the public NBA schedule feed."""
    import requests

    if target_date is None:
        target = _dt.date.today()
    elif isinstance(target_date, _dt.date):
        target = target_date
    else:
        target = _dt.date.fromisoformat(str(target_date))

    url = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json"
    response = requests.get(url, timeout=20)
    response.raise_for_status()
    data = response.json()

    teams: set[str] = set()
    for game_date in data.get("leagueSchedule", {}).get("gameDates", []):
        raw_date = str(game_date.get("gameDate", ""))
        date_part = raw_date.split()[0]
        try:
            schedule_date = _dt.datetime.strptime(date_part, "%m/%d/%Y").date()
        except ValueError:
            continue
        if schedule_date != target:
            continue
        for game in game_date.get("games", []):
            home = game.get("homeTeam", {}).get("teamTricode")
            away = game.get("awayTeam", {}).get("teamTricode")
            if home:
                teams.add(str(home).upper())
            if away:
                teams.add(str(away).upper())
    return teams


def recommend_free_agents(
    free_df: pd.DataFrame,
    player_stats_df: pd.DataFrame,
    team_match: pd.DataFrame,
    *,
    target_date: str | _dt.date | None = None,
    teams_playing: Iterable[str] | None = None,
    strict_game_day: bool = True,
    periods: Sequence[str] = DEFAULT_PERIOD_PRIORITY,
    top_n: int = 20,
    team_row: int = 0,
    opponent_row: int = 1,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Return (recommendations, needs).

    Set target_date or teams_playing for daily streaming. If strict_game_day=True,
    players whose NBA team is not scheduled that day are filtered out.
    """
    needs = evaluate_matchup(team_match, team_row=team_row, opponent_row=opponent_row)
    pool = prepare_player_pool(free_df, player_stats_df, periods=periods)

    if teams_playing is None and target_date is not None:
        teams_playing = teams_playing_on_date(target_date)
    teams = {str(team).upper() for team in teams_playing} if teams_playing is not None else set()

    if "team" in pool.columns:
        pool["game_today"] = pool["team"].astype(str).str.upper().isin(teams) if teams else False
        if teams and strict_game_day:
            pool = pool[pool["game_today"]].copy()
    else:
        pool["game_today"] = False

    scored = score_players(pool, needs, team_match, team_row=team_row, opponent_row=opponent_row)

    display_cols = [
        "name",
        "position",
        "team",
        "game_today",
        "Period",
        "Games Played (GP)",
        "recommendation_score",
        "reason",
        "watchouts",
        "PTS_pg",
        "REB_pg",
        "AST_pg",
        "STL_pg",
        "BLK_pg",
        "3PM_pg",
        "TO_pg",
    ]
    display_cols = [col for col in display_cols if col in scored.columns]
    recommendations = scored[display_cols].head(top_n).copy()
    if "recommendation_score" in recommendations.columns:
        recommendations["recommendation_score"] = recommendations["recommendation_score"].round(2)
    return recommendations.reset_index(drop=True), needs
