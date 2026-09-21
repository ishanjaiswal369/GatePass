import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import { Checkbox, Field, RestoringScreen, WizardShell } from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { TOTAL_STEPS, nextStepPath, stepNumber } from "@/constants/wizard";
import { colors, radius, space, type } from "@/theme";
import type { VehicleType } from "@/types/api.types";

/**
 * Step 5. What it costs, per vehicle type.
 *
 * Two rates rather than one, because a bike and a car are not worth the same
 * and a single rate makes the host choose which one to be wrong about.
 *
 * The range hints are fixed, not a live market average: a "current average"
 * computed from a handful of early listings is noise presented as guidance,
 * and hosts anchor hard on whatever number they are shown.
 */
const GUIDE: Record<VehicleType, string> = {
  CAR: "Most city driveways sit between ₹30 and ₹80 an hour.",
  BIKE: "Usually a third to half the car rate.",
  OTHER: "",
};

export default function PricingScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();

  const [carOn, setCarOn] = useState(true);
  const [bikeOn, setBikeOn] = useState(false);
  const [car, setCar] = useState("");
  const [bike, setBike] = useState("");

  useEffect(() => {
    if (!spot?.pricing?.length) return;

    const find = (t: VehicleType) =>
      spot.pricing.find((row) => row.vehicleType === t);

    const carRow = find("CAR");
    const bikeRow = find("BIKE");

    setCarOn(Boolean(carRow));
    setBikeOn(Boolean(bikeRow));
    if (carRow) setCar(String(Number(carRow.pricePerHour)));
    if (bikeRow) setBike(String(Number(bikeRow.pricePerHour)));
  }, [spot]);

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spot) return;

    const rates: { vehicleType: VehicleType; pricePerHour: number }[] = [];
    if (carOn && Number(car) > 0) rates.push({ vehicleType: "CAR", pricePerHour: Number(car) });
    if (bikeOn && Number(bike) > 0) rates.push({ vehicleType: "BIKE", pricePerHour: Number(bike) });

    await spotListingApi.savePricing(token, spot.id, rates);
    router.push(nextStepPath("pricing", spot.id));
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href="/host/spot" />;

  const valid =
    (carOn && Number(car) > 0) || (bikeOn && Number(bike) > 0);

  return (
    <WizardShell
      title="Pricing"
      sub="What you charge, per hour."
      step={stepNumber("pricing")}
      totalSteps={TOTAL_STEPS}
      onBack={() => router.back()}
      onContinue={save}
      canContinue={valid}
      busy={busy}
      error={error}
      footerNote={valid ? undefined : "Set a rate for at least one vehicle type."}
    >
      <View style={s.block}>
        <Checkbox label="Cars" checked={carOn} onChange={setCarOn} />
        {carOn ? (
          <Field
            label="Rate per hour"
            value={car}
            onChangeText={setCar}
            keyboardType="number-pad"
            placeholder="60"
            hint={GUIDE.CAR}
          />
        ) : null}
      </View>

      <View style={s.block}>
        <Checkbox label="Bikes and scooters" checked={bikeOn} onChange={setBikeOn} />
        {bikeOn ? (
          <Field
            label="Rate per hour"
            value={bike}
            onChangeText={setBike}
            keyboardType="number-pad"
            placeholder="25"
            hint={GUIDE.BIKE}
          />
        ) : null}
      </View>

      <Text style={s.note}>
        A vehicle type you leave off simply will not see your spot in search.
      </Text>
    </WizardShell>
  );
}

const s = StyleSheet.create({
  block: {
    gap: space.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
  },
  note: { ...type.caption, color: colors.inkFaint, lineHeight: 18 },
});
