import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import {
  DataRow,
  Field,
  LockIcon,
  RestoringScreen,
  WizardShell,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import {
  TOTAL_STEPS,
  firstStepPath,
  nextStepPath,
  stepNumber,
} from "@/constants/wizard";
import { colors, radius, space, type } from "@/theme";
import type { PayoutAccount, PayoutKycStatus } from "@/types/api.types";

/**
 * Step 8. Where the host's money goes.
 *
 * This is the second of the two gates on going live, and the one hosts are
 * most likely to abandon, so it says plainly what happens next rather than
 * ending on a silent success.
 */
const STATUS_COPY: Record<PayoutKycStatus, { title: string; body: string }> = {
  NOT_STARTED: { title: "", body: "" },
  PENDING: {
    title: "Details received",
    body: "We are sending them for verification.",
  },
  UNDER_REVIEW: {
    title: "Being verified",
    body: "Your bank details are being checked. This usually takes a day or two, and your listing goes live once it clears.",
  },
  ACTIVATED: {
    title: "Ready to be paid",
    body: "Your payout account is active.",
  },
  REJECTED: {
    title: "Could not be verified",
    body: "The details did not check out. Enter them again, carefully.",
  },
};

export default function PayoutScreen() {
  // The payout account is the host's own, not this spot's -- but the wizard
  // still needs to carry this spot's id into the next (and last) step, review.
  const { spot, loading, isRestoring, token } = useSpotDraft();
  const back = useWizardBack("payout", spot?.id);

  const [account, setAccountDetails] = useState<PayoutAccount | null>(null);
  const [pan, setPan] = useState("");
  const [holder, setHolder] = useState("");
  const [number, setNumber] = useState("");
  const [ifsc, setIfsc] = useState("");

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
    });

    setAccountDetails(saved);
    router.push(nextStepPath("payout", spot?.id));
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href={firstStepPath()} />;

  const status = account?.payoutKycStatus ?? "NOT_STARTED";
  // The API decides, not the status. An account submitted before the details
  // were stored reads as UNDER_REVIEW with nothing behind it, and showing
  // that host a read-only "being verified" would strand them on the one
  // screen that could fix it.
  const submitted = account !== null && !account.needsDetails;
  const copy = STATUS_COPY[status];

  const valid =
    /^[A-Z]{5}\d{4}[A-Z]$/.test(pan.trim().toUpperCase()) &&
    holder.trim().length > 0 &&
    /^\d{9,18}$/.test(number.trim()) &&
    /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());

  return (
    <WizardShell
      title="Getting paid"
      sub="Where your earnings are sent."
      step={stepNumber("payout")}
      totalSteps={TOTAL_STEPS}
      onBack={back}
      onContinue={submitted ? () => router.push(nextStepPath("payout", spot.id)) : save}
      canContinue={submitted || valid}
      continueLabel={submitted ? "Continue" : "Submit details"}
      busy={busy}
      error={error}
    >
      {submitted ? (
        <>
          <View style={s.status}>
            <Text style={s.statusTitle}>{copy.title}</Text>
            <Text style={s.statusBody}>{copy.body}</Text>
          </View>

          {/* What is being verified, rather than only the fact that something
              is. A host who mistyped an account number has no way to spot it
              from "being checked" alone -- and these are the details this
              screen exists to collect, so they belong on it either way. */}
          <View style={s.card}>
            <Text style={s.cardHeading}>Details we hold</Text>
            <DataRow label="PAN" value={account?.panNumber ?? "—"} />
            <DataRow label="Account holder" value={account?.accountHolderName ?? "—"} />
            <DataRow
              label="Account number"
              value={
                account?.accountNumberLast4
                  ? `•••• ${account.accountNumberLast4}`
                  : "—"
              }
            />
            <DataRow label="IFSC" value={account?.ifsc ?? "—"} />
          </View>

          <Text style={s.amend}>
            Something wrong? Contact support — details cannot be changed while
            they are being verified.
          </Text>
        </>
      ) : (
        <>
          {status === "REJECTED" ? (
            <View style={[s.status, s.statusBad]}>
              <Text style={s.statusTitle}>{copy.title}</Text>
              <Text style={s.statusBody}>{copy.body}</Text>
            </View>
          ) : null}

          <View style={s.secure}>
            <LockIcon color={colors.inkMuted} size={15} />
            {/* Says what actually happens. It used to promise the account
                number was not kept, which stopped being true the moment it
                had to be -- nobody could verify an account they were never
                given. A claim about what we hold has to match what we hold. */}
            <Text style={s.secureText}>
              We hold these to verify your account, and show you only the last
              four digits afterwards.
            </Text>
          </View>

          <Field
            label="PAN"
            value={pan}
            onChangeText={setPan}
            autoCapitalize="characters"
            maxLength={10}
            placeholder="ABCDE1234F"
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
            onChangeText={setNumber}
            keyboardType="number-pad"
            maxLength={18}
          />
          <Field
            label="IFSC"
            value={ifsc}
            onChangeText={setIfsc}
            autoCapitalize="characters"
            maxLength={11}
            placeholder="HDFC0001234"
          />
        </>
      )}
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
});
