// The gate screens keep the screen on: the validator stays mounted all night (design 3.3).

import { useKeepAwake } from "expo-keep-awake";
import { Redirect, Stack } from "expo-router";
import { useGate } from "../../gate-context.tsx";

export default function GateLayout() {
  useKeepAwake();
  const { phase } = useGate();
  if (phase.kind !== "ready") return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
