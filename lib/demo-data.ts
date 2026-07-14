import { compactCategoryName } from "@/lib/stats";
import type { FreeAgent, LeagueCategory, LeagueSummary, Matchup } from "@/lib/types";

export const demoLeagues: LeagueSummary[] = [
  {
    gameKey: "demo-2025",
    leagueKey: "demo.l.101",
    name: "Downtown Dynasty",
    season: 2025,
    currentWeek: 19,
    startWeek: 1,
    endWeek: 21,
    userTeam: { key: "demo.l.101.t.1", name: "North Star" },
  },
  {
    gameKey: "demo-2025",
    leagueKey: "demo.l.202",
    name: "Sunday Hoops Club",
    season: 2025,
    currentWeek: 18,
    startWeek: 1,
    endWeek: 20,
    userTeam: { key: "demo.l.202.t.1", name: "Fast Break" },
  },
];

const categoryTuples = [
  ["5", "Field Goal Percentage"],
  ["8", "Free Throw Percentage"],
  ["10", "3-point Shots Made"],
  ["12", "Points Scored"],
  ["15", "Total Rebounds"],
  ["16", "Assists"],
  ["17", "Steals"],
  ["18", "Blocked Shots"],
  ["19", "Turnovers"],
] as const;

export const demoCategories: LeagueCategory[] = categoryTuples.map(([statId, name], position) => ({
  statId,
  name,
  displayName: compactCategoryName(name),
  position,
  enabled: true,
}));

const team = (
  teamKey: string,
  name: string,
  values: string[],
) => ({
  teamKey,
  name,
  stats: Object.fromEntries(categoryTuples.map(([statId], index) => [statId, values[index]])),
});

export const getDemoMatchups = (leagueKey: string, week: number): Matchup[] => {
  const alternate = leagueKey.endsWith("202");
  const prefix = leagueKey;
  return [
    {
      id: `${prefix}.t.1::${prefix}.t.6`,
      week,
      status: "midevent",
      isPlayoffs: false,
      isConsolation: false,
      teamA: team(`${prefix}.t.1`, alternate ? "Fast Break" : "North Star", [
        alternate ? ".478" : ".467",
        ".812",
        "57",
        "542",
        "201",
        "129",
        "31",
        "18",
        "62",
      ]),
      teamB: team(`${prefix}.t.6`, alternate ? "Glass Cleaners" : "Box Score Poets", [
        ".481",
        ".826",
        "52",
        "551",
        "193",
        "136",
        "28",
        "22",
        "67",
      ]),
    },
    {
      id: `${prefix}.t.2::${prefix}.t.7`,
      week,
      status: "midevent",
      isPlayoffs: false,
      isConsolation: false,
      teamA: team(`${prefix}.t.2`, "Corner Three", [".491", ".778", "61", "568", "214", "142", "25", "17", "71"]),
      teamB: team(`${prefix}.t.7`, "Paint Patrol", [".486", ".801", "44", "531", "228", "118", "34", "25", "64"]),
    },
    {
      id: `${prefix}.t.3::${prefix}.t.8`,
      week,
      status: "midevent",
      isPlayoffs: false,
      isConsolation: false,
      teamA: team(`${prefix}.t.3`, "Waiver Wire", [".455", ".834", "48", "519", "187", "151", "29", "21", "59"]),
      teamB: team(`${prefix}.t.8`, "The Closers", [".469", ".802", "55", "538", "205", "147", "30", "16", "66"]),
    },
  ];
};

const player = (
  key: string,
  name: string,
  teamAbbreviation: string,
  position: string,
  line: [number, number, number, number, number, number, number, number, number, number, number, number],
): FreeAgent => {
  const [gp, fga, fgm, fta, ftm, threePm, pts, reb, ast, stl, blk, turnovers] = line;
  return {
    playerKey: key,
    name,
    team: teamAbbreviation,
    position,
    period: "lastmonth",
    stats: {
      "Games Played (GP)": gp,
      "Field Goals Attempted (FGA)": fga,
      "Field Goals Made (FGM)": fgm,
      "Free Throws Attempted (FTA)": fta,
      "Free Throws Made (FTM)": ftm,
      "Three-Pointers Made (3PM)": threePm,
      "Points Scored": pts,
      "Total Rebounds": reb,
      Assists: ast,
      Steals: stl,
      "Blocked Shots": blk,
      Turnovers: turnovers,
    },
  };
};

export const demoFreeAgents: FreeAgent[] = [
  player("demo.p.1", "Anthony Black", "ORL", "PG,SG", [8, 81, 40, 25, 21, 15, 113, 38, 48, 12, 7, 14]),
  player("demo.p.2", "Marcus Bagley", "PHI", "SF,PF", [7, 58, 30, 17, 15, 14, 89, 43, 13, 8, 9, 8]),
  player("demo.p.3", "Jeff Dowtin Jr.", "PHI", "PG", [8, 70, 35, 19, 17, 13, 100, 24, 43, 10, 3, 12]),
  player("demo.p.4", "Isaiah Jackson", "IND", "PF,C", [6, 39, 25, 14, 10, 0, 60, 41, 9, 5, 14, 8]),
  player("demo.p.5", "Sam Hauser", "BOS", "SF,PF", [8, 76, 36, 8, 7, 31, 110, 34, 12, 5, 4, 6]),
  player("demo.p.6", "Haywood Highsmith", "MIA", "SF,PF", [8, 57, 29, 10, 8, 14, 80, 42, 16, 11, 6, 7]),
  player("demo.p.7", "Trayce Jackson-Davis", "GSW", "PF,C", [7, 45, 29, 18, 11, 0, 69, 54, 15, 4, 12, 9]),
  player("demo.p.8", "Miles McBride", "NYK", "PG,SG", [8, 88, 39, 16, 14, 22, 114, 25, 31, 8, 2, 9]),
  player("demo.p.9", "Simone Fontecchio", "DET", "SF,PF", [7, 66, 30, 12, 10, 18, 88, 30, 11, 6, 3, 7]),
  player("demo.p.10", "Andre Drummond", "PHI", "C", [6, 42, 24, 20, 11, 0, 59, 66, 9, 11, 8, 13]),
  player("demo.p.11", "Gary Trent Jr.", "MIL", "SG,SF", [8, 92, 39, 14, 12, 27, 117, 21, 14, 15, 2, 8]),
  player("demo.p.12", "Kyle Anderson", "GSW", "SF,PF", [7, 49, 25, 9, 7, 5, 62, 38, 35, 9, 5, 11]),
];

export const demoTeamsPlaying = ["BOS", "DET", "GSW", "MIA", "NYK", "ORL"];
