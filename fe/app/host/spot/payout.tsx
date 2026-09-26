import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import {
  Button,
  CheckIcon,
  DataRow,
  Field,
  LockIcon,
  OptionCard,
  RestoringScreen,
  WizardShell,
} from "@/components/ui";
import {
  PAYOUT_BUSINESS_TYPES,
  type PayoutAccountType,
  type PayoutBusinessType,
} from "@/constants/enums";
import { supportMailto } from "@/constants/support";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { useWizardContinue } from "@/hooks/useWizardContinue";
import {
  TOTAL_STEPS,
  firstStepPath,
  stepNumber,
} from "@/constants/wizard";
import { colors, radius, space, type } from "@/theme";
import type { PayoutAccount, PayoutKycStatus } from "@/types/api.types";

/**
 * Step 9. Where the host's money goes.
 *
 * This is the second of the two gates on going live, and the one hosts are
 * most likely to abandon, so it names the state plainly -- ready, pending,
 * needs attention, not set up -- and what happens next. Bank details are
 * shown masked and never to drivers.
 */
type PayoutState = "ready" | "pending" | "failed" | "none";

const STATES: Record<PayoutState, { title: string; body: string }> = {
  ready: { title: "Ready to be paid", body: "Your payout account is active." },
  pending: { title: "Verification pending", body: "Your payout details are being verified." },
  failed: { title: "Verification failed", body: "Your payout details need attention." },
  none: { title: "Not configured", body: "Add a payout account to receive your earnings." },
};

/** Why verification failed, in words a host can act on. */
const ISSUES: Record<NonNullable<PayoutAccount["issue"]>, string> = {
  BANK_ACCOUNT:
    "Your bank account couldn't be verified. Check the account number, the IFSC, and the name exactly as your bank has it.",
  KYC: "Your PAN couldn't be verified. Check it's typed correctly and belongs to the account holder.",
  BLOCKED: "Your payout account is blocked. Contact support to reopen it.",
};

const ACCOUNT_TYPES: { value: PayoutAccountType; label: string; description: string }[] = [
  { value: "INDIVIDUAL", label: "Individual", description: "Paid to your own bank account, on your PAN." },
  { value: "BUSINESS", label: "Business", description: "Paid to a company or firm's account, on its PAN." },
];

function stateOf(account: PayoutAccount | null): PayoutState {
  const status: PayoutKycStatus = account?.payoutKycStatus ?? "NOT_STARTED";
  if (status === "ACTIVATED") return "ready";
  if (status === "REJECTED") return "failed";
  // The API decides, not the status: an account submitted before the details
  // were stored reads as UNDER_REVIEW with nothing behind it, and showing that
  // host a read-only "pending" would strand them on the one screen that fixes it.
  if (!account || account.needsDetails) return "none";
  return "pending";
}

