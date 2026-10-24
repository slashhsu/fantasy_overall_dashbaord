import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlayerAvatar } from "@/components/player-avatar";
import { parseFreeAgentPage, parseDraftPlayerPage } from "@/lib/yahoo";
import { recommendFreeAgents } from "@/lib/recommender";

const photo = "https://s.yimg.com/player.png";
afterEach(cleanup);

describe("player photos", () => {
  it("reserves space and lazily loads photos over initials", () => {
    const { container } = render(<PlayerAvatar name="Stephen Curry" headshotUrl={photo} />);
    const avatar = container.firstElementChild!;
    const image = container.querySelector("img")!;
    expect(avatar).toHaveStyle({ width: "32px", height: "32px" });
    expect(avatar).toHaveTextContent("SC");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
    expect(image).toHaveAttribute("alt", "");
    expect(image).not.toHaveClass("is-loaded");
    fireEvent.load(image);
    expect(image).toHaveClass("is-loaded");
  });

  it.each([undefined, "bad-url", "http://s.yimg.com/photo.png", "https://yimg.com.attacker.test/p.png", "https://attacker.test/p.png", "https://user:pass@s.yimg.com/p.png"])("uses initials for unsupported URL %s", (url) => {
    const { container } = render(<PlayerAvatar name="Stephen Curry" headshotUrl={url} size={26} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.firstElementChild).toHaveTextContent("SC");
    expect(container.firstElementChild).toHaveStyle({ width: "26px", height: "26px" });
  });

  it("falls back on errors and retries when the player or URL changes", () => {
    const { container, rerender } = render(<PlayerAvatar name="Stephen Curry" headshotUrl={photo} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    rerender(<PlayerAvatar name="Other Player" headshotUrl={photo} />);
    expect(container.querySelector("img")).not.toBeNull();
    fireEvent.error(container.querySelector("img")!);
    rerender(<PlayerAvatar name="Other Player" headshotUrl="https://sports.yahoo.com/new.png" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "https://sports.yahoo.com/new.png");
  });

  it("preserves Yahoo photos through free agent, draft, and recommendation data", () => {
    const xml = `<fantasy_content><players><player><player_key>nba.p.1</player_key><name><full>Stephen Curry</full></name><headshot><url>${photo}</url></headshot><player_stats><stats><stat><stat_id>12</stat_id><value>25</value></stat></stats></player_stats></player></players></fantasy_content>`;
    const players = parseFreeAgentPage(xml, "season");
    expect(players[0].headshotUrl).toBe(photo);
    expect(parseDraftPlayerPage(xml)[0].headshotUrl).toBe(photo);
    expect(recommendFreeAgents(players, [], { strictGameDay: false })[0].headshotUrl).toBe(photo);
  });
});
