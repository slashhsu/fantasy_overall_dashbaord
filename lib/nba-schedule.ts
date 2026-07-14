import { normalizeTeamAbbreviation } from "@/lib/stats";

const NBA_SCHEDULE_URL = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json";

interface ScheduleTeam {
  teamTricode?: string;
}

interface ScheduleGame {
  homeTeam?: ScheduleTeam;
  awayTeam?: ScheduleTeam;
}

interface ScheduleDate {
  gameDate?: string;
  games?: ScheduleGame[];
}

interface ScheduleResponse {
  leagueSchedule?: {
    gameDates?: ScheduleDate[];
  };
}

const dateFromSchedule = (value: string) => {
  const [month, day, year] = value.split(" ")[0].split("/").map(Number);
  if (!month || !day || !year) return "";
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
};

export const teamsPlayingOnDateFromSchedule = (data: ScheduleResponse, targetDate: string) => {
  const teams = new Set<string>();
  for (const gameDate of data.leagueSchedule?.gameDates ?? []) {
    if (dateFromSchedule(gameDate.gameDate ?? "") !== targetDate) continue;
    for (const game of gameDate.games ?? []) {
      const home = game.homeTeam?.teamTricode;
      const away = game.awayTeam?.teamTricode;
      if (home) teams.add(normalizeTeamAbbreviation(home));
      if (away) teams.add(normalizeTeamAbbreviation(away));
    }
  }
  return [...teams].sort();
};

export const fetchTeamsPlayingOnDate = async (targetDate: string) => {
  const response = await fetch(NBA_SCHEDULE_URL, {
    headers: { "User-Agent": "FantasyBasketballDashboard/1.0" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`NBA schedule request failed with status ${response.status}.`);
  }
  const data = (await response.json()) as ScheduleResponse;
  return teamsPlayingOnDateFromSchedule(data, targetDate);
};
