import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { colors, space } from "@/theme";
import { business, legalPages, operatorLine } from "./content";

/**
 * Every public page, and who runs GatePass: the footer of each legal page,
 * and -- in `compact` form -- the foot of the sign-in screen, which is the
 * first thing anyone opening the site sees. Payment-gateway reviewers look
 * for exactly these links and this line on the landing page.
 */
export function LegalLinks({ compact = false }: { compact?: boolean }) {
  return (
    <View style={s.wrap}>
      <View style={s.links}>
        {legalPages.map((page) => (
          <Link key={page.slug} href={`/${page.slug}`} style={[s.link, compact && s.linkCompact]}>
            {compact ? page.short : page.nav}
          </Link>
        ))}
      </View>

      <Text style={[s.line, compact && s.lineCompact]}>{operatorLine}</Text>
      <Text style={[s.line, compact && s.lineCompact]}>
        <Link href={`mailto:${business.email}`} style={s.mail}>
          {business.email}
        </Link>
        {`  ·  © ${business.year} ${business.brand}`}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: "center", gap: space.xs },
  links: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    columnGap: space.lg,
  },
  // The vertical padding is the tap target: 13px text + 2 x 12 clears 44 once
  // line height is counted.
  link: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
    paddingVertical: 12,
    textDecorationLine: "underline",
  },
  linkCompact: { fontSize: 12, color: colors.inkMuted },
  line: { fontSize: 12, lineHeight: 18, color: colors.inkMuted, textAlign: "center" },
  lineCompact: { color: colors.inkFaint },
  mail: { color: colors.inkMuted, textDecorationLine: "underline" },
});
