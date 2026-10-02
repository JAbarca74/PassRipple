// What the supervisor sees per device (design 8.10): pending operations, last sync, the
// circuit breaker, quarantine, the manifest's age and the clock correction.

import { router } from "expo-router";
import { useState } from "react";
import { useGate } from "../../gate-context.tsx";
import { ago, Body, Button, Row, Screen, Title } from "../../ui/ui.tsx";

const CIRCUIT_TEXT = {
  closed: "Normal",
  open: "Sin señal: reintenta en un minuto",
  half_open: "Probando la señal",
} as const;
const DEVICE_TEXT = { active: "Activo", revoked: "Revocado", expired: "Vencido" } as const;

export default function Status() {
  const { status, syncNow } = useGate();
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    try {
      await syncNow();
    } finally {
      setBusy(false);
    }
  }

  if (status === null) return null;
  const { outbox } = status;
  return (
    <Screen>
      <Title>Estado del teléfono</Title>
      <Row
        label="Por sincronizar"
        value={String(outbox.pending + outbox.sending)}
        tone={outbox.pending + outbox.sending === 0 ? "ok" : "warn"}
      />
      <Row
        label="En cuarentena"
        value={String(outbox.quarantined)}
        tone={outbox.quarantined === 0 ? "ok" : "bad"}
      />
      <Row label="Última sincronización" value={ago(status.lastSyncAt)} />
      <Row
        label="Conexión"
        value={CIRCUIT_TEXT[outbox.circuit]}
        tone={outbox.circuit === "closed" ? "ok" : "warn"}
      />
      {outbox.lastError !== null && <Row label="Último error" value={outbox.lastError} />}
      <Row label="Lista de entradas" value={ago(status.lastManifestAt)} />
      <Row label="Entradas usadas" value={`${status.admitted} de ${status.tickets}`} />
      <Row
        label="Reloj"
        value={`${status.clockOffsetMs >= 0 ? "+" : ""}${Math.round(status.clockOffsetMs / 1000)} s${status.clockSynced ? "" : " (sin verificar)"}`}
        tone={status.clockSynced ? "ok" : "warn"}
      />
      <Row
        label="Este teléfono"
        value={DEVICE_TEXT[status.device.status]}
        tone={status.device.status === "active" ? "ok" : "bad"}
      />
      {status.expiresAt !== null && (
        <Row label="Vence" value={new Date(status.expiresAt).toLocaleString("es-CR")} />
      )}
      {outbox.quarantined > 0 && (
        <Body>
          Hay operaciones que el servidor no aceptó. No se pierden: avise al organizador para que
          las revise.
        </Body>
      )}
      <Button testID="sync-now" label="Sincronizar ahora" busy={busy} onPress={() => void sync()} />
      <Button label="Volver" kind="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
