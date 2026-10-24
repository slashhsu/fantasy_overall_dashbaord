type Metric = "yahooRequests" | "yahoo429" | "cacheHits" | "mergedRequests" | "cooldownHits" | "queueTimeouts";
const globalMetrics = globalThis as typeof globalThis & { __fantasyMetrics?: { counts: Partial<Record<Metric, number>>; latencyMs: number; timer?: ReturnType<typeof setTimeout> } };
const state = globalMetrics.__fantasyMetrics ??= { counts: {}, latencyMs: 0 };
export function recordMetric(metric: Metric, latencyMs = 0) {
  state.counts[metric] = (state.counts[metric] ?? 0) + 1;
  state.latencyMs += latencyMs;
  if (!state.timer) {
    state.timer = setTimeout(() => {
      console.info(JSON.stringify({ event: "fantasy_usage", windowSeconds: 60, ...state.counts,
        averageYahooLatencyMs: state.counts.yahooRequests ? Math.round(state.latencyMs / state.counts.yahooRequests) : 0 }));
      state.counts = {}; state.latencyMs = 0; state.timer = undefined;
    }, 60_000);
    state.timer.unref?.();
  }
}
