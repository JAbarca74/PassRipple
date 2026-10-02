// Signing this phone out of the event. Not allowed while anything waits to be uploaded:
// the phone must never lose a scan it recorded (design 8.9, invariant I6).

import { router } from "expo-router";
import { useState } from "react";
import { useGate, useReadySession } from "../../gate-context.tsx";
import { failureText } from "../../lib/messages.ts";
import { Body, Button, ErrorText, Screen, Title } from "../../ui/ui.tsx";

export default function Account() {
  const session = useReadySession();
  const { status, reload, syncNow } = useGate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session === null || status === null) return null;
  const waiting = status.outbox.pending + status.outbox.sending + status.outbox.quarantined;

  async function signOut() {
    if (session === null) return;
    setBusy(true);
    setError(null);
    try {
      await syncNow();
      if (!(await session.isQueueEmpty())) {
        setError("Todavía hay operaciones sin subir. Busque señal y sincronice antes de salir.");
        return;
      }
      await session.signOut();
      await reload("Salió del evento. Se borraron sus datos de este teléfono.");
      router.replace("/");
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Cuenta</Title>
      <Body>
        Al salir del evento, este teléfono borra la lista de entradas y deja de validar. Solo se
        puede salir cuando todo está sincronizado.
      </Body>
      {waiting > 0 && (
        <ErrorText>
          {waiting} operación(es) sin subir. No puede salir hasta sincronizarlas.
        </ErrorText>
      )}
      {error !== null && <ErrorText>{error}</ErrorText>}
      <Button
        testID="sign-out"
        label="Salir del evento"
        kind="danger"
        busy={busy}
        disabled={waiting > 0}
        onPress={() => void signOut()}
      />
      <Button label="Volver" kind="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
