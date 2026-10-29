import { recordMetric } from "@/lib/usage-metrics";
import { ProviderBusyError } from "@/lib/errors";
interface Waiter { start: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
const globalGate = globalThis as typeof globalThis & { __fantasyYahooGate?: { active: number; pausedUntil: number; queue: Waiter[] } };
const state = globalGate.__fantasyYahooGate ??= { active: 0, pausedUntil: 0, queue: [] };
const paused = () => state.pausedUntil > Date.now();
const busy = () => new ProviderBusyError("Yahoo is temporarily rate limited. Please retry later.", Math.max(1, Math.ceil((state.pausedUntil - Date.now()) / 1000)));
function drain() {
  while (state.queue.length && (paused() || state.active < 2)) {
    const waiter = state.queue.shift()!;
    clearTimeout(waiter.timer);
    if (paused()) waiter.reject(busy());
    else waiter.start();
  }
}
export function pauseYahoo(retryAfter: string | null) {
  const seconds = retryAfter?.trim() ? Number(retryAfter) : NaN;
  const parsedDate = retryAfter ? Date.parse(retryAfter) : NaN;
  const milliseconds = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000
    : Number.isFinite(parsedDate) && parsedDate > Date.now() ? parsedDate - Date.now() : 60_000;
  state.pausedUntil = Math.max(state.pausedUntil, Date.now() + milliseconds);
  recordMetric("yahoo429");
  drain();
  return Math.max(1, Math.ceil((state.pausedUntil - Date.now()) / 1000));
}
export async function withYahooSlot<T>(loader: () => Promise<T>): Promise<T> {
  if (paused()) throw busy();
  await new Promise<void>((resolve, reject) => {
    const start = () => { state.active += 1; resolve(); };
    if (state.active < 2) { start(); return; }
    const waiter: Waiter = { start, reject, timer: setTimeout(() => {
      const index = state.queue.indexOf(waiter);
      if (index >= 0) state.queue.splice(index, 1);
      recordMetric("queueTimeouts");
      reject(new ProviderBusyError("Yahoo request queue is busy. Please retry shortly.", 10));
    }, 10_000) };
    state.queue.push(waiter);
  });
  const started = Date.now();
  let sent = false;
  try {
    if (paused()) throw busy();
    sent = true;
    return await loader();
  } finally {
    if (sent) recordMetric("yahooRequests", Date.now() - started);
    state.active -= 1;
    drain();
  }
}
export function resetYahooGateForTests() {
  state.pausedUntil = 0;
  for (const waiter of state.queue.splice(0)) { clearTimeout(waiter.timer); waiter.reject(new Error("Test reset")); }
}
