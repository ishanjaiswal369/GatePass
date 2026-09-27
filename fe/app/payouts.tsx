import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, spotListingApi } from "@/api";
import {
  BottomNav,
  Button,
  CheckIcon,
  DataRow,
  ErrorNotice,
  Field,
  LockIcon,
  OptionCard,
  PhoneFrame,
  RestoringScreen,
  type NavKey,
} from "@/components/ui";
import { PAYOUT_BUSINESS_TYPES, type PayoutAccountType, type PayoutBusinessType } from "@/constants/enums";
import { supportMailto } from "@/constants/support";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { PAYOUT_ISSUE_COPY, PAYOUT_STATE_COPY, payoutAccountState } from "@/lib/payoutAccount";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space, type } from "@/theme";
import type { PayoutAccount } from "@/types/api.types";

const ACCOUNT_TYPES: { value: PayoutAccountType; label: string; description: string }[] = [
  { value: "INDIVIDUAL", label: "Individual", description: "Paid to your own bank account, on your PAN." },
  { value: "BUSINESS", label: "Business", description: "Paid to a company or firm's account, on its PAN." },
];

/**
 * The Payouts tab: where a host's earnings are sent.
 *
 * Its own tab, open to every signed-in user -- bank details can be added
 * before the first listing, and submitting them makes the user a host (the
 * gateway's payee is the host profile). One account for all of a host's
 * spaces, so it lives here rather than in each listing's wizard. A listing
 * can be submitted without it; it goes live once the document is approved
 * and this account is active.
 *
 * Submitting registers the host with the payment gateway (Cashfree Easy Split
 * vendor) on the API. The state is named plainly -- ready, pending, needs
 * attention, not set up -- and refreshed each time the screen opens, which is
 * also when the API asks the gateway for news on a pending account. Bank
 * details are shown masked and never to drivers.
 */
