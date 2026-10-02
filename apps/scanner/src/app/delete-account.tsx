// Account erasure inside the app, as Google Play and the App Store require (design 14.7).
// The person confirms with a code sent to their email. If this phone is enrolled in an
// event, it signs out first, which is only possible with nothing left to upload (I6); then
// the account is erased on the server and the event's data leaves the phone.

import { router } from "expo-router";
import { useState } from "react";
import { useGate } from "../gate-context.tsx";
import { failureText } from "../lib/messages.ts";
import { Body, Button, ErrorText, Field, Screen, Title } from "../ui/ui.tsx";

type Step = "email" | "code" | "done";

export default function DeleteAccount() {
  const { api, phase, reload, syncNow } = useGate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = phase.kind === "ready" || phase.kind === "needs_manifest" ? phase.session : null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message === "pending operations"
          ? "Este teléfono tiene operaciones sin subir. Busque señal y sincronice antes de eliminar la cuenta."
          : failureText(failure),
      );
    } finally {
      setBusy(false);
    }
  }

  const sendCode = () =>
    run(async () => {
      await api.signIn(email.trim().toLowerCase());
      setStep("code");
    });

  const erase = () =>
    run(async () => {
      const userSession = await api.verifySignIn(email.trim().toLowerCase(), code.trim());
      if (session !== null) {
        await syncNow();
        await session.signOut();
      }
      await api.deleteAccount(userSession.token);
      setStep("done");
      await reload("Su cuenta fue eliminada.");
    });

  return (
    <Screen>
      <Title>Eliminar mi cuenta</Title>
      {step === "done" ? (
        <>
          <Body>
            Su cuenta fue eliminada. Se borraron su correo y los datos del evento de este teléfono.
          </Body>
          <Body muted>
            Las validaciones que hizo se conservan sin datos suyos, porque la municipalidad y la ley
            tributaria las exigen.
          </Body>
          <Button label="Listo" onPress={() => router.replace("/")} />
        </>
      ) : (
        <>
          <Body>
            Se borran su correo y el acceso de sus teléfonos. Las validaciones que hizo se conservan
            sin datos suyos, por obligaciones municipales y tributarias.
          </Body>
          {session !== null && (
            <Body muted>
              Este teléfono saldrá del evento. Solo se puede si todo está sincronizado.
            </Body>
          )}
          <Field
            testID="delete-email-input"
            label="Su correo"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={step === "email"}
          />
          {step === "code" && (
            <Field
              testID="delete-code-input"
              label="Código que le enviamos"
              value={code}
              onChangeText={(text) => setCode(text.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
            />
          )}
          {error !== null && <ErrorText>{error}</ErrorText>}
          {step === "email" ? (
            <Button
              testID="delete-send-code"
              label="Enviarme un código"
              busy={busy}
              disabled={!email.includes("@")}
              onPress={() => void sendCode()}
            />
          ) : (
            <Button
              testID="delete-confirm"
              label="Eliminar mi cuenta"
              kind="danger"
              busy={busy}
              disabled={code.length !== 6}
              onPress={() => void erase()}
            />
          )}
          <Button label="Volver" kind="secondary" onPress={() => router.back()} />
        </>
      )}
    </Screen>
  );
}