export default function PayoutScreen() {
  // The payout account is the host's own, not this spot's -- but the wizard
  // still needs to carry this spot's id into the next (and last) step, review.
  const { spot, loading, isRestoring, token } = useSpotDraft();
  const back = useWizardBack("payout", spot?.id);
  const proceed = useWizardContinue("payout");

  const [account, setAccountDetails] = useState<PayoutAccount | null>(null);
  const [pan, setPan] = useState("");
  const [holder, setHolder] = useState("");
  const [number, setNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [accountType, setAccountType] = useState<PayoutAccountType>("INDIVIDUAL");
  const [businessType, setBusinessType] = useState<PayoutBusinessType>(PAYOUT_BUSINESS_TYPES[0]);
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!token) return;

    spotListingApi
      .getPayoutAccount(token)
      .then(setAccountDetails)
      .catch(() => undefined);
  }, [token]);

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token) return;

    const saved = await spotListingApi.submitPayoutAccount(token, {
      panNumber: pan.trim().toUpperCase(),
      accountHolderName: holder.trim(),
      accountNumber: number.trim(),
      ifsc: ifsc.trim().toUpperCase(),
      accountType,
      ...(accountType === "BUSINESS" ? { businessType } : {}),
      ...(account?.needsPhone ? { phone: phone.trim() } : {}),
    });

    setAccountDetails(saved);
    setEditing(false);
    if (spot) proceed(spot);
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href={firstStepPath()} />;

  const state = stateOf(account);
  const copy = STATES[state];
  const help = supportMailto("Payout details");

  const panOk = /^[A-Z]{5}\d{4}[A-Z]$/.test(pan.trim().toUpperCase());
  const numberOk = /^\d{9,18}$/.test(number.trim());
  const ifscOk = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());
  const needsPhone = account?.needsPhone ?? false;
  const phoneOk = !needsPhone || /^[6-9]\d{9}$/.test(phone.trim());
  const valid = panOk && holder.trim().length > 0 && numberOk && ifscOk && phoneOk;
  const blocked = state === "failed" && account?.issue === "BLOCKED";
  const formMissing = !valid ? "Fill in all the details to submit." : null;

  return (
    <WizardShell
      title="Getting paid"
      sub="Where your earnings are sent."
      step={stepNumber("payout")}
      totalSteps={TOTAL_STEPS}
      onBack={back}
      onContinue={editing ? save : () => proceed(spot)}
      canContinue={editing ? valid : state === "ready" || state === "pending"}
      continueLabel={editing ? "Submit details" : "Continue"}
      busy={busy}
      error={error}
      footerNote={
        editing
          ? formMissing ?? undefined
          : state === "none"
            ? "Add a payout account to continue."
            : state === "failed"
              ? "Fix your payout details to continue."
              : undefined
      }
    >
      <View style={[s.status, state === "ready" && s.statusGood, state === "failed" && s.statusBad, state === "pending" && s.statusPending]}>
        <View style={s.statusHead}>
          {state === "ready" ? <CheckIcon color="#166534" size={16} /> : null}
          <Text style={s.statusTitle}>{copy.title}</Text>
        </View>
        <Text style={s.statusBody}>{copy.body}</Text>
        {state === "failed" && account?.issue ? <Text style={s.statusBody}>{ISSUES[account.issue]}</Text> : null}
      </View>

      {(state === "ready" || state === "pending") && !editing ? (
        <>
          {/* What is being verified, rather than only the fact that something
              is. A host who mistyped an account number has no way to spot it
              from "being checked" alone. Masked by the API. */}
          <View style={s.card}>
            <Text style={s.cardHeading}>Payment details</Text>
            <DataRow label="PAN" value={account?.panNumber ?? "—"} />
            <DataRow label="Account holder" value={account?.accountHolderName ?? "—"} />
            <DataRow label="Account number" value={account?.accountNumberLast4 ? `•••• ${account.accountNumberLast4}` : "—"} />
            <DataRow label="IFSC" value={account?.ifsc ?? "—"} />
          </View>
          {state === "pending" ? (
            <Text style={s.amend}>Details cannot be changed while verification is in progress.</Text>
          ) : null}
        </>
      ) : null}

      {(state === "none" || state === "failed") && !editing && !blocked ? (
        <Button
          label={state === "failed" ? "Fix details" : "Add payout account"}
          onPress={() => {
            // Re-submitting after a failure starts from what they chose before.
            if (account?.accountType) setAccountType(account.accountType);
            setEditing(true);
          }}
        />
      ) : null}

      {editing ? (
        <>
          <View style={s.secure}>
            <LockIcon color={colors.inkMuted} size={15} />
            {/* Says what actually happens: the details are held to verify the
                account, and only the last four digits come back afterwards. */}
            <Text style={s.secureText}>
              We hold these to verify your account, and show you only the last four digits afterwards. Drivers never see
              them.
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
          <Button label="Cancel" variant="ghost" onPress={() => setEditing(false)} />
        </>
      ) : null}

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
    </WizardShell>
  );
}

const s = StyleSheet.create({
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
  support: { minHeight: 44, justifyContent: "center" },
  supportText: { fontSize: 14, fontWeight: "600", color: colors.ink, textDecorationLine: "underline" },
  supportOff: { color: colors.inkFaint, textDecorationLine: "none", fontWeight: "400" },
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
  cardHeading: {
    ...type.label,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  amend: { ...type.caption, color: colors.inkFaint, lineHeight: 17 },
  secure: {
    flexDirection: "row",
    gap: space.sm,
    alignItems: "flex-start",
    paddingBottom: space.sm,
  },
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
});
