import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpTip, StatHelp } from "@/components/help-tip";
import { HELP, scoreTopic, statDescription } from "@/lib/help-content";
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
    const { unmount } = render(<><HelpTip topic="refresh" /><button>Next</button></>);
    act(() => screen.getByRole("button", { name: /Refresh.*說明/ }).focus());
    act(() => screen.getByText("Next").focus());
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Refresh.*說明/ }));
    unmount(); expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
  it("distinguishes projection, actual totals, ratio units and unknown custom stats", () => {
    expect(scoreTopic("matchup-probability")).toBe("probability");
    expect(scoreTopic("expected-categories")).toBe("expectedCategories");
    expect(scoreTopic("fantasy-points")).toBe("netFp"); expect(scoreTopic("roto-points")).toBe("rotoGain");
    expect(statDescription("20", "A/T", "weekly")).toContain("沒有 % 單位");
    expect(statDescription("12", "PTS", "projection")).toContain("單場預估");
    render(<StatHelp id="999" name="Custom stat" context="matchup" />);
    fireEvent.click(screen.getByRole("button", { name: "Custom stat 說明" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("缺少專屬定義");
    expect(screen.getByRole("tooltip")).toHaveTextContent("不推測計算公式");
  });
});
