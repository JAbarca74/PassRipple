// Enrollment, step 3: the staff code the organizer shared. It ties this phone to one event,
// role, zone and window (design 11.2). Play Integrity and App Attest would go with it as a
// signal; until their verifiers exist the phone sends none.

import * as Application from "expo-application";
import { router } from "expo-router";
import { useState } from "react";
import { Platform } from "react-native";
import { useGate } from "../../gate-context.tsx";
import { failureText } from "../../lib/messages.ts";
import { clearUserSession, getUserSession, saveEnrollment } from "../../lib/secure.ts";
import { Body, Button, ErrorText, Field, Screen, Title } from "../../ui/ui.tsx";

export default function EnrollStaffCode() {
  const { api, reload } = useGate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const userToken = await getUserSession();
      if (userToken === null) {
        router.replace("/enroll");
        return;
      }
      const enrolled = await api.enroll(userToken, {
        staffCode: code,
        platform: Platform.OS === "ios" ? "ios" : "android",
        appVersion: Application.nativeApplicationVersion ?? "0.0.0",
        integrityToken: null,
      });
      await saveEnrollment(enrolled.device, enrolled.deviceToken);
      // The person's session was only for enrolling; the device has its own from now on.
      await api.signOutUser(userToken).catch(() => {});
      await clearUserSession();
      await reload();
      router.replace("/download");
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Código de staff</Title>
      <Body>Escriba el código que le dio el organizador, por ejemplo 4K7NP-9XR2M.</Body>
      <Field
        testID="staff-code-input"
        label="Código de staff"
        value={code}
        onChangeText={(text) => setCode(text.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={16}
      />
      {error !== null && <ErrorText>{error}</ErrorText>}
      <Button
        testID="staff-code-submit"
        label="Unir este teléfono al evento"
        busy={busy}
        disabled={code.trim().length < 10}
        onPress={() => void submit()}
      />
    </Screen>
  );
}
