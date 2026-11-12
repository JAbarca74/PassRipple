// Door sales (design 10.6): the person pays the organizer at the door, in cash or by SINPE to
// the organizer's own number, and the operator takes a ticket from this device's block. The
// sale and the admission are stored and queued before the screen answers, with or without
// signal. The ticket's code is shown so the person can keep it.

import type { DoorSalePayload, ManifestTicketType } from "@passripple/contracts";
import { formatHumanCode } from "@passripple/crypto";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useGate, useReadySession } from "../../gate-context.tsx";
import { captureComplete } from "../../lib/id-check.ts";
import { Body, Button, colors, ErrorText, Field, Row, Screen, Title } from "../../ui/ui.tsx";

const METHODS: readonly { value: DoorSalePayload["method"]; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "sinpe", label: "SINPE al organizador" },
];

export default function Sell() {
  const session = useReadySession();
  const { refreshStatus } = useGate();
  const [types, setTypes] = useState<readonly ManifestTicketType[]>([]);
  const [stock, setStock] = useState<ReadonlyMap<number, number>>(new Map());
  const [named, setNamed] = useState(false);
  const [typeRef, setTypeRef] = useState<number | null>(null);
  const [method, setMethod] = useState<DoorSalePayload["method"]>("cash");
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [last4, setLast4] = useState("");
  const [sold, setSold] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (session === null) return;
    const [all, left, info] = await Promise.all([
      session.manifest.ticketTypes(),
      session.manifest.stock(),
      session.manifest.info(),
    ]);
    const withStock = [...all.values()].filter((type) => left.has(type.ref));
    setTypes(withStock);
    setStock(left);
    setNamed(info?.event.namedTickets ?? false);
    setTypeRef((current) => current ?? withStock[0]?.ref ?? null);
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (session === null) return null;
  if (!session.sellsAtDoor()) {
    return (
      <Screen>
        <Title>Venta en puerta</Title>
        <Body>Este teléfono no tiene el rol de venta en puerta.</Body>
        <Button label="Volver" kind="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const amountCrc = Number(amount);
  const ready =
    typeRef !== null &&
    Number.isInteger(amountCrc) &&
    amountCrc >= 0 &&
    amount.trim() !== "" &&
    (!named || captureComplete(name, last4));

  async function sell() {
    if (session === null || typeRef === null || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const ticket = await session.sellAtDoor(
        typeRef,
        { method, amountCrc },
        named
          ? { fullName: name.trim(), docType: "cedula", docLast4: last4.trim().toUpperCase() }
          : null,
      );
      if (ticket === null) {
        setError("No quedan entradas de ese tipo en el bloque de este teléfono.");
      } else {
        setSold(ticket.codeHuman);
        setName("");
        setLast4("");
      }
      await load();
      void refreshStatus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Venta en puerta</Title>
      {sold !== null && (
        <View testID="sold" style={styles.sold}>
          <Text style={styles.soldTitle}>VENDIDA · PUEDE PASAR</Text>
          <Text style={styles.code}>{formatHumanCode(sold)}</Text>
          <Text style={styles.soldHint}>Dígale el código o que le tome una foto.</Text>
        </View>
      )}
      {types.length === 0 ? (
        <Body>
          Este teléfono no tiene entradas para vender. El organizador asigna un bloque desde su
          panel; luego sincronice.
        </Body>
      ) : (
        <>
          <Text style={styles.label}>Tipo de entrada</Text>
          {types.map((type) => (
            <Pressable
              key={type.ref}
              accessibilityRole="radio"
              accessibilityState={{ selected: typeRef === type.ref }}
              onPress={() => setTypeRef(type.ref)}
              style={[styles.option, typeRef === type.ref && styles.optionOn]}
            >
              <Text style={styles.optionText}>{type.name}</Text>
              <Text style={styles.optionText}>Quedan {stock.get(type.ref) ?? 0}</Text>
            </Pressable>
          ))}
          <Text style={styles.label}>Cómo pagó</Text>
          <View style={styles.methods}>
            {METHODS.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: method === option.value }}
                onPress={() => setMethod(option.value)}
                style={[styles.option, styles.method, method === option.value && styles.optionOn]}
              >
                <Text style={styles.optionText}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
          <Field
            testID="sell-amount"
            label="Monto cobrado (colones)"
            value={amount}
            onChangeText={(text) => setAmount(text.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            maxLength={7}
          />
          {named && (
            <>
              <Body muted>
                Evento nominativo: anote el nombre y los últimos dígitos de la cédula.
              </Body>
              <Field label="Nombre completo" value={name} onChangeText={setName} maxLength={120} />
              <Field
                label="Últimos 4 dígitos"
                value={last4}
                onChangeText={setLast4}
                autoCapitalize="characters"
                maxLength={4}
              />
            </>
          )}
          {error !== null && <ErrorText>{error}</ErrorText>}
          <Button
            testID="sell-confirm"
            label="Cobrado: vender y dejar pasar"
            busy={busy}
            disabled={!ready}
            onPress={() => void sell()}
          />
          <Row label="El dinero" value="Lo recibe el organizador, no PassRipple" />
        </>
      )}
      <Button label="Volver a escanear" kind="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: "800", color: colors.muted },
  option: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.line,
    paddingHorizontal: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  optionOn: { borderColor: colors.brand },
  optionText: { fontSize: 17, fontWeight: "700", color: colors.ink },
  methods: { flexDirection: "row", gap: 8 },
  method: { flex: 1, justifyContent: "center" },
  sold: { borderRadius: 20, padding: 20, gap: 6, backgroundColor: colors.valid },
  soldTitle: { color: "#FFF", fontSize: 22, fontWeight: "900" },
  code: { color: "#FFF", fontSize: 36, fontWeight: "900", letterSpacing: 2 },
  soldHint: { color: "#FFF", fontSize: 15, fontWeight: "600" },
});
