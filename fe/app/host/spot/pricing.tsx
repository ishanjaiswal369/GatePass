import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import { Button, Field, RestoringScreen, WizardShell } from "@/components/ui";
import { TOTAL_STEPS, firstStepPath, stepHref, stepNumber } from "@/constants/wizard";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { useWizardContinue } from "@/hooks/useWizardContinue";
import { vehicleTypesOf } from "@/lib/listingRules";
import { formatRupees } from "@/lib/money";
import type { VehicleSize } from "@/constants/enums";
import { colors, radius, space, type } from "@/theme";
import type { SpotPricingRow } from "@/types/api.types";

/**
 * Step 6. What it costs, for each vehicle the host said can park (step 4).
 *
 * Hourly and daily are each a switch: a host can rent only by the day, or
 * only by the hour -- but each vehicle needs at least one. Whole
 * rupees, as a host sets a price; the API refuses anything else. The guidance
 * is deliberately not a "market average": a handful of early listings would
 * be noise presented as fact, and hosts anchor hard on a number they're shown.
 */

type Vehicle = "CAR" | "BIKE";
type Mode = "hour" | "day";

interface Rate {
  on: Record<Mode, boolean>;
  value: Record<Mode, string>;
}

const TITLES: Record<Vehicle, string> = { CAR: "CARS", BIKE: "BIKES & SCOOTERS" };
const EXAMPLES: Record<Vehicle, Record<Mode, string>> = {
  CAR: { hour: "60", day: "300" },
  BIKE: { hour: "25", day: "120" },
};
/** The cars one car price covers, by the largest that fits. */
const FITS: Record<VehicleSize, string> = {
  HATCHBACK: "hatchbacks",
  SEDAN: "hatchbacks and sedans",
  SUV: "hatchbacks, sedans and SUVs",
  VAN: "every car, SUV and van",
};

const MODES: { key: Mode; label: string; unit: string }[] = [
  { key: "hour", label: "Hourly", unit: "per hour" },
  { key: "day", label: "Daily", unit: "per day" },
];

/**
 * GatePass's cut of the parking, mirrored from be/src/config/pricing.ts for
 * the preview only -- what the host is actually paid is computed by the API.
 */
const HOST_COMMISSION_RATE = 0.1;

const EMPTY: Rate = { on: { hour: true, day: false }, value: { hour: "", day: "" } };

function rateFrom(row: SpotPricingRow | undefined): Rate {
  if (!row) return EMPTY;
  const text = (v: string | null) => (v ? String(Number(v)) : "");
  return {
    on: { hour: row.pricePerHour !== null, day: row.pricePerDay !== null },
    value: { hour: text(row.pricePerHour), day: text(row.pricePerDay) },
  };
}

/** A rate a host may save: a whole number of rupees, above zero. */
const valid = (text: string) => /^\d+$/.test(text) && Number(text) > 0 && Number(text) <= 10_000_000;

