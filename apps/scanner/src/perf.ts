// Timing log for the field test (Phase 2, ADR 0022: verification time and camera read rate).
// Off unless the build sets EXPO_PUBLIC_FIELD_PERF=1, which only the "scanner-field-apk"
// workflow does. Lines start with "[PERF]" so they can be read from `adb logcat`.
export const FIELD_PERF = process.env.EXPO_PUBLIC_FIELD_PERF === "1";

export function perfNow(): number {
  return performance.now();
}

export function perfLog(kind: string, value: number | string): void {
  if (FIELD_PERF)
    console.log(`[PERF] ${kind}=${typeof value === "number" ? value.toFixed(2) : value}`);
}
