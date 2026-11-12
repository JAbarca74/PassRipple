// The document check of 12+, 18+ and named events (design 7.2, 7.4). The system cannot tell
// age from a Costa Rican ID number, so a person always checks the document: the screen shows
// the attendee's name and the document's last digits, and the operator confirms. A named
// ticket without its attendee gets one typed here, from the document in hand.

import type { AttendeeCapturePayload } from "@passripple/contracts";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { AttendeeCapture, IdCheck } from "../lib/gate-session.ts";
import { captureComplete, idCheckTitle } from "../lib/id-check.ts";
import { Button, colors } from "./ui.tsx";

const DOC_TYPES: readonly { value: AttendeeCapturePayload["docType"]; label: string }[] = [
  { value: "cedula", label: "Cédula" },
  { value: "dimex", label: "DIMEX" },
  { value: "pasaporte", label: "Pasaporte" },
  { value: "tim", label: "TIM" },
];

export function IdCheckPanel({
  check,
  typeName,
  busy,
  onConfirm,
  onDeny,
}: {
  readonly check: IdCheck;
  readonly typeName: string;
  readonly busy: boolean;
  readonly onConfirm: (capture: AttendeeCapture | null) => void;
  readonly onDeny: () => void;
}) {
  const needsCapture = check.named && check.attendee === null;
  const [name, setName] = useState("");
  const [docType, setDocType] = useState<AttendeeCapturePayload["docType"]>("cedula");
  const [last4, setLast4] = useState("");

  const confirm = () =>
    onConfirm(
      needsCapture
        ? { fullName: name.trim(), docType, docLast4: last4.trim().toUpperCase() }
        : null,
    );

  return (
    <View testID="id-check" style={styles.panel} accessibilityLiveRegion="assertive">
      <Text testID="id-check-title" style={styles.title}>
        {idCheckTitle(check)}
      </Text>
      <Text style={styles.type}>{typeName}</Text>
      {check.attendee !== null ? (
        <>
          <Text testID="id-check-name" style={styles.name}>
            {check.attendee.name}
          </Text>
          <Text style={styles.detail}>Documento terminado en {check.attendee.docLast4}</Text>
          <Text style={styles.hint}>Compare el nombre y los últimos dígitos con el documento.</Text>
        </>
      ) : needsCapture ? (
        <>
          <Text style={styles.hint}>Sin asistente asignado: anótelo del documento.</Text>
          <TextInput
            testID="id-check-capture-name"
            placeholder="Nombre completo"
            placeholderTextColor="#A8A8B3"
            value={name}
            onChangeText={setName}
            style={styles.input}
            autoCapitalize="words"
            maxLength={120}
          />
          <View style={styles.docTypes}>
            {DOC_TYPES.map((type) => (
              <Pressable
                key={type.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: docType === type.value }}
                onPress={() => setDocType(type.value)}
                style={[styles.docType, docType === type.value && styles.docTypeOn]}
              >
                <Text style={styles.docTypeText}>{type.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            testID="id-check-capture-last4"
            placeholder="Últimos 4 dígitos"
            placeholderTextColor="#A8A8B3"
            value={last4}
            onChangeText={setLast4}
            style={styles.input}
            autoCapitalize="characters"
            maxLength={4}
          />
        </>
      ) : (
        <Text style={styles.hint}>Revise que el documento muestre la edad requerida.</Text>
      )}
      <Button
        testID="id-check-confirm"
        label="Documento verificado"
        busy={busy}
        disabled={needsCapture && !captureComplete(name, last4)}
        onPress={confirm}
      />
      <Button testID="id-check-deny" label="No coincide" kind="secondary" onPress={onDeny} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: 20, padding: 20, gap: 10, backgroundColor: colors.warning },
  title: { color: "#FFF", fontSize: 26, fontWeight: "900" },
  type: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  name: { color: "#FFF", fontSize: 30, fontWeight: "900" },
  detail: { color: "#FFF", fontSize: 22, fontWeight: "800" },
  hint: { color: "#FFF", fontSize: 15, fontWeight: "600" },
  input: {
    minHeight: 48,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: "#FFF",
    color: colors.ink,
    fontSize: 18,
  },
  docTypes: { flexDirection: "row", gap: 6 },
  docType: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  docTypeOn: { backgroundColor: colors.ink },
  docTypeText: { color: "#FFF", fontWeight: "800" },
});
