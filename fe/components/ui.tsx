import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { colors, radius, space, type } from "../lib/theme";

/** The phone-sized card the whole app sits inside, matching the first screen. */
export function Screen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.canvas}>
      <View style={s.card}>
        <View style={s.header}>
          <Text style={s.title}>{title}</Text>
          {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        </View>
        <View style={s.body}>{children}</View>
      </View>
    </View>
  );
}

export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={s.input}
        placeholderTextColor={colors.inkFaint}
        {...props}
      />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  busy,
  disabled,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: "primary" | "ghost";
}) {
  const inactive = disabled || busy;
  const ghost = variant === "ghost";

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        s.button,
        ghost && s.buttonGhost,
        inactive && s.buttonDisabled,
        pressed && !inactive && s.buttonPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={ghost ? colors.ink : colors.onPrimary} />
      ) : (
        <Text style={[s.buttonLabel, ghost && s.buttonLabelGhost]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <View style={s.error}>
      <Text style={s.errorText}>{message}</Text>
    </View>
  );
}

/** Surfaces the code the API echoes back while EMAIL_PROVIDER=console. */
export function DevCode({ code }: { code: string }) {
  return (
    <View style={s.dev}>
      <Text style={s.devLabel}>DEV — code from API response</Text>
      <Text style={s.devCode}>{code}</Text>
    </View>
  );
}

export function Row({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value ?? "—"}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  canvas: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.canvas,
    padding: space.lg,
  },
  card: {
    width: 375,
    maxWidth: "100%",
    minHeight: 667,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
    padding: space.xl,
    gap: space.xl,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  header: { gap: space.xs, paddingTop: space.xxl },
  title: { ...type.title, color: colors.ink },
  subtitle: { ...type.body, color: colors.inkMuted },
  body: { gap: space.lg },
  field: { gap: space.sm },
  label: { ...type.label, color: colors.ink },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: 16,
    color: colors.ink,
    minHeight: 48,
  },
  hint: { ...type.caption, color: colors.inkFaint },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.lg,
  },
  buttonGhost: { backgroundColor: "transparent" },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.45 },
  buttonLabel: { ...type.label, fontSize: 15, color: colors.onPrimary },
  buttonLabelGhost: { color: colors.inkMuted },
  error: {
    backgroundColor: colors.dangerSurface,
    borderRadius: radius.sm,
    padding: space.md,
  },
  errorText: { ...type.body, color: colors.danger },
  dev: {
    backgroundColor: colors.devSurface,
    borderWidth: 1,
    borderColor: colors.devBorder,
    borderRadius: radius.sm,
    padding: space.md,
    gap: space.xs,
  },
  devLabel: { ...type.caption, color: colors.devInk, fontWeight: "600" },
  devCode: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 4,
    color: colors.devInk,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLabel: { ...type.body, color: colors.inkMuted },
  rowValue: { ...type.body, color: colors.ink, fontWeight: "600", flexShrink: 1 },
});
