import { describe, expect, it } from "vitest";
import { mergePlayerWindows, parseDraftPlayerPage, parseDraftResults, parseFreeAgentPage, parseLeagueConfiguration, parseLeagueDiscovery, parseLeagueSettings, parseNbaGameHistory, parseRoster, parseScoreboard } from "@/lib/yahoo";

const gamesXml = `
<fantasy_content xmlns="http://fantasysports.yahooapis.com/fantasy/v2/base.rng">
  <users><user><games>
    <game><game_key>453</game_key><code>nba</code><season>2023</season><leagues><league><league_key>453.l.1</league_key><name>Old League</name><current_week>20</current_week></league></leagues></game>
    <game><game_key>454</game_key><code>nba</code><season>2024</season><leagues><league><league_key>454.l.9</league_key><name>Current League</name><current_week>19</current_week><start_week>1</start_week><end_week>21</end_week></league></leagues></game>
  </games></user></users>
</fantasy_content>`;

const teamsXml = `
<fantasy_content xmlns="http://fantasysports.yahooapis.com/fantasy/v2/base.rng">
  <users><user><games><game><teams><team><team_key>454.l.9.t.1</team_key><name>My Team</name></team></teams></game></games></user></users>
</fantasy_content>`;

describe("Yahoo XML normalization", () => {
  it("discovers the latest accessible NBA game without a hardcoded key", () => {
    const leagues = parseLeagueDiscovery(gamesXml, teamsXml);
    expect(leagues).toHaveLength(1);
    expect(leagues[0]).toMatchObject({
      gameKey: "454",
      leagueKey: "454.l.9",
      name: "Current League",
      currentWeek: 19,
      userTeam: { key: "454.l.9.t.1", name: "My Team" },
    });
  });

  it("maps Yahoo stat IDs and short labels to report categories", () => {
    const settings = parseLeagueSettings(`
      <fantasy_content><league><settings><stat_categories><stats>
        <stat><stat_id>5</stat_id><display_name>FG%</display_name><position>1</position></stat>
        <stat><stat_id>18</stat_id><display_name>BLK</display_name><position>2</position></stat>
        <stat><stat_id>0</stat_id><display_name>GP</display_name><position>0</position><is_only_display_stat>1</is_only_display_stat></stat>
      </stats></stat_categories></settings></league></fantasy_content>`);
    expect(settings.find((stat) => stat.statId === "5")?.name).toBe("Field Goal Percentage");
    expect(settings.find((stat) => stat.statId === "18")?.name).toBe("Blocked Shots");
    expect(settings.find((stat) => stat.statId === "0")?.enabled).toBe(false);
  });

  it("parses complete matchup pairs and category values", () => {
    const matchups = parseScoreboard(`
      <fantasy_content><league><scoreboard><matchups><matchup>
        <week>19</week><status>midevent</status><teams>
          <team><team_key>454.l.9.t.1</team_key><name>My Team</name><team_stats><stats><stat><stat_id>12</stat_id><value>501</value></stat></stats></team_stats></team>
          <team><team_key>454.l.9.t.2</team_key><name>Opponent</name><team_stats><stats><stat><stat_id>12</stat_id><value>498</value></stat></stats></team_stats></team>
        </teams>
      </matchup></matchups></scoreboard></league></fantasy_content>`, 19);
    expect(matchups).toHaveLength(1);
    expect(matchups[0].teamA.stats["12"]).toBe("501");
    expect(matchups[0].teamB.name).toBe("Opponent");
  });

  it("joins free-agent identity and period stats in one normalized record", () => {
    const players = parseFreeAgentPage(`
      <fantasy_content><league><players><player>
        <player_key>454.p.42</player_key><name><full>Example Player</full></name>
        <editorial_team_abbr>GS</editorial_team_abbr><display_position>SG,SF</display_position>
        <player_stats><stats><stat><stat_id>0</stat_id><value>8</value></stat><stat><stat_id>12</stat_id><value>112</value></stat></stats></player_stats>
      </player></players></league></fantasy_content>`, "lastmonth");
    expect(players[0]).toMatchObject({
      playerKey: "454.p.42",
      name: "Example Player",
      team: "GSW",
      period: "lastmonth",
      stats: { "Games Played (GP)": 8, "Points Scored": 112 },
    });
  });

  it("preserves every available Yahoo stat window when joining player pages", () => {
    const page = (period: "season" | "lastmonth" | "lastweek", games: number, points: number) => parseFreeAgentPage(`
      <fantasy_content><league><players><player>
        <player_key>454.p.42</player_key><name><full>Example Player</full></name>
        <editorial_team_abbr>GS</editorial_team_abbr><display_position>SG,SF</display_position>
        <eligible_positions><position>SG</position><position>SF</position><position>Util</position></eligible_positions>
        <player_stats><stats><stat><stat_id>0</stat_id><value>${games}</value></stat><stat><stat_id>12</stat_id><value>${points}</value></stat></stats></player_stats>
      </player></players></league></fantasy_content>`, period)[0];
    const merged = mergePlayerWindows([
      page("season", 50, 700),
      page("lastmonth", 12, 192),
      page("lastweek", 3, 54),
    ]);
    expect(merged).toMatchObject({ period: "lastmonth", eligiblePositions: ["SG", "SF", "Util"] });
    expect(merged?.statWindows).toEqual({
      season: { "Games Played (GP)": 50, "Points Scored": 700 },
      lastmonth: { "Games Played (GP)": 12, "Points Scored": 192 },
      lastweek: { "Games Played (GP)": 3, "Points Scored": 54 },
    });
  });

  it("parses scoring format, roster slots, and dated player eligibility", () => {
    const configuration = parseLeagueConfiguration(`
      <fantasy_content><league><scoring_type>headone</scoring_type><settings>
        <roster_positions>
          <roster_position><position>PG</position><count>1</count></roster_position>
          <roster_position><position>Util</position><count>2</count></roster_position>
          <roster_position><position>BN</position><count>3</count></roster_position>
        </roster_positions>
        <stat_categories><stats><stat><stat_id>12</stat_id><display_name>PTS</display_name></stat></stats></stat_categories>
      </settings></league></fantasy_content>`);
    expect(configuration.scoringFormat).toBe("most-categories");
    expect(configuration.rosterPositions).toEqual([
      { position: "PG", count: 1 },
      { position: "Util", count: 2 },
      { position: "BN", count: 3 },
    ]);

    const roster = parseRoster(`
      <fantasy_content><team><roster><players><player>
        <player_key>454.p.42</player_key><name><full>Example Player</full></name>
        <editorial_team_abbr>GS</editorial_team_abbr><display_position>SG,SF</display_position>
        <eligible_positions><position>SG</position><position>SF</position><position>Util</position></eligible_positions>
        <selected_position><position>SG</position></selected_position>
      </player></players></roster></team></fantasy_content>`);
    expect(roster[0]).toMatchObject({
      selectedPosition: "SG",
      eligiblePositions: ["SG", "SF", "Util"],
    });
  });

  it("parses Yahoo draft analysis, draft results, and NBA game history", () => {
    const players = parseDraftPlayerPage(`
      <fantasy_content><game><players><player>
        <player_key>500.p.42</player_key><player_id>42</player_id><name><full>Draft Player</full></name>
        <editorial_team_abbr>NY</editorial_team_abbr><display_position>PG,SG</display_position>
        <eligible_positions><position>PG</position><position>SG</position></eligible_positions>
        <draft_analysis><average_pick>17.4</average_pick><average_round>2.1</average_round><average_cost>31.5</average_cost><percent_drafted>0.98</percent_drafted></draft_analysis>
        <player_stats><stats><stat><stat_id>0</stat_id><value>60</value></stat><stat><stat_id>12</stat_id><value>1200</value></stat></stats></player_stats>
      </player></players></game></fantasy_content>`);
    expect(players[0]).toMatchObject({
      playerId: "42",
      team: "NYK",
      gamesPlayed: 60,
      draftAnalysis: { averagePick: 17.4, averageRound: 2.1, averageCost: 31.5, percentDrafted: .98 },
    });

    const results = parseDraftResults(`
      <fantasy_content><league><draft_results>
        <draft_result><pick>2</pick><round>1</round><team_key>500.l.1.t.2</team_key><player_key>500.p.42</player_key><cost>44</cost></draft_result>
        <draft_result><pick>1</pick><round>1</round><team_key>500.l.1.t.1</team_key><player_key>500.p.1</player_key></draft_result>
      </draft_results></league></fantasy_content>`);
    expect(results.map((result) => result.pick)).toEqual([1, 2]);
    expect(results[1].cost).toBe(44);

    const history = parseNbaGameHistory(`
      <fantasy_content><games>
        <game><game_key>499</game_key><code>nba</code><season>2025</season></game>
        <game><game_key>501</game_key><code>nba</code><season>2026</season></game>
        <game><game_key>500</game_key><code>nfl</code><season>2026</season></game>
      </games></fantasy_content>`);
    expect(history.map((game) => game.gameKey)).toEqual(["501", "499"]);
  });
});
