import { useRef } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius, space } from "@/theme";

const LENGTH = 6;

/**
 * Six boxes over one hidden input. Keeping a single input means paste, native
 * SMS autofill and backspace all behave, which per-box inputs break.
 */
export function CodeInput({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<TextInput>(null);
  const digits = value.padEnd(LENGTH).split("");
  const cursor = Math.min(value.length, LENGTH - 1);

  return (
    <Pressable onPress={() => inputRef.current?.focus()} style={s.wrap}>
      {digits.map((digit, index) => {
        const filled = digit.trim().length > 0;
        const active = index === cursor && value.length < LENGTH;

        return (
          <View
            key={index}
            style={[s.box, (filled || active) && s.boxActive]}
          >
            {filled ? (
              <Text style={s.digit}>{digit}</Text>
            ) : active ? (
              <View style={s.caret} />
            ) : null}
          </View>
        );
      })}

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(next) =>
          onChange(next.replace(/\D/g, "").slice(0, LENGTH))
        }
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={LENGTH}
        autoFocus={autoFocus}
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        style={s.hidden}
      />
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: "row", gap: 9 },
  box: {
    flexGrow: 1,
    height: 58,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md - 2,
    alignItems: "center",
    justifyContent: "center",
  },
  boxActive: { borderWidth: 2, borderColor: colors.borderStrong },
  digit: { fontSize: 24, fontWeight: "700", color: colors.ink },
  caret: { width: 2, height: 26, backgroundColor: colors.ink },
  hidden: {
    position: "absolute",
    opacity: 0,
    width: "100%",
    height: "100%",
    // Keeps the caret off-screen on web while the element stays focusable.
    left: 0,
    top: 0,
    padding: space.xs,
  },
});
