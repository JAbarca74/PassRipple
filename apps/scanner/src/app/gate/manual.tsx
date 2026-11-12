// Manual entry of the human code when the camera cannot read the QR (design 6.7). The code
// is static, so the screen shows what ticket it is and asks the operator to confirm, and
// failed attempts lock entry for a while. In 12+, 18+ and named events the operator also
// checks the document against the attendee (7.4), or types the attendee if missing.

import { formatHumanCode } from "@passripple/crypto";
import { router } from "expo-router";
import { useState } from "react";
import { useGate, useReadySession } from "../../gate-context.tsx";
import type { AttendeeCapture, IdCheck, ManualLookup } from "../../lib/gate-session.ts";
import type { GateDecision } from "../../lib/verify.ts";
import { REJECTION_TEXT } from "../../lib/verify.ts";
import { IdCheckPanel } from "../../ui/id-check.tsx";
import { Body, Button, ErrorText, Field, Row, Screen, Title } from "../../ui/ui.tsx";

function lockText(ms: number): string {
  return `Demasiados intentos fallidos. Espere ${Math.ceil(ms / 1000)} s.`;
}

export default function ManualEntry() {
  const session = useReadySession();
  const { refreshStatus } = useGate();
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState<ManualLookup | null>(null);
  const [result, setResult] = useState<GateDecision | null>(null);
  const [check, setCheck] = useState<IdCheck | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  if (session === null) return null;

  async function find() {
    if (session === null) return;
    setBusy(true);
    setResult(null);
    try {
      const found = await session.findByCode(code);
      setLookup(found);
      setDenied(false);
      setCheck(
        found.kind === "found" && found.decision.kind === "admit"
          ? await session.idCheckForTicket(found.ticket)
          : null,
      );
    } finally {
      setBusy(false);
    }
  }

  async function admit(idChecked = false, capture: AttendeeCapture | null = null) {
    if (session === null || lookup?.kind !== "found") return;
    setBusy(true);
    try {
      setResult(await session.admitManual(lookup.ticket, idChecked, capture));
      setLookup(null);
      setCheck(null);
      setCode("");
      void refreshStatus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Digitar código</Title>
      <Body muted>
        El código de 10 caracteres está debajo del QR en la entrada, por ejemplo 4K7NP-9XR2M.
      </Body>
      <Field
        testID="manual-code-input"
        label="Código de la entrada"
        value={code}
        onChangeText={(text) => {
          setCode(text.toUpperCase());
          setLookup(null);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={14}
      />
      <Button
        testID="manual-find"
        label="Buscar"
        busy={busy}
        disabled={code.trim().length < 10}
        onPress={() => void find()}
      />

      {lookup?.kind === "invalid_code" && (
        <ErrorText>El código está mal escrito. Revíselo letra por letra.</ErrorText>
      )}
      {lookup?.kind === "not_found" && (
        <ErrorText>No hay ninguna entrada con ese código en este evento.</ErrorText>
      )}
      {lookup !== null && lookup.kind !== "found" && lookup.lockedForMs > 0 && (
        <ErrorText>{lockText(lookup.lockedForMs)}</ErrorText>
      )}
      {lookup?.kind === "locked" && lookup.lockedForMs === 0 && (
        <ErrorText>{REJECTION_TEXT.gate_closed}</ErrorText>
      )}

      {lookup?.kind === "found" && (
        <>
          <Row label="Código" value={formatHumanCode(lookup.ticket.codeHuman)} />
          <Row label="Tipo" value={lookup.decision.typeName ?? "Entrada"} />
          {lookup.decision.kind === "admit" && check !== null ? (
            <IdCheckPanel
              check={check}
              typeName={lookup.decision.typeName}
              busy={busy}
              onConfirm={(capture) => void admit(true, capture)}
              onDeny={() => {
                setLookup(null);
                setCheck(null);
                setDenied(true);
              }}
            />
          ) : lookup.decision.kind === "admit" ? (
            <>
              <Body>Confirme que la persona tiene esta entrada antes de dejarla pasar.</Body>
              <Button
                testID="manual-admit"
                label="Dejar pasar"
                busy={busy}
                onPress={() => void admit()}
              />
            </>
          ) : (
            <ErrorText>{REJECTION_TEXT[lookup.decision.reason]}</ErrorText>
          )}
        </>
      )}

      {denied && <ErrorText>No pasa: el documento no coincide o no cumple la edad.</ErrorText>}
      {result !== null && (
        <Body>
          {result.kind === "admit"
            ? `✅ ${result.typeName}: puede pasar.`
            : `❌ ${REJECTION_TEXT[result.reason]}`}
        </Body>
      )}
      <Button label="Volver a escanear" kind="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
