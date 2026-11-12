// Continuous scanning (design 4.4, 6.3, 6.5). Each read is decided on the phone, stored and
// queued before the screen turns green; the network is never awaited. Bursts of one
// buyer's tickets show "3 de 4 válidas".

import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useGate, useReadySession } from "../../gate-context.tsx";
import type { AttendeeCapture, IdCheck, ScanOutcome } from "../../lib/gate-session.ts";
import type { GateDecision } from "../../lib/verify.ts";
import { REJECTION_TEXT } from "../../lib/verify.ts";
import { perfLog, perfNow, perfSummary } from "../../perf.ts";
import { IdCheckPanel } from "../../ui/id-check.tsx";
import { ago, Body, Button, Centered, colors, Title } from "../../ui/ui.tsx";

const VERDICT_MS = 2_500;
// After a verdict the camera ignores every read for this long, so sweeping across several QR
// codes does not flash a verdict for each one (field test, Phase 2).
const SCAN_COOLDOWN_MS = 1_200;
const E2E = process.env.EXPO_PUBLIC_E2E === "1";

/** A scan of a 12+, 18+ or named event waiting for the operator's document check (7.4). */
interface PendingCheck {
  readonly decision: Extract<GateDecision, { kind: "admit" }>;
  readonly check: IdCheck;
}

const DENIED = {
  color: colors.invalid,
  title: "NO PASA",
  detail: "El documento no coincide o no cumple la edad.",
};

function verdictView(outcome: ScanOutcome) {
  const { decision, burst } = outcome;
  if (decision.kind === "reject") {
    return { color: colors.invalid, title: "NO VÁLIDA", detail: REJECTION_TEXT[decision.reason] };
  }
  const group =
    burst !== null && burst.total > 1 ? `${burst.admitted} de ${burst.total} válidas` : null;
  if (!decision.inManifest) {
    return {
      color: colors.warning,
      title: "VÁLIDA",
      detail: `${decision.typeName}. Comprada después de descargar el evento: se revisa al sincronizar.${group ? ` ${group}.` : ""}`,
    };
  }
  return { color: colors.valid, title: group ?? "VÁLIDA", detail: decision.typeName };
}

