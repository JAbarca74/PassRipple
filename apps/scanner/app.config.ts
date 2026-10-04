// Expo configuration of the gate app. Native projects are generated from it with
// `expo prebuild` (Continuous Native Generation) and never committed. Nothing here is a
// secret; the API address comes from the environment (`.env`, from `.env.example`).
import type { ExpoConfig } from "expo/config";

const appId = process.env.SCANNER_APP_ID ?? "com.passripple.scanner";

const config: ExpoConfig = {
  name: "PassRipple Puerta",
  slug: "passripple-scanner",
  scheme: "passripple-scanner",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  // Brand icons, exported from the SVG sources in brand/ (brand/README.md).
  icon: "../../brand/png/app-icon-1024.png",
  ios: {
    bundleIdentifier: appId,
    supportsTablet: false,
    infoPlist: {
      // The gate works in the foreground with the screen on (design 8.8).
      UIRequiresFullScreen: true,
    },
  },
  android: {
    package: appId,
    adaptiveIcon: {
      foregroundImage: "../../brand/png/adaptive-icon-foreground.png",
      monochromeImage: "../../brand/png/adaptive-icon-monochrome.png",
      backgroundColor: "#5B1FE0",
    },
    // The encrypted event database and its key must never leave the phone in a backup.
    allowBackup: false,
    blockedPermissions: ["android.permission.RECORD_AUDIO"],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-camera",
      {
        cameraPermission: "PassRipple usa la cámara para leer los códigos QR de las entradas.",
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
  ],
  experiments: {
    typedRoutes: false,
  },
};

export default config;
