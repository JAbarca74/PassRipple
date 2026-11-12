// Downloads the event's manifest, with signal, before the event (design 8.2): the phone then
// validates all night without a network.

import { router } from "expo-router";
import { useState } from "react";
import { useGate } from "../gate-context.tsx";
import { failureText } from "../lib/messages.ts";
import { Body, Button, ErrorText, Screen, Title } from "../ui/ui.tsx";

export default function Download() {
  const { phase, reload } = useGate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = phase.kind === "needs_manifest" || phase.kind === "ready" ? phase.session : null;

  async function download() {
    if (session === null) return;
    setBusy(true);
    setError(null);
    try {
      await session.downloadManifest();
      await reload();
      router.replace("/gate");
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Descargar el evento</Title>
      <Body>
        Este teléfono descarga la lista de entradas del evento y la guarda cifrada. Hágalo con buena
        señal, por ejemplo en casa el día anterior. Después puede validar toda la noche sin
        internet.
      </Body>
      {error !== null && <ErrorText>{error}</ErrorText>}
      <Button
        testID="download-manifest"
        label="Descargar ahora"
        busy={busy}
        disabled={session === null}
        onPress={() => void download()}
      />
    </Screen>
  );
}
