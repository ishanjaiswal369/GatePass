import { Link } from "expo-router";
import { type StyleProp, StyleSheet, Text, type TextStyle } from "react-native";
import { colors } from "@/theme";
import { inlineParts } from "./content";

/**
 * One paragraph of legal copy, with its `[label](target)` links live. Every
 * link is a router Link -- a real <a href> on web, so a reviewer's link
 * checker and a middle-click both work; a mailto: opens the mail app.
 */
export function LegalText({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={style}>
      {inlineParts(text).map((part, i) =>
        "href" in part ? (
          <Link key={i} href={part.href} style={s.link}>
            {part.text}
          </Link>
        ) : (
          <Text key={i}>{part.text}</Text>
        )
      )}
    </Text>
  );
}

const s = StyleSheet.create({
  link: { color: colors.accent, fontWeight: "600", textDecorationLine: "underline" },
});
