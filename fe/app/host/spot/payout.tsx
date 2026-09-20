import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import { Field, LockIcon, RestoringScreen, WizardShell } from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { TOTAL_STEPS, nextStepPath, stepNumber } from "@/constants/wizard";
import { colors, radius, space, type } from "@/theme";
import type { PayoutKycStatus } from "@/types/api.types";

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
  const { loading, isRestoring, token } = useSpotDraft();

  const [status, setStatus] = useState<PayoutKycStatus>("NOT_STARTED");
  const [pan, setPan] = useState("");
  const [holder, setHolder] = useState("");
  const [account, setAccount] = useState("");
  const [ifsc, setIfsc] = useState("");

  useEffect(() => {
    if (!token) return;

    spotListingApi
      .getPayoutAccount(token)
      .then(({ payoutKycStatus }) => setStatus(payoutKycStatus))
      .catch(() => undefined);
  }, [token]);

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token) return;

    const { payoutKycStatus } = await spotListingApi.submitPayoutAccount(token, {
      panNumber: pan.trim().toUpperCase(),
      accountHolderName: holder.trim(),
      accountNumber: account.trim(),
      ifsc: ifsc.trim().toUpperCase(),
    });

    setStatus(payoutKycStatus);
    router.push(nextStepPath("payout"));
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const submitted = status !== "NOT_STARTED" && status !== "REJECTED";
  const copy = STATUS_COPY[status];

  const valid =
    /^[A-Z]{5}\d{4}[A-Z]$/.test(pan.trim().toUpperCase()) &&
    holder.trim().length > 0 &&
    /^\d{9,18}$/.test(account.trim()) &&
    /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());

  return (
    <WizardShell
      title="Getting paid"
      sub="Where your earnings are sent."
      step={stepNumber("payout")}
      totalSteps={TOTAL_STEPS}
      onBack={() => router.back()}
      onContinue={submitted ? () => router.push(nextStepPath("payout")) : save}
      canContinue={submitted || valid}
      continueLabel={submitted ? "Continue" : "Submit details"}
      busy={busy}
      error={error}
    >
      {submitted ? (
        <View style={s.status}>
          <Text style={s.statusTitle}>{copy.title}</Text>
          <Text style={s.statusBody}>{copy.body}</Text>
        </View>
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
            <Text style={s.secureText}>
              These go to our payment provider for verification. GatePass does
              not keep your account number.
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
            value={account}
            onChangeText={setAccount}
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
  secure: {
    flexDirection: "row",
    gap: space.sm,
    alignItems: "flex-start",
    paddingBottom: space.sm,
  },
  secureText: { flex: 1, ...type.caption, color: colors.inkMuted, lineHeight: 17 },
});