export default function PricingScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();
  const back = useWizardBack("pricing", spot?.id);
  const proceed = useWizardContinue("pricing");
  const [rates, setRates] = useState<Partial<Record<Vehicle, Rate>>>({});

  useEffect(() => {
    if (!spot) return;
    setRates(Object.fromEntries(vehicleTypesOf(spot).map((t) => [t, rateFrom(spot.pricing.find((r) => r.vehicleType === t))])));
  }, [spot]);

  const types = spot ? vehicleTypesOf(spot) : [];

  const problemFor = (t: Vehicle): string | null => {
    const rate = rates[t];
    if (!rate) return null;
    const on = MODES.filter((m) => rate.on[m.key]);
    const noun = t === "CAR" ? "cars" : "bikes";
    if (on.length === 0) return `Turn on at least one way to rent to ${noun}.`;
    if (on.some((m) => !rate.value[m.key])) return `Set a price for ${noun}.`;
    if (on.some((m) => !valid(rate.value[m.key]))) return "Prices are whole rupees, above ₹0.";
    return null;
  };
  const problem = types.map(problemFor).find(Boolean) ?? null;

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spot) return;
    const num = (rate: Rate, mode: Mode) => (rate.on[mode] ? Number(rate.value[mode]) : undefined);
    await spotListingApi.savePricing(
      token,
      spot.id,
      types.map((t) => {
        const rate = rates[t] ?? EMPTY;
        return { vehicleType: t, pricePerHour: num(rate, "hour"), pricePerDay: num(rate, "day") };
      })
    );
    proceed(spot);
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href={firstStepPath()} />;

  const update = (t: Vehicle, next: Rate) => setRates((current) => ({ ...current, [t]: next }));
  const example = types.map((t) => rates[t]).find((r) => r && r.on.hour && valid(r.value.hour));

  return (
    <WizardShell
      title="Pricing"
      sub="Set what you charge for each vehicle type."
      step={stepNumber("pricing")}
      totalSteps={TOTAL_STEPS}
      onBack={back}
      onContinue={save}
      canContinue={types.length > 0 && problem === null}
      busy={busy}
      error={error}
      footerNote={types.length === 0 ? "Choose which vehicles can park in Parking details first." : problem ?? undefined}
    >
      {types.length === 0 ? (
        <View style={s.block}>
          <Text style={s.blockText}>Tell us which vehicles can park here, then set their prices.</Text>
          <Button label="Go to Parking details" variant="ghost" onPress={() => router.push(stepHref("details", spot.id))} />
        </View>
      ) : null}

      {types.map((t) => {
        const rate = rates[t] ?? EMPTY;
        const issue = problemFor(t);
        return (
          <View key={t} style={s.block}>
            <Text style={s.blockTitle} accessibilityRole="header">
              {TITLES[t]}
            </Text>
            {t === "CAR" && spot.maxVehicleSize ? (
              <Text style={s.blockSub}>One price for every car that fits: {FITS[spot.maxVehicleSize]}.</Text>
            ) : null}
            {MODES.map((mode) => (
              <View key={mode.key} style={s.mode}>
                <View style={s.modeHead}>
                  <Text style={s.modeLabel}>{mode.label}</Text>
                  <Switch
                    value={rate.on[mode.key]}
                    onValueChange={(on) => update(t, { ...rate, on: { ...rate.on, [mode.key]: on } })}
                    accessibilityLabel={`${mode.label} price for ${t === "CAR" ? "cars" : "bikes"}`}
                    trackColor={{ true: colors.ink, false: "#d1d5db" }}
                    thumbColor={colors.surface}
                    {...({ activeThumbColor: colors.surface } as object)}
                  />
                </View>
                {rate.on[mode.key] ? (
                  <Field
                    label={`₹ ${mode.unit}`}
                    value={rate.value[mode.key]}
                    onChangeText={(text) =>
                      update(t, { ...rate, value: { ...rate.value, [mode.key]: text.replace(/[^0-9]/g, "").slice(0, 8) } })
                    }
                    keyboardType="number-pad"
                    placeholder={EXAMPLES[t][mode.key]}
                    error={rate.value[mode.key] && !valid(rate.value[mode.key]) ? "Above ₹0, whole rupees." : null}
                  />
                ) : null}
              </View>
            ))}
            {issue ? <Text style={s.issue}>{issue}</Text> : null}
          </View>
        );
      })}

      {example ? (
        <View style={s.split}>
          <Text style={s.splitTitle}>
            For a {formatRupees(example.value.hour)} hour you receive{" "}
            {formatRupees(Math.round(Number(example.value.hour) * (1 - HOST_COMMISSION_RATE) * 100) / 100)}
          </Text>
          <Text style={s.note}>
            GatePass keeps a {Math.round(HOST_COMMISSION_RATE * 100)}% commission. Drivers pay the cheaper of hourly and
            daily for their stay.
          </Text>
        </View>
      ) : null}

      <Text style={s.note}>
        Set a price that reflects your location, access and parking type. New prices apply to new bookings; bookings
        already made keep the price they were made at.
      </Text>
    </WizardShell>
  );
}

const s = StyleSheet.create({
  block: {
    gap: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
  },
  blockTitle: { ...type.label, color: colors.inkMuted, letterSpacing: 0.6 },
  blockSub: { fontSize: 13, color: colors.inkMuted, marginTop: -6 },
  blockText: { fontSize: 14, color: colors.ink },
  mode: { gap: space.sm },
  modeHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36 },
  modeLabel: { fontSize: 15, fontWeight: "600", color: colors.ink },
  issue: { ...type.caption, color: "#b91c1c" },
  split: { gap: 4, backgroundColor: colors.canvas, borderRadius: radius.md, padding: space.lg },
  splitTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  note: { ...type.caption, color: colors.inkFaint, lineHeight: 18 },
});
