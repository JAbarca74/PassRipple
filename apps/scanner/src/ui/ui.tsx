// Building blocks of the gate app's screens: large targets and high contrast, because the
// app is used at night, standing, often with one hand (design 9.6).

import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export const colors = {
  brand: "#5B1FE0",
  accent: "#00D1C7",
  valid: "#0F9D58",
  invalid: "#D93025",
  warning: "#F29900",
  ink: "#0B0B14",
  muted: "#5F6368",
  line: "#DADCE0",
  paper: "#FFFFFF",
  night: "#0B0B14",
  nightPaper: "#16161F",
  nightLine: "#2C2C38",
} as const;

export function usePalette() {
  const dark = useColorScheme() === "dark";
  return {
    dark,
    background: dark ? colors.night : colors.paper,
    surface: dark ? colors.nightPaper : "#F6F5FB",
    text: dark ? "#FFFFFF" : colors.ink,
    muted: dark ? "#A8A8B3" : colors.muted,
    line: dark ? colors.nightLine : colors.line,
  };
}

export function Screen({
  children,
  scroll = true,
}: {
  readonly children: ReactNode;
  readonly scroll?: boolean;
}) {
  const palette = usePalette();
  const body = <View style={styles.body}>{children}</View>;
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled">{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

export function Title({ children }: { readonly children: ReactNode }) {
  const palette = usePalette();
  return (
    <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted = false,
}: {
  readonly children: ReactNode;
  readonly muted?: boolean;
}) {
  const palette = usePalette();
  return (
    <Text style={[styles.body_text, { color: muted ? palette.muted : palette.text }]}>
      {children}
    </Text>
  );
}

export function ErrorText({ children }: { readonly children: ReactNode }) {
  return (
    <Text accessibilityLiveRegion="polite" style={styles.error}>
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  kind = "primary",
  busy = false,
  disabled = false,
  testID,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly kind?: "primary" | "secondary" | "danger";
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly testID?: string;
}) {
  const palette = usePalette();
  const background =
    kind === "primary" ? colors.brand : kind === "danger" ? colors.invalid : "transparent";
  const foreground = kind === "secondary" ? palette.text : "#FFFFFF";
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          borderColor: kind === "secondary" ? palette.line : background,
        },
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <Text style={[styles.buttonText, { color: foreground }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, ...input }: TextInputProps & { readonly label: string }) {
  const palette = usePalette();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={palette.muted}
        {...input}
        style={[
          styles.input,
          { color: palette.text, borderColor: palette.line, backgroundColor: palette.surface },
        ]}
      />
    </View>
  );
}

export function Row({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "ok" | "warn" | "bad";
}) {
  const palette = usePalette();
  const color =
    tone === "ok"
      ? colors.valid
      : tone === "warn"
        ? colors.warning
        : tone === "bad"
          ? colors.invalid
          : palette.text;
  return (
    <View style={[styles.row, { borderColor: palette.line }]}>
      <Text style={[styles.rowLabel, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color }]}>{value}</Text>
    </View>
  );
}

export function Centered({ children }: { readonly children?: ReactNode }) {
  const palette = usePalette();
  return <View style={[styles.centered, { backgroundColor: palette.background }]}>{children}</View>;
}

/** "hace 3 min", for sync times. */
export function ago(ms: number | null, now = Date.now()): string {
  if (ms === null) return "nunca";
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.round(minutes / 60)} h`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 20, gap: 16 },
  title: { fontSize: 28, fontWeight: "900", letterSpacing: -0.5 },
  body_text: { fontSize: 17, lineHeight: 24 },
  error: { color: colors.invalid, fontSize: 16, fontWeight: "700" },
  button: {
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  buttonText: { fontSize: 18, fontWeight: "800" },
  field: { gap: 6 },
  label: { fontSize: 15, fontWeight: "700" },
  input: { minHeight: 56, borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, fontSize: 20 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  rowLabel: { fontSize: 16 },
  rowValue: { fontSize: 16, fontWeight: "800", flexShrink: 1, textAlign: "right" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
});
