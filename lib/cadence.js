// Adaptive cadence: the conversation tightens when the operator engages and
// decays toward once-a-day when they go quiet.
export const FLOOR_MS = 30 * 60 * 1000; // 30 min
export const CEIL_MS = 24 * 60 * 60 * 1000; // 24 h
export const START_MS = 6 * 60 * 60 * 1000; // 6 h

export function nextInterval(current, engaged) {
  const next = engaged ? current / 2 : current * 2;
  return Math.min(CEIL_MS, Math.max(FLOOR_MS, next));
}