export default function Scan() {
  const session = useReadySession();
  const { status, refreshStatus } = useGate();
  const [permission, requestPermission] = useCameraPermissions();
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [pendingCheck, setPendingCheck] = useState<PendingCheck | null>(null);
  const [denied, setDenied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [e2eText, setE2eText] = useState("");
  const busy = useRef(false);
  const cooldownUntil = useRef(0);
  const [perfText, setPerfText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const handle = useCallback(
    async (text: string) => {
      perfLog("camera_event", perfNow());
      if (perfSummary() !== null) setPerfText(perfSummary());
      if (
        session === null ||
        busy.current ||
        pendingCheck !== null ||
        performance.now() < cooldownUntil.current
      )
        return;
      busy.current = true;
      const scanStart = perfNow();
      try {
        const result = await session.scanQr(text);
        perfLog("scan_total_ms", perfNow() - scanStart);
        if (result === null) return;
        cooldownUntil.current = performance.now() + SCAN_COOLDOWN_MS;
        if (result.idCheck !== undefined && result.decision.kind === "admit") {
          // No green yet: the operator checks the document first, with no time limit.
          if (timer.current !== null) clearTimeout(timer.current);
          setOutcome(null);
          setDenied(false);
          setPendingCheck({ decision: result.decision, check: result.idCheck });
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          return;
        }
        setOutcome(result);
        void Haptics.notificationAsync(
          result.decision.kind === "admit"
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Error,
        );
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setOutcome(null), VERDICT_MS);
        void refreshStatus();
      } finally {
        busy.current = false;
      }
    },
    [session, refreshStatus, pendingCheck],
  );

  const showFor = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setOutcome(null);
      setDenied(false);
    }, VERDICT_MS);
  }, []);

  const confirmCheck = useCallback(
    async (capture: AttendeeCapture | null) => {
      if (session === null || pendingCheck === null) return;
      setConfirming(true);
      try {
        const result = await session.confirmIdCheck(pendingCheck.decision, capture);
        setPendingCheck(null);
        setOutcome(result);
        void Haptics.notificationAsync(
          result.decision.kind === "admit"
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Error,
        );
        cooldownUntil.current = performance.now() + SCAN_COOLDOWN_MS;
        showFor();
        void refreshStatus();
      } finally {
        setConfirming(false);
      }
    },
    [session, pendingCheck, refreshStatus, showFor],
  );

  const denyCheck = useCallback(() => {
    setPendingCheck(null);
    setOutcome(null);
    setDenied(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    cooldownUntil.current = performance.now() + SCAN_COOLDOWN_MS;
    showFor();
  }, [showFor]);

  if (session === null) return null;
  if (permission === null) return <Centered />;
  if (!permission.granted) {
    return (
      <Centered>
        <Title>Permiso de cámara</Title>
        <Body>
          La cámara lee los códigos QR de las entradas. Las imágenes no se guardan ni se envían.
        </Body>
        <Button label="Permitir la cámara" onPress={() => void requestPermission()} />
        <Button
          label="Digitar un código"
          kind="secondary"
          onPress={() => router.push("/gate/manual")}
        />
      </Centered>
    );
  }

  const pending = status === null ? 0 : status.outbox.pending + status.outbox.sending;
  const verdict = denied ? DENIED : outcome === null ? null : verdictView(outcome);

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={status?.over ? undefined : (result) => void handle(result.data)}
      />
      {perfText !== null && (
        <Text
          style={{
            position: "absolute",
            top: 40,
            left: 8,
            color: "#0f0",
            backgroundColor: "#000a",
            padding: 4,
            fontSize: 11,
          }}
        >
          {perfText}
        </Text>
      )}
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.top}>
          <Text style={styles.event} numberOfLines={1}>
            {status?.eventName ?? ""}
          </Text>
          {status?.over && (
            <Text testID="gate-closed" style={styles.closed}>
              Este teléfono ya no valida. Subiendo lo pendiente antes de borrar el evento.
            </Text>
          )}
        </View>

        {pendingCheck !== null && (
          <IdCheckPanel
            check={pendingCheck.check}
            typeName={pendingCheck.decision.typeName}
            busy={confirming}
            onConfirm={(capture) => void confirmCheck(capture)}
            onDeny={denyCheck}
          />
        )}

        {pendingCheck === null && verdict !== null && (
          <View
            testID="verdict"
            style={[styles.verdict, { backgroundColor: verdict.color }]}
            accessibilityLiveRegion="assertive"
          >
            <Text testID="verdict-title" style={styles.verdictTitle}>
              {verdict.title}
            </Text>
            <Text testID="verdict-detail" style={styles.verdictDetail}>
              {verdict.detail}
            </Text>
          </View>
        )}

        {E2E && (
          <View style={styles.e2e}>
            <TextInput
              testID="e2e-qr-input"
              value={e2eText}
              onChangeText={setE2eText}
              style={styles.e2eInput}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
            />
            <Button
              testID="e2e-qr-submit"
              label="Escanear"
              onPress={() => {
                void handle(e2eText);
                setE2eText("");
              }}
            />
          </View>
        )}

        <View style={styles.bottom}>
          <Pressable
            testID="open-status"
            accessibilityRole="button"
            onPress={() => router.push("/gate/status")}
            style={styles.pill}
          >
            <Text style={styles.pillText}>
              {pending === 0 ? "Todo sincronizado" : `${pending} por sincronizar`} ·{" "}
              {ago(status?.lastSyncAt ?? null)}
            </Text>
            {status !== null && status.outbox.circuit !== "closed" && (
              <Text style={styles.pillWarn}>Sin señal</Text>
            )}
          </Pressable>
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button
                testID="open-manual"
                label="Digitar código"
                kind="secondary"
                onPress={() => router.push("/gate/manual")}
              />
            </View>
            <View style={styles.action}>
              <Button
                testID="open-account"
                label="Cuenta"
                kind="secondary"
                onPress={() => router.push("/gate/account")}
              />
            </View>
          </View>
          <Text style={styles.count}>
            {status ? `${status.admitted} de ${status.tickets} entradas usadas` : ""}
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  overlay: { flex: 1, justifyContent: "space-between", padding: 16 },
  top: { gap: 8 },
  event: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "800",
    textShadowColor: "#000",
    textShadowRadius: 6,
  },
  closed: {
    color: "#FFF",
    backgroundColor: colors.warning,
    padding: 12,
    borderRadius: 12,
    fontSize: 16,
    fontWeight: "800",
  },
  verdict: { borderRadius: 20, padding: 24, gap: 8 },
  verdictTitle: { color: "#FFF", fontSize: 40, fontWeight: "900" },
  verdictDetail: { color: "#FFF", fontSize: 20, fontWeight: "700" },
  e2e: { gap: 8, backgroundColor: "#FFF", padding: 8, borderRadius: 12 },
  e2eInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  bottom: { gap: 10, backgroundColor: "rgba(11,11,20,0.85)", borderRadius: 20, padding: 12 },
  pill: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 44,
  },
  pillText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  pillWarn: { color: colors.warning, fontSize: 14, fontWeight: "800" },
  actions: { flexDirection: "row", gap: 10 },
  action: { flex: 1 },
  count: { color: "#A8A8B3", fontSize: 14, textAlign: "center" },
});
