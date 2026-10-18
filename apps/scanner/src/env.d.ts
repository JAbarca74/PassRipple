// Values Expo inlines into the bundle from EXPO_PUBLIC_* environment variables.
declare const process: {
  readonly env: {
    readonly EXPO_PUBLIC_API_URL?: string;
    readonly EXPO_PUBLIC_E2E?: string;
    /** 1 only in the field-test APK: logs timings with a [PERF] prefix. */
    readonly EXPO_PUBLIC_FIELD_PERF?: string;
    /** Read by app.config.ts at build time only. */
    readonly SCANNER_APP_ID?: string;
    readonly SCANNER_FIELD_BUILD?: string;
    readonly SCANNER_VERSION_CODE?: string;
  };
};

// The monotonic clock React Native provides.
declare const performance: { now(): number };
