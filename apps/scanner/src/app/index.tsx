// Sends the phone where it belongs: enrollment, manifest download or the gate.

import { Redirect } from "expo-router";
import { ActivityIndicator } from "react-native";
import { useGate } from "../gate-context.tsx";
import { Body, Button, Centered, Title } from "../ui/ui.tsx";

export default function Index() {
  const { phase, reload } = useGate();
  switch (phase.kind) {
    case "loading":
      return (
        <Centered>
          <ActivityIndicator size="large" />
        </Centered>
      );
    case "unenrolled":
      return <Redirect href="/enroll" />;
    case "needs_manifest":
      return <Redirect href="/download" />;
    case "ready":
      return <Redirect href="/gate" />;
    case "error":
      return (
        <Centered>
          <Title>No se pudo abrir el evento</Title>
          <Body muted>{phase.message}</Body>
          <Button label="Reintentar" onPress={() => void reload()} />
        </Centered>
      );
  }
}
