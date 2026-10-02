// Enrollment, step 1: the staff member's email, where a sign-in code goes (design 11.2).

import { router } from "expo-router";
import { useState } from "react";
import { useGate } from "../../gate-context.tsx";
import { failureText } from "../../lib/messages.ts";
import { Body, Button, ErrorText, Field, Screen, Title } from "../../ui/ui.tsx";

export default function EnrollEmail() {
  const { api, phase } = useGate();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const normalized = email.trim().toLowerCase();
      await api.signIn(normalized);
      router.push({ pathname: "/enroll/code", params: { email: normalized } });
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Validar entradas</Title>
      {phase.kind === "unenrolled" && phase.notice !== null && <Body muted>{phase.notice}</Body>}
      <Body>Escriba su correo. Le enviamos un código para entrar.</Body>
      <Field
        testID="email-input"
        label="Correo"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        inputMode="email"
        returnKeyType="send"
        onSubmitEditing={() => void submit()}
      />
      {error !== null && <ErrorText>{error}</ErrorText>}
      <Button
        testID="email-submit"
        label="Enviarme un código"
        busy={busy}
        disabled={!email.includes("@")}
        onPress={() => void submit()}
      />
    </Screen>
  );
}
