// Values Expo inlines into the bundle from EXPO_PUBLIC_* environment variables.
declare const process: {
  readonly env: {
    readonly EXPO_PUBLIC_API_URL?: string;
    readonly EXPO_PUBLIC_E2E?: string;
    /** Read by app.config.ts at build time only. */
    readonly SCANNER_APP_ID?: string;
    readonly SCANNER_FIELD_BUILD?: string;
  };
};

// The monotonic clock React Native provides.
declare const performance: { now(): number };
