import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpTip } from "@/components/help-tip";
import { HELP, HELP_USAGE, MODEL_HELP_KEYS, STAT_DEFINITIONS, scoreHelpFor, scoreTopic } from "@/lib/help-content";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("shared contextual help", () => {
  it("opens on hover, is portaled outside a clipping table, and stays open when entering its content", async () => {
    const { container } = render(<div style={{ overflow: "hidden" }}><HelpTip topic="priority" /></div>);
    const trigger = screen.getByRole("button", { name: "Priority 說明" });
    fireEvent.pointerEnter(trigger);
    const tip = screen.getByRole("tooltip");
    expect(container).not.toContainElement(tip);
    expect(trigger).toHaveAttribute("aria-describedby", tip.id);
    expect(tip).toHaveTextContent(HELP.priority[2]);
    fireEvent.pointerLeave(trigger); fireEvent.pointerEnter(tip);
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerLeave(tip);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });
  it("supports focus, Escape, click toggling and outside dismissal without triggering parent actions", () => {
    const choose = vi.fn();
    render(<div onClick={choose} onKeyDown={choose}><HelpTip topic="confidence" /><button>Outside</button></div>);
    const trigger = screen.getByRole("button", { name: "Confidence 說明" });
    act(() => trigger.focus()); expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: "Escape" }); expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(trigger); expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.click(trigger); expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(trigger); fireEvent.pointerDown(screen.getByText("Outside"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: "Enter" }); fireEvent.keyDown(trigger, { key: " " });
    // Escape may bubble to the enclosing noninteractive container, but activation never selects a row.
    expect(choose.mock.calls.every(([event]) => event.key === "Escape")).toBe(true);
  });
  it("closes on blur and cleans up the portal on unmount", async () => {
    const { unmount } = render(<><HelpTip topic="lineup" /><button>Next</button></>);
    act(() => screen.getByRole("button", { name: /Lineup.*說明/ }).focus());
    act(() => screen.getByText("Next").focus());
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Lineup.*說明/ }));
    unmount(); expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
  it("keeps basic definitions in the guide and distinguishes homogeneous and mixed model units", () => {
    expect(scoreTopic("matchup-probability")).toBe("probability");
    expect(scoreTopic("expected-categories")).toBe("expectedCategories");
    expect(scoreTopic("fantasy-points")).toBe("netFp"); expect(scoreTopic("roto-points")).toBe("rotoGain");
    expect(STAT_DEFINITIONS["20"][1]).toContain("沒有 % 單位");
    expect(HELP_USAGE.stats).toBe("guide-only");
    expect(HELP_USAGE.league).toBe("guide-only");
    expect(HELP_USAGE.refresh).toBe("guide-only");
    expect(HELP_USAGE.adp).toBe("guide-only");
    expect(HELP_USAGE.aav).toBe("guide-only");
    expect(MODEL_HELP_KEYS).toContain("priority");
    expect(MODEL_HELP_KEYS).toContain("categoryProfile");
    expect(scoreHelpFor([{ scoreType: "expected-categories" }, { scoreType: "expected-categories" }])).toEqual({ topic: "expectedCategories", mixed: false });
    expect(scoreHelpFor([{ scoreType: "matchup-probability" }, { scoreType: "expected-categories" }])).toEqual({ topic: "swing", mixed: true });
    expect(scoreHelpFor([{ scoreType: "legacy-z-score" }, { scoreType: "blended-z-score" }])).toEqual({ topic: "categoryFit", mixed: false });
    expect(scoreHelpFor([])).toEqual({ topic: "swing", mixed: false });
  });
});
