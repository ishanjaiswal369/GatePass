import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import { Checkbox, Field, RestoringScreen, WizardShell } from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { continueAfter } from "@/lib/wizardFlow";
import {
  TOTAL_STEPS,
  firstStepPath,
  nextStepPath,
  stepNumber,
} from "@/constants/wizard";
import { colors, radius, space, type } from "@/theme";
import { formatRupees } from "@/lib/money";
import type { SpotPricingRow, VehicleType } from "@/types/api.types";

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
  const back = useWizardBack("pricing", spot?.id);

  const [carOn, setCarOn] = useState(true);
  const [bikeOn, setBikeOn] = useState(false);
  const [car, setCar] = useState<Rate>(EMPTY_RATE);
  const [bike, setBike] = useState<Rate>(EMPTY_RATE);

  useEffect(() => {
    if (!spot?.pricing?.length) return;

    const find = (t: VehicleType) =>
      spot.pricing.find((row) => row.vehicleType === t);

    const carRow = find("CAR");
    const bikeRow = find("BIKE");

    setCarOn(Boolean(carRow));
    setBikeOn(Boolean(bikeRow));
    if (carRow) setCar(rateFrom(carRow));
    if (bikeRow) setBike(rateFrom(bikeRow));
  }, [spot]);

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spot) return;

    const rates = [
      ...(carOn && Number(car.hour) > 0 ? [toRow("CAR", car)] : []),
      ...(bikeOn && Number(bike.hour) > 0 ? [toRow("BIKE", bike)] : []),
    ];

    await spotListingApi.savePricing(token, spot.id, rates);
    continueAfter("pricing", spot);
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href={firstStepPath()} />;

  const valid =
    ((carOn && Number(car.hour) > 0) || (bikeOn && Number(bike.hour) > 0)) &&
    [car, bike].every((r) => (!r.dayOn || Number(r.day) > 0) && (!r.monthOn || Number(r.month) > 0));
  const example = carOn ? car : bike;
  const exampleAmount = Number(example.dayOn ? example.day : example.hour) || 0;

  return (
    <WizardShell
      title="Pricing"
      sub="Turn on only the ways you want to rent it out."
      step={stepNumber("pricing")}
      totalSteps={TOTAL_STEPS}
      onBack={back}
      onContinue={save}
      canContinue={valid}
      busy={busy}
      error={error}
      footerNote={valid ? undefined : "Set an hourly rate for at least one vehicle type, and a price for each option you turned on."}
    >
      <View style={s.block}>
        <Checkbox label="Cars" checked={carOn} onChange={setCarOn} />
        {carOn ? <RateFields value={car} onChange={setCar} placeholder={["40", "200", "3200"]} hint={GUIDE.CAR} /> : null}
      </View>

      <View style={s.block}>
        <Checkbox label="Bikes and scooters" checked={bikeOn} onChange={setBikeOn} />
        {bikeOn ? <RateFields value={bike} onChange={setBike} placeholder={["15", "80", "1200"]} hint={GUIDE.BIKE} /> : null}
      </View>

      {exampleAmount > 0 ? (
        <View style={s.split}>
          <Text style={s.splitTitle}>
            For a {formatRupees(exampleAmount)} {example.dayOn ? "day" : "hour"} booking you receive{" "}
            {formatRupees(Math.round(exampleAmount * (1 - HOST_COMMISSION_RATE) * 100) / 100)}
          </Text>
          <Text style={s.note}>
            GatePass keeps a {Math.round(HOST_COMMISSION_RATE * 100)}% commission. Drivers pay the cheaper of hourly
            and daily for their stay; monthly is paid up front.
          </Text>
        </View>
      ) : null}

      <Text style={s.note}>
        A vehicle type you leave off simply will not see your spot in search.
      </Text>
    </WizardShell>
  );
}

/**
 * GatePass's cut of the parking, mirrored from be/src/config/pricing.ts for
 * the preview only -- what the host is actually paid is computed by the API.
 */
const HOST_COMMISSION_RATE = 0.1;

interface Rate {
  hour: string;
  dayOn: boolean;
  day: string;
  monthOn: boolean;
  month: string;
}

const EMPTY_RATE: Rate = { hour: "", dayOn: false, day: "", monthOn: false, month: "" };

function rateFrom(row: SpotPricingRow): Rate {
  return {
    hour: String(Number(row.pricePerHour)),
    dayOn: row.pricePerDay !== null,
    day: row.pricePerDay ? String(Number(row.pricePerDay)) : "",
    monthOn: row.pricePerMonth !== null,
    month: row.pricePerMonth ? String(Number(row.pricePerMonth)) : "",
  };
}

function toRow(vehicleType: VehicleType, rate: Rate) {
  return {
    vehicleType,
    pricePerHour: Number(rate.hour),
    ...(rate.dayOn ? { pricePerDay: Number(rate.day) } : {}),
    ...(rate.monthOn ? { pricePerMonth: Number(rate.month) } : {}),
  };
}

/** Hourly always; daily and monthly each behind their own switch, as the prototype has them. */
function RateFields({
  value,
  onChange,
  placeholder,
  hint,
}: {
  value: Rate;
  onChange: (next: Rate) => void;
  placeholder: [string, string, string];
  hint: string;
}) {
  const digits = (text: string) => text.replace(/[^0-9]/g, "").slice(0, 7);
  return (
    <View style={s.rates}>
      <Field
        label="Hourly · per hour (₹)"
        value={value.hour}
        onChangeText={(t) => onChange({ ...value, hour: digits(t) })}
        keyboardType="number-pad"
        placeholder={placeholder[0]}
        hint={hint}
      />
      <Checkbox label="Daily · per day" checked={value.dayOn} onChange={(on) => onChange({ ...value, dayOn: on })} />
      {value.dayOn ? (
        <Field
          label="Per day (₹)"
          value={value.day}
          onChangeText={(t) => onChange({ ...value, day: digits(t) })}
          keyboardType="number-pad"
          placeholder={placeholder[1]}
        />
      ) : null}
      <Checkbox label="Monthly · per month, paid up front" checked={value.monthOn} onChange={(on) => onChange({ ...value, monthOn: on })} />
      {value.monthOn ? (
        <Field
          label="Per month (₹)"
          value={value.month}
          onChangeText={(t) => onChange({ ...value, month: digits(t) })}
          keyboardType="number-pad"
          placeholder={placeholder[2]}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  rates: { gap: space.md },
  split: { gap: 4, backgroundColor: colors.canvas, borderRadius: radius.md, padding: space.lg },
  splitTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
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
