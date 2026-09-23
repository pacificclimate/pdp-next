export function createSubsetLogger() {
  const subsetRuntimeLog = [];
  const subsetPerfLog = [];

  function startSubsetRun(kind, context = {}) {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      startedAt: performance.now(),
      startedAtIso: new Date().toISOString(),
      context
    };
  }

  function finishSubsetRun(run, status, extra = {}) {
    if (!run) return;
    const endedAt = performance.now();
    const durationMs = Math.round(endedAt - run.startedAt);
    const record = {
      ...run,
      status,
      endedAtIso: new Date().toISOString(),
      durationMs,
      ...extra
    };
    subsetRuntimeLog.push(record);
    window.__subsetRuntimeLog = subsetRuntimeLog;
  }

  function logSubsetPerf(record) {
    subsetPerfLog.push(record);
    window.__subsetPerfLog = subsetPerfLog;
  }

  return {
    startSubsetRun,
    finishSubsetRun,
    logSubsetPerf
  };
}