export default function PayoutsScreen() {
  const { token, user, setUser, isRestoring } = useSession();
  const insets = useScreenInsets();

  const [account, setAccount] = useState<PayoutAccount | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pan, setPan] = useState("");
  const [holder, setHolder] = useState("");
  const [number, setNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [accountType, setAccountType] = useState<PayoutAccountType>("INDIVIDUAL");
  const [businessType, setBusinessType] = useState<PayoutBusinessType>(PAYOUT_BUSINESS_TYPES[0]);
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      let cancelled = false;
      spotListingApi
        .getPayoutAccount(token)
        .then((next) => {
          if (cancelled) return;
          setAccount(next);
          setLoadError(null);
        })
        .catch((err) => !cancelled && setLoadError(err instanceof ApiError ? err.message : "Could not load your payout account."));
      return () => {
        cancelled = true;
      };
    }, [token])
  );

  /**
   * Opens the form from what the host sent last time -- account type,
   * business type, holder and IFSC. PAN and account number start empty: the
   * API only ever returns them masked, and they're re-verified anyway.
   */
  const startEditing = (current: PayoutAccount) => {
    if (current.accountType) setAccountType(current.accountType);
    if (current.businessType && (PAYOUT_BUSINESS_TYPES as readonly string[]).includes(current.businessType)) {
      setBusinessType(current.businessType as PayoutBusinessType);
    }
    if (current.accountHolderName) setHolder(current.accountHolderName);
    if (current.ifsc) setIfsc(current.ifsc);
    setPan("");
    setNumber("");
    setEditing(true);
  };

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token) return;
    const saved = await spotListingApi.submitPayoutAccount(token, {
      panNumber: pan.trim().toUpperCase(),
      accountHolderName: holder.trim(),
      accountNumber: number.trim(),
      ifsc: ifsc.trim().toUpperCase(),
      accountType,
      // A business picks its category; for an individual the API sends Cashfree a default.
      ...(accountType === "BUSINESS" ? { businessType } : {}),
      ...(account?.needsPhone ? { phone: phone.trim() } : {}),
    });
    setAccount(saved);
    setEditing(false);
    // The API made them a host to hold the payee; the Host tab should know.
    if (user && !user.hasHostProfile) setUser({ ...user, hasHostProfile: true });
    // Typed once, verified by the bank; nothing to keep on the device.
    setPan("");
    setNumber("");
  });

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const state = payoutAccountState(account);
  const copy = PAYOUT_STATE_COPY[state];
  const help = supportMailto("Payout details");
  const navigate = (key: NavKey) => {
    if (key === "home") router.push("/home");
    if (key === "bookings") router.push("/bookings");
    if (key === "host") router.push("/host");
    if (key === "profile") router.push("/account");
  };

  const panOk = /^[A-Z]{5}\d{4}[A-Z]$/.test(pan.trim().toUpperCase());
  const numberOk = /^\d{9,18}$/.test(number.trim());
  const ifscOk = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());
  const needsPhone = account?.needsPhone ?? false;
  const phoneOk = !needsPhone || /^[6-9]\d{9}$/.test(phone.trim());
  const valid = panOk && holder.trim().length > 0 && numberOk && ifscOk && phoneOk;
  const blocked = state === "failed" && account?.issue === "BLOCKED";

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScrollView contentContainerStyle={[s.body, { paddingTop: insets.top + 32 }]} keyboardShouldPersistTaps="handled">
          <View style={s.heading}>
            <Text style={s.title}>Payouts</Text>
            <Text style={s.sub}>Where your earnings are sent. One account for all your spaces.</Text>
          </View>

          {loadError ? <ErrorNotice message={loadError} /> : null}

          {!account ? (
            loadError ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : (
            <>
              <View
                style={[
                  s.status,
                  state === "ready" && s.statusGood,
                  state === "failed" && s.statusBad,
                  state === "pending" && s.statusPending,
                ]}
                accessibilityLiveRegion="polite"
              >
                <View style={s.statusHead}>
                  {state === "ready" ? <CheckIcon color="#166534" size={16} /> : null}
                  <Text style={s.statusTitle}>{copy.title}</Text>
                </View>
                <Text style={s.statusBody}>{copy.body}</Text>
                {state === "failed" && account.issue ? <Text style={s.statusBody}>{PAYOUT_ISSUE_COPY[account.issue]}</Text> : null}
              </View>

              {(state === "ready" || state === "pending") && !editing ? (
                <>
                  {/* What is being verified, rather than only the fact that
                      something is. A host who mistyped an account number has
                      no way to spot it from "being checked" alone. Masked by
                      the API. */}
                  <View style={s.card}>
                    <Text style={s.cardHeading}>Payment details</Text>
                    <DataRow label="Account type" value={account.accountType === "BUSINESS" ? "Business" : "Individual"} />
                    {account.businessType ? <DataRow label="Business type" value={account.businessType} /> : null}
                    <DataRow label="PAN" value={account.panNumber ?? "—"} />
                    <DataRow label="Account holder" value={account.accountHolderName ?? "—"} />
                    <DataRow label="Account number" value={account.accountNumberLast4 ? `•••• ${account.accountNumberLast4}` : "—"} />
                    <DataRow label="IFSC" value={account.ifsc ?? "—"} />
                  </View>
                  {state === "pending" ? (
                    <Text style={s.amend}>Details cannot be changed while verification is in progress.</Text>
                  ) : (
                    <>
                      <Button label="Update bank details" variant="ghost" onPress={() => startEditing(account)} />
                      <Text style={s.amend}>
                        {"A new account is verified again before you're paid into it. Your spaces don't take new bookings until that finishes — usually within a day."}
                      </Text>
                    </>
                  )}
                </>
              ) : null}

              {(state === "none" || state === "failed") && !editing && !blocked ? (
                <Button
                  label={state === "failed" ? "Fix details" : "Add payout account"}
                  onPress={() => startEditing(account)}
                />
              ) : null}

              {editing ? (
                <View style={s.form}>
                  <View style={s.secure}>
                    <LockIcon color={colors.inkMuted} size={15} />
                    <Text style={s.secureText}>
                      We hold these to verify your account, and show you only the last four digits afterwards. Drivers
                      never see them.
                    </Text>
                  </View>

                  <View style={s.types} accessibilityRole="radiogroup">
                    {ACCOUNT_TYPES.map((option) => (
                      <OptionCard
                        key={option.value}
                        label={option.label}
                        description={option.description}
                        selected={accountType === option.value}
                        onPress={() => setAccountType(option.value)}
                      />
                    ))}
                  </View>

                  {/* Businesses only. Cashfree needs one for individuals too, but a
                      person renting out a driveway can't answer it -- the API sends a default. */}
                  {accountType === "BUSINESS" ? (
                    <View style={s.chips} accessibilityRole="radiogroup">
                      <Text style={s.chipsLabel}>Business type</Text>
                      {PAYOUT_BUSINESS_TYPES.map((value) => {
                        const on = businessType === value;
                        return (
                          <Pressable
                            key={value}
                            onPress={() => setBusinessType(value)}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: on }}
                            aria-checked={on}
                            style={[s.chip, on && s.chipOn]}
                          >
                            <Text style={[s.chipText, on && s.chipTextOn]}>{value}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}

                  {needsPhone ? (
                    <Field
                      label="Mobile number"
                      value={phone}
                      onChangeText={(t) => setPhone(t.replace(/[^0-9]/g, "").slice(0, 10))}
                      keyboardType="number-pad"
                      maxLength={10}
                      placeholder="9876543210"
                      hint="Needed to set up your payouts. Saved to your profile."
                      error={phone.length === 10 && !phoneOk ? "A 10-digit Indian mobile number, starting 6-9." : null}
                    />
                  ) : null}

                  <Field
                    label="PAN"
                    value={pan}
                    onChangeText={(t) => setPan(t.toUpperCase())}
                    autoCapitalize="characters"
                    maxLength={10}
                    placeholder="ABCDE1234F"
                    error={pan.length === 10 && !panOk ? "A PAN is 5 letters, 4 digits, then a letter." : null}
                  />
                  <Field
                    label="Account holder name"
                    value={holder}
                    onChangeText={setHolder}
                    hint="Exactly as it appears on your bank account."
                    maxLength={120}
                  />
                  <Field
                    label="Account number"
                    value={number}
                    onChangeText={(t) => setNumber(t.replace(/[^0-9]/g, ""))}
                    keyboardType="number-pad"
                    maxLength={18}
                    error={number.length > 0 && number.length < 9 ? "At least 9 digits." : null}
                  />
                  <Field
                    label="IFSC"
                    value={ifsc}
                    onChangeText={(t) => setIfsc(t.toUpperCase())}
                    autoCapitalize="characters"
                    maxLength={11}
                    placeholder="SBIN0010876"
                    error={ifsc.length === 11 && !ifscOk ? "An IFSC is 4 letters, 0, then 6 letters or digits." : null}
                  />

                  {error ? <ErrorNotice message={error} /> : null}
                  <Button label="Submit details" size="lg" onPress={save} busy={busy} disabled={!valid || busy} />
                  {!valid ? <Text style={s.note}>Fill in all the details to submit.</Text> : null}
                  <Button label="Cancel" variant="ghost" onPress={() => setEditing(false)} />
                </View>
              ) : null}
            </>
          )}

          <Pressable
            onPress={() => help && void Linking.openURL(help)}
            disabled={!help}
            accessibilityRole="link"
            style={s.support}
          >
            <Text style={[s.supportText, !help && s.supportOff]}>
              {help ? "Something wrong? Contact support" : "Something wrong? Support isn't reachable from this build."}
            </Text>
          </Pressable>
        </ScrollView>
        <BottomNav active="payouts" onNavigate={navigate} />
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { paddingHorizontal: 20, paddingBottom: 20, gap: space.lg },
  heading: { gap: 6 },
  title: { fontSize: 27, fontWeight: "700", color: colors.ink, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: colors.inkMuted, lineHeight: 22 },
  loading: { paddingVertical: space.xxl },
  status: {
    gap: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
  },
  statusBad: { backgroundColor: colors.dangerSurface, borderColor: colors.danger },
  statusGood: { backgroundColor: "#dcfce7", borderColor: "#86efac" },
  statusPending: { backgroundColor: colors.accentSurface, borderColor: colors.accentSurface },
  statusHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  statusTitle: { ...type.label, color: colors.ink, fontSize: 15 },
  statusBody: { fontSize: 13, lineHeight: 19, color: colors.inkMuted },
  card: {
    gap: space.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
  },
  cardHeading: { ...type.label, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 0.6 },
  amend: { ...type.caption, color: colors.inkFaint, lineHeight: 17 },
  form: { gap: space.lg },
  secure: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  secureText: { flex: 1, ...type.caption, color: colors.inkMuted, lineHeight: 17 },
  types: { gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, alignItems: "center" },
  chipsLabel: { ...type.label, color: colors.ink, width: "100%" },
  chip: {
    minHeight: 40,
    paddingHorizontal: space.md,
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.ink },
  chipTextOn: { color: colors.onInk },
  note: { ...type.caption, color: colors.inkMuted, textAlign: "center" },
  support: { minHeight: 44, justifyContent: "center" },
  supportText: { fontSize: 14, fontWeight: "600", color: colors.ink, textDecorationLine: "underline" },
  supportOff: { color: colors.inkFaint, textDecorationLine: "none", fontWeight: "400" },
});
