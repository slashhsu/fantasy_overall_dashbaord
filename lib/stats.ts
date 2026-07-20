const STAT_ID_NAMES: Record<string, string> = {
  "0": "Games Played (GP)",
  "1": "Rank",
  "3": "Field Goals Attempted (FGA)",
  "4": "Field Goals Made (FGM)",
  "5": "Field Goal Percentage",
  "6": "Free Throws Attempted (FTA)",
  "7": "Free Throws Made (FTM)",
  "8": "Free Throw Percentage",
  "9": "Three-Pointers Attempted (3PA)",
  "10": "Three-Pointers Made (3PM)",
  "11": "3-point Percentage",
  "12": "Points Scored",
  "13": "Offensive Rebounds",
  "14": "Defensive Rebounds",
  "15": "Total Rebounds",
  "16": "Assists",
  "17": "Steals",
  "18": "Blocked Shots",
  "19": "Turnovers",
  "20": "Assist/Turnover Ratio",
  "21": "Personal Fouls",
  "22": "Times Fouled Out",
  "23": "Technical Fouls",
  "24": "Ejections",
  "25": "Flagrant Fouls",
  "26": "Minutes Played",
  "27": "Games Started",
  "28": "Double-Doubles",
  "29": "Triple-Doubles",
};

const NAME_ALIASES: Record<string, string> = {
  FG: "Field Goal Percentage",
  FGP: "Field Goal Percentage",
  FIELDGOALPERCENTAGE: "Field Goal Percentage",
  FT: "Free Throw Percentage",
  FTP: "Free Throw Percentage",
  FREETHROWPERCENTAGE: "Free Throw Percentage",
  "3PT": "3-point Percentage",
  "3PTP": "3-point Percentage",
  "3POINTPERCENTAGE": "3-point Percentage",
  "3PTM": "3-point Shots Made",
  "3PM": "3-point Shots Made",
  "3POINTSMADE": "3-point Shots Made",
  PTS: "Points Scored",
  POINTS: "Points Scored",
  POINTSSCORED: "Points Scored",
  OREB: "Offensive Rebounds",
  DREB: "Defensive Rebounds",
  REB: "Total Rebounds",
  TOTALREBOUNDS: "Total Rebounds",
  AST: "Assists",
  ASSISTS: "Assists",
  ST: "Steals",
  STL: "Steals",
  STEALS: "Steals",
  BLK: "Blocked Shots",
  BLOCKS: "Blocked Shots",
  BLOCKEDSHOTS: "Blocked Shots",
  TO: "Turnovers",
  TURNOVERS: "Turnovers",
  AT: "Assist/Turnover Ratio",
  ASSISTTURNOVERRATIO: "Assist/Turnover Ratio",
  DD: "Double-Doubles",
  DOUBLEDOUBLES: "Double-Doubles",
  TD: "Triple-Doubles",
  TRIPLEDOUBLES: "Triple-Doubles",
  PF: "Personal Fouls",
  PERSONALFOULS: "Personal Fouls",
};

export const statNameForId = (statId: string) => STAT_ID_NAMES[statId] ?? `Stat ${statId}`;

export const canonicalCategoryName = (name: string, statId?: string) => {
  const normalized = name.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return NAME_ALIASES[normalized] ?? (statId ? STAT_ID_NAMES[statId] : undefined) ?? name;
};

export const compactCategoryName = (name: string) => {
  const compact: Record<string, string> = {
    "Field Goal Percentage": "FG%",
    "Free Throw Percentage": "FT%",
    "3-point Percentage": "3PT%",
    "3-point Shots Made": "3PM",
    "Points Scored": "PTS",
    "Offensive Rebounds": "OREB",
    "Defensive Rebounds": "DREB",
    "Total Rebounds": "REB",
    Assists: "AST",
    Steals: "STL",
    "Blocked Shots": "BLK",
    Turnovers: "TO",
    "Assist/Turnover Ratio": "A/T",
    "Double-Doubles": "DD",
    "Triple-Doubles": "TD",
    "Personal Fouls": "PF",
  };
  return compact[name] ?? name;
};

const TEAM_ALIASES: Record<string, string> = {
  GS: "GSW",
  GSW: "GSW",
  NO: "NOP",
  NOP: "NOP",
  NY: "NYK",
  NYK: "NYK",
  SA: "SAS",
  SAS: "SAS",
  PHO: "PHX",
  PHX: "PHX",
  UTAH: "UTA",
  WSH: "WAS",
};

export const normalizeTeamAbbreviation = (team: string) => {
  const normalized = team.trim().toUpperCase();
  return TEAM_ALIASES[normalized] ?? normalized;
};
