// Enrollment, step 2: the six-digit code sent by email.

import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useGate } from "../../gate-context.tsx";
import { failureText } from "../../lib/messages.ts";
import { setUserSession } from "../../lib/secure.ts";
import { Body, Button, ErrorText, Field, Screen, Title } from "../../ui/ui.tsx";

export default function EnrollCode() {
  const { api } = useGate();
  const { email } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const session = await api.verifySignIn(email ?? "", code.trim());
      await setUserSession(session.token);
      router.replace("/enroll/staff");
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Revise su correo</Title>
      <Body>Escriba el código de 6 dígitos que enviamos a {email}. Vence en 10 minutos.</Body>
      <Field
        testID="otp-input"
        label="Código"
        value={code}
        onChangeText={(text) => setCode(text.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
      />
      {error !== null && <ErrorText>{error}</ErrorText>}
      <Button
        testID="otp-submit"
        label="Continuar"
        busy={busy}
        disabled={code.length !== 6}
        onPress={() => void submit()}
      />
      <Button label="Usar otro correo" kind="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
