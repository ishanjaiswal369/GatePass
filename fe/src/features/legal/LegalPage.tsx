import { router } from "expo-router";
import { useEffect } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { PhoneFrame, ScreenHeader } from "@/components/ui";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { colors, radius, space } from "@/theme";
import { business, fill, type LegalBlock, legalPage, type LegalSlug } from "./content";
import { LegalLinks } from "./LegalLinks";
import { LegalText } from "./LegalText";

/**
 * A public page (About, Terms, Refunds, ...), readable without an account.
 * Drawn like every other screen: PhoneFrame, the dark header, a back button.
 *
 * Back goes to the previous screen, or -- for someone who opened the page's
 * URL directly, with nothing behind it -- to the app's front door.
 */
export function LegalPage({ slug }: { slug: LegalSlug }) {
  const page = legalPage(slug);
  const insets = useScreenInsets();

  useDocumentHead(`${page.title} | ${business.brand}`, fill(page.intro));

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader
          title={page.title}
          sub={`Last updated ${business.lastUpdated}`}
          onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        />

        <ScrollView contentContainerStyle={[s.body, { paddingBottom: insets.bottom + space.xl }]}>
          <LegalText text={page.intro} style={s.lede} />

          {page.sections.map((section) => (
            <View key={section.heading} style={s.section}>
              <Text style={s.heading} accessibilityRole="header">
                {fill(section.heading)}
              </Text>
              {section.blocks.map((block, i) => (
                <Block key={i} block={block} />
              ))}
            </View>
          ))}

          <View style={s.footer}>
            <LegalLinks compact />
          </View>
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

/**
 * The browser tab's title and the page's description, for people and for
 * search engines. Set by hand: expo-router's <Head> only reaches the DOM with
 * static rendering, and this app is a single-page build.
 */
function useDocumentHead(title: string, description: string) {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    const previous = document.title;
    document.title = title;

    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = description;

    return () => {
      document.title = previous;
    };
  }, [title, description]);
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string") return <LegalText text={block} style={s.body14} />;

  if ("list" in block) {
    return (
      <View style={s.list}>
        {block.list.map((item) => (
          <View key={item} style={s.item}>
            <Text style={s.bullet}>•</Text>
            <LegalText text={item} style={[s.body14, s.itemText]} />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={s.rows}>
      {block.rows.map(([label, text], i) => (
        <View key={label} style={[s.row, i > 0 && s.rowRule]}>
          <LegalText text={label} style={s.rowLabel} />
          <LegalText text={text} style={s.body14} />
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { paddingHorizontal: 20, paddingTop: space.xl, gap: space.xl },
  lede: { fontSize: 15, lineHeight: 23, color: colors.ink },

  section: { gap: space.md },
  heading: { fontSize: 17, fontWeight: "700", color: colors.ink },
  body14: { fontSize: 14, lineHeight: 22, color: colors.inkMuted },

  list: { gap: space.sm },
  item: { flexDirection: "row", gap: space.sm },
  bullet: { fontSize: 14, lineHeight: 22, color: colors.accent, fontWeight: "700" },
  itemText: { flex: 1 },

  rows: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.lg },
  row: { paddingVertical: space.md, gap: space.xs },
  rowRule: { borderTopWidth: 1, borderTopColor: colors.border },
  rowLabel: { fontSize: 13, lineHeight: 20, fontWeight: "700", color: colors.ink },

  footer: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm },
});
