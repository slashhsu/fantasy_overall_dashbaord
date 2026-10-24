import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCacheForTests, withCache, setCached } from "@/lib/cache";
import { withUpdateStatus } from "@/lib/update-status";
import { handleApiError } from "@/lib/api-response";
import { ProviderBusyError } from "@/lib/errors";
import { pauseYahoo, resetYahooGateForTests, withYahooSlot } from "@/lib/yahoo-request-gate";

beforeEach(() => { resetCacheForTests(); resetYahooGateForTests(); });
afterEach(() => vi.useRealTimers());

describe("shared instance request protection", () => {
  it("coalesces 20 visitors and only allows a forced reload after 60 seconds", async () => {
    vi.useFakeTimers();
    const loader = vi.fn(async () => ({ ok: true }));
    await Promise.all(Array.from({ length: 20 }, () => withCache("league:1", 300, loader, true)));
    expect(loader).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await withCache("league:1", 300, loader, true);
    await vi.advanceTimersByTimeAsync(30_000);
    await withCache("league:1", 300, loader, true);
    expect(loader).toHaveBeenCalledTimes(2);
    await withCache("league:1:week2", 300, loader, true);
    expect(loader).toHaveBeenCalledTimes(3);
  });
  it("returns original timestamps and marks stale fallback", async () => {
    vi.useFakeTimers();
    setCached("data", 42, 1);
    const fetchedAt = new Date().toISOString();
    await vi.advanceTimersByTimeAsync(61_000);
    const result = await withUpdateStatus(async () => ({ result: await withCache("data", 1, async () => { throw Error("upstream"); }) }));
    expect(result.result.value).toBe(42);
    expect(result.updateStatus).toMatchObject({ stale: true, fetchedAt });
  });
  it("limits 20 concurrent Yahoo operations to two", async () => {
    let active = 0; let maximum = 0;
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => withYahooSlot(async () => {
      active++; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1)); active--; return index;
    })));
    expect(results).toHaveLength(20);
    expect(maximum).toBe(2);
  });
  it("times out queued work without invoking its loader", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const first = withYahooSlot(() => blocker); const second = withYahooSlot(() => blocker);
    const loader = vi.fn(async () => 1);
    const queued = expect(withYahooSlot(loader)).rejects.toMatchObject({ retryAfterSeconds: 10 });
    await vi.advanceTimersByTimeAsync(10_000);
    await queued;
    expect(loader).not.toHaveBeenCalled(); release(); await Promise.all([first, second]);
  });
  it("rejects queued calls immediately when Yahoo signals a pause", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const first = withYahooSlot(() => blocker); const second = withYahooSlot(() => blocker);
    await Promise.resolve();
    const loader = vi.fn(async () => 1);
    const queued = expect(withYahooSlot(loader)).rejects.toMatchObject({ name: "ProviderBusyError" });
    pauseYahoo("60"); await queued;
    expect(loader).not.toHaveBeenCalled(); release(); await Promise.all([first, second]);
  });
  it("returns Retry-After and a distinct error code for provider pressure", async () => {
    const response = handleApiError(new ProviderBusyError("busy", 12));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("12");
    expect(await response.json()).toMatchObject({ code: "PROVIDER_BUSY", retryAfterSeconds: 12 });
  });
  it.each(["5", "http-date", null])("pauses and resumes after Retry-After %s", async (header) => {
    vi.useFakeTimers();
    const actual = header === "http-date" ? new Date(Date.now() + 5000).toUTCString() : header;
    pauseYahoo(actual);
    const loader = vi.fn(async () => 1);
    await expect(withYahooSlot(loader)).rejects.toMatchObject({ name: "ProviderBusyError" });
    expect(loader).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(header === null ? 60_000 : 5000);
    await expect(withYahooSlot(loader)).resolves.toBe(1);
  });
});
