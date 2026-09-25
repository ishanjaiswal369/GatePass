import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { CardIcon, CheckIcon, PhoneFrame, RestoringScreen, ScreenHeader, ShieldIcon, StatusChip, WalletIcon } from "@/components/ui";
import { listSavedMethods, paymentsConfigured, type SavedPaymentMethod } from "@/lib/payments";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";

/**
 * How a driver can pay, and anything the gateway has saved for them.
 *
 * Payment details never touch GatePass's database: saved UPI IDs and cards
 * are the gateway's, read through lib/payments like every other payment
 * call. Until a gateway is wired there is nothing saved, and the screen says
 * what will be on offer at checkout instead of showing Add buttons that
 * can't work.
 */
export default function PaymentMethodsScreen() {
  const { token, isRestoring } = useSession();
  const [saved, setSaved] = useState<SavedPaymentMethod[]>([]);

  useEffect(() => {
    if (!token) return;
    listSavedMethods(token).then(setSaved).catch(() => setSaved([]));
  }, [token]);

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const upi = saved.filter((m) => m.kind === "UPI");
  const cards = saved.filter((m) => m.kind === "CARD");

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title="Payment Methods" onBack={() => (router.canGoBack() ? router.back() : router.replace("/account"))} />

        <ScrollView contentContainerStyle={s.body}>
          {!paymentsConfigured ? (
            <View style={s.notice}>
              <Text style={s.noticeTitle}>Online payment isn't switched on yet</Text>
              <Text style={s.noticeBody}>
                When it is, the methods below are offered at checkout, and anything you choose to save shows up here.
              </Text>
            </View>
          ) : null}

          <Section title="UPI">
            {upi.map((m) => (
              <Method key={m.id} icon={<WalletIcon size={18} />} title={m.label} sub={m.detail} isDefault={m.isDefault} />
            ))}
            <Method
              icon={<WalletIcon size={18} />}
              title="Any UPI app"
              sub="Google Pay, PhonePe, Paytm, BHIM — choose when you pay"
              tag="Always available"
            />
          </Section>

          <Section title="CARDS">
            {cards.map((m) => (
              <Method key={m.id} icon={<CardIcon />} title={m.label} sub={m.detail} isDefault={m.isDefault} />
            ))}
            <Method icon={<CardIcon />} title="Credit or debit card" sub="Visa, Mastercard, RuPay — entered at checkout" />
          </Section>

          <Section title="NETBANKING">
            <Method icon={<WalletIcon size={18} />} title="All major banks" sub="Choose your bank at checkout" tag="Available" />
          </Section>

          <View style={s.safe}>
            <ShieldIcon size={18} color="#166534" />
            <View style={s.flex}>
              <Text style={s.safeTitle}>Your payment details are safe</Text>
              <Text style={s.safeBody}>
                Payments are processed by our RBI-authorised payment partner. GatePass never sees your UPI PIN or full
                card number. Refunds always go back to the method you paid with.
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.label}>{title}</Text>
      <View style={s.card}>{children}</View>
    </View>
  );
}

function Method({
  icon,
  title,
  sub,
  tag,
  isDefault,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  tag?: string;
  isDefault?: boolean;
}) {
  return (
    <View style={s.method}>
      <View style={s.icon}>{icon}</View>
      <View style={s.flex}>
        <Text style={s.title}>{title}</Text>
        {sub ? <Text style={s.sub}>{sub}</Text> : null}
      </View>
      {isDefault ? <StatusChip label="Default" tone="ink" /> : tag ? (
        <View style={s.tag}>
          <CheckIcon size={12} color="#166534" />
          <Text style={s.tagText}>{tag}</Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, gap: space.lg, paddingBottom: 32 },
  notice: { backgroundColor: colors.accentSurface, borderRadius: radius.md, padding: space.lg, gap: 4 },
  noticeTitle: { fontSize: 14, fontWeight: "700", color: colors.accentInk },
  noticeBody: { fontSize: 13, lineHeight: 19, color: colors.accentInk },
  section: { gap: space.sm },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.lg },
  method: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 64, paddingVertical: 10 },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center" },
  flex: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: "600", color: colors.ink },
  sub: { fontSize: 12, color: colors.inkMuted },
  tag: { flexDirection: "row", alignItems: "center", gap: 3 },
  tagText: { fontSize: 12, fontWeight: "600", color: "#166534" },
  safe: { flexDirection: "row", gap: space.md, backgroundColor: colors.canvas, borderRadius: radius.md, padding: space.lg },
  safeTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  safeBody: { fontSize: 13, lineHeight: 19, color: "#374151" },
});
