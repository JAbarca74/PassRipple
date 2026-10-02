// Root of the gate app: the gate session around every screen.

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GateProvider } from "../gate-context.tsx";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <GateProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </GateProvider>
    </SafeAreaProvider>
  );
}
