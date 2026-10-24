import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardApp } from "@/components/dashboard-app";
import { getDashboard } from "@/lib/dashboard-service";
import { demoLeagues } from "@/lib/demo-data";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("weekly report week selector", () => {
  it("keeps team selection across weeks, clears old matchups, and recovers from unavailable weeks", async () => {
    vi.stubEnv("YAHOO_DEMO_MODE", "true");
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname === "/api/leagues") return { ok: true, json: async () => ({ leagues: demoLeagues }) };
      requests.push(url);
      const week = Number(url.searchParams.get("week"));
      if (week === 21) return { ok: false, status: 400, json: async () => ({ error: "No matchup data" }) };
      const data = await getDashboard({ leagueKey: "demo.l.101", week, targetDate: "2026-10-22", timeZone: "America/New_York", teamKey: url.searchParams.get("teamKey") || undefined });
      return { ok: true, json: async () => data };
    }));
    render(<DashboardApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Weekly Report" }));
    const weeks = await screen.findByRole("combobox", { name: "Weekly report week" });
    expect(within(weeks).getAllByRole("option")).toHaveLength(21);
    expect(within(weeks).getByRole("option", { name: "Week 19 (Current)" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Weekly report team" })).toBeEnabled());
    const teamOptions = within(screen.getByRole("combobox", { name: "Weekly report team" })).getAllByRole("option") as HTMLOptionElement[];
    const team = teamOptions[1];
    fireEvent.change(screen.getByRole("combobox", { name: "Weekly report team" }), { target: { value: team.value } });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Weekly report team" })).toHaveValue(team.value));
    fireEvent.change(screen.getByRole("combobox", { name: "Weekly report week" }), { target: { value: "18" } });
    await waitFor(() => expect(requests.some((url) => url.searchParams.get("week") === "18" && url.searchParams.get("teamKey") === team.value && !url.searchParams.has("matchupId"))).toBe(true));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Weekly report team" })).toBeEnabled());
    expect(screen.getByRole("combobox", { name: "Weekly report week" })).toHaveValue("18");
    expect(screen.getByText("Week 18", { selector: ".eyebrow" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Weekly report week" }), { target: { value: "21" } });
    expect(await screen.findByText("尚無對戰數據")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Weekly report week" })).toBeEnabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Weekly report week" }), { target: { value: "18" } });
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});
