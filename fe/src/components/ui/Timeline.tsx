import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme";
import { CheckIcon } from "./Icon";

export interface TimelineStep {
  title: string;
  sub?: string | null;
  /** done: happened; next: the one being waited on; todo: after that. */
  state: "done" | "next" | "todo";
}

/**
 * What has happened to something and what happens next -- a booking from
 * payment to departure, a refund from cancellation to arrival. Read top to
 * bottom; the hollow ring is where things stand now.
 */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <View>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <View key={step.title} style={s.row}>
            <View style={s.rail}>
              {step.state === "done" ? (
                <View style={s.done}>
                  <CheckIcon size={12} color={colors.onInk} />
                </View>
              ) : (
                <View style={[s.ring, step.state === "todo" && s.ringTodo]} />
              )}
              {last ? null : (
                <View style={[s.line, step.state === "done" && s.lineDone]} />
              )}
            </View>
            <View style={[s.copy, !last && s.copyGap]}>
              <Text style={[s.title, step.state === "todo" && s.todo]}>{step.title}</Text>
              {step.sub ? <Text style={s.sub}>{step.sub}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const GREEN = "#166534";

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 12 },
  rail: { width: 22, alignItems: "center" },
  done: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.ink },
  ringTodo: { borderColor: colors.border },
  line: { flex: 1, width: 2, minHeight: 18, backgroundColor: colors.border },
  lineDone: { backgroundColor: GREEN },
  copy: { flex: 1, gap: 2 },
  copyGap: { paddingBottom: 14 },
  title: { fontSize: 14, fontWeight: "700", color: colors.ink },
  todo: { fontWeight: "600", color: colors.inkMuted },
  sub: { fontSize: 12, lineHeight: 17, color: colors.inkMuted },
});
