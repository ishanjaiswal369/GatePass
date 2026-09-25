import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import { Checkbox, ChevronDownIcon, Field, OptionCard, RestoringScreen, WizardShell } from "@/components/ui";
import type { Amenity, VehicleSize } from "@/constants/enums";
import { TOTAL_STEPS, firstStepPath, isLiveStatus, stepHref, stepNumber } from "@/constants/wizard";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { useWizardContinue } from "@/hooks/useWizardContinue";
import { cmToFeetText, feetToCm, vehicleTypesOf } from "@/lib/listingRules";
import { AMENITY_LABELS } from "@/lib/spotLabels";
import { colors, radius, space, type } from "@/theme";

/**
 * Step 4. What the space offers, and what can park in it.
 *
 * Covered or open is its own question (it is the COVERED amenity underneath,
 * so it can't be answered twice). SUVs and vans are sizes of car, not their
 * own prices: the four vehicle boxes and "largest car" are two views of one
 * answer -- the biggest car that fits -- so they can never disagree. What's
 * optional (size limits, extra notes) sits folded away until wanted.
 */

/** Amenities offered as tick boxes. COVERED is the question above; 24/7 comes from the hours. */
const AMENITY_CHOICES: Amenity[] = ["CCTV", "SECURITY_GUARD", "WELL_LIT", "EV_CHARGING", "GATED", "EASY_ACCESS", "WASHROOM"];

const SIZES: { value: VehicleSize; label: string; sub: string }[] = [
  { value: "HATCHBACK", label: "Small", sub: "Hatchbacks" },
  { value: "SEDAN", label: "Medium", sub: "Up to sedans" },
  { value: "SUV", label: "SUV", sub: "SUVs and MUVs" },
  { value: "VAN", label: "Large", sub: "Vans and large vehicles" },
];

const rank = (size: VehicleSize | null) => (size ? SIZES.findIndex((s) => s.value === size) : -1);

export default function DetailsScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();
  const back = useWizardBack("details", spot?.id);
  const proceed = useWizardContinue("details");

  const [covered, setCovered] = useState<boolean | null>(null);
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [otherOn, setOtherOn] = useState(false);
  const [other, setOther] = useState("");
  const [bikes, setBikes] = useState(false);
  /** The largest car that fits; null = cars can't park. */
  const [carSize, setCarSize] = useState<VehicleSize | null>(null);
  const [height, setHeight] = useState("");
  const [width, setWidth] = useState("");
  const [length, setLength] = useState("");
  const [notes, setNotes] = useState("");
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    if (!spot) return;
    const types = vehicleTypesOf(spot);
    const answered = spot.vehicleTypes.length > 0;
    // A garage is covered; otherwise ask, unless this step was answered before.
    setCovered(spot.amenities.includes("COVERED") ? true : answered ? false : spot.spaceType === "GARAGE" ? true : null);
    setAmenities(spot.amenities.filter((a) => a !== "COVERED"));
    setOtherOn(Boolean(spot.amenityNote));
    setOther(spot.amenityNote ?? "");
    setBikes(types.includes("BIKE"));
    setCarSize(types.includes("CAR") ? spot.maxVehicleSize ?? "VAN" : null);
    setHeight(cmToFeetText(spot.maxVehicleHeightCm));
    setWidth(cmToFeetText(spot.bayWidthCm));
    setLength(cmToFeetText(spot.bayLengthCm));
    setNotes(spot.rules ?? "");
    setLimitsOpen(Boolean(spot.maxVehicleHeightCm || spot.bayWidthCm || spot.bayLengthCm));
    setNotesOpen(Boolean(spot.rules));
  }, [spot]);

  // The four boxes are views of carSize: SUVs implies cars, vans implies SUVs.
  const cars = carSize !== null;
  const suvs = rank(carSize) >= rank("SUV");
  const vans = carSize === "VAN";
  const setCars = (on: boolean) => setCarSize(on ? carSize ?? "SEDAN" : null);
  const setSuvs = (on: boolean) => setCarSize(on ? (vans ? "VAN" : "SUV") : cars ? "SEDAN" : null);
  const setVans = (on: boolean) => setCarSize(on ? "VAN" : suvs ? "SUV" : carSize);

  const toggleAmenity = (amenity: Amenity, on: boolean) =>
    setAmenities((current) => (on ? [...current, amenity] : current.filter((a) => a !== amenity)));

  const feet = (text: string) => (text.trim() ? Number(text) : null);
  const heightFt = feet(height);
  const widthFt = feet(width);
  const lengthFt = feet(length);
  const heightBad = heightFt !== null && !(heightFt >= 3.3 && heightFt <= 16.4);
  const bayBad = (v: number | null) => v !== null && !(v >= 5 && v <= 49);

  const missing =
    covered === null
      ? "Choose covered or open to continue."
      : !bikes && !cars
        ? "Choose at least one vehicle type."
        : otherOn && !other.trim()
          ? "Describe the other amenity, or untick it."
          : heightBad || bayBad(widthFt) || bayBad(lengthFt)
            ? "Check the size limits."
            : null;

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spot || covered === null) return;

    const saved = await spotListingApi.saveDetails(token, spot.id, {
      covered,
      amenities,
      amenityNote: otherOn ? other.trim() || null : null,
      vehicleTypes: [...(cars ? (["CAR"] as const) : []), ...(bikes ? (["BIKE"] as const) : [])],
      maxVehicleSize: carSize,
      maxVehicleHeightCm: heightFt !== null ? feetToCm(heightFt) : null,
      bayWidthCm: widthFt !== null ? feetToCm(widthFt) : null,
      bayLengthCm: lengthFt !== null ? feetToCm(lengthFt) : null,
      notes: notesOpen ? notes.trim() || null : null,
    });

    // A live space that now takes a vehicle it has no price for goes to
    // Pricing, or that vehicle would never find it.
    const unpriced = saved.vehicleTypes.some((t) => !saved.pricing.some((row) => row.vehicleType === t));
    if (isLiveStatus(saved.status) && unpriced) {
      router.replace(stepHref("pricing", saved.id));
      return;
    }
    proceed(spot);
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href={firstStepPath()} />;

  const decimal = (text: string) => text.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 4);

  return (
    <WizardShell
      title="Parking details"
      sub="Tell drivers what your parking space offers."
      step={stepNumber("details")}
      totalSteps={TOTAL_STEPS}
      onBack={back}
      onContinue={save}
      canContinue={missing === null}
      busy={busy}
      error={error}
      footerNote={missing ?? undefined}
    >
      <Group title="PARKING TYPE">
        <View style={s.pair} accessibilityRole="radiogroup">
          <View style={s.flex}>
            <OptionCard label="Covered" description="Roof overhead" selected={covered === true} onPress={() => setCovered(true)} />
          </View>
          <View style={s.flex}>
            <OptionCard label="Open" description="Open to the sky" selected={covered === false} onPress={() => setCovered(false)} />
          </View>
        </View>
      </Group>

      <Group title="VEHICLES" sub="Which vehicles can use this space?">
        <Checkbox label="Bikes / Scooters" checked={bikes} onChange={setBikes} />
        <Checkbox label="Cars" checked={cars} onChange={setCars} />
        <Checkbox label="SUVs" checked={suvs} onChange={setSuvs} />
        <Checkbox label="Vans / Large vehicles" checked={vans} onChange={setVans} />
        {cars ? (
          <View style={s.sizes}>
            <Text style={s.label}>Largest car that fits</Text>
            <View style={s.chips} accessibilityRole="radiogroup">
              {SIZES.map((size) => {
                const on = carSize === size.value;
                return (
                  <Pressable
                    key={size.value}
                    onPress={() => setCarSize(size.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    aria-checked={on}
                    accessibilityLabel={`${size.label}: ${size.sub}`}
                    style={[s.chip, on && s.chipOn]}
                  >
                    <Text style={[s.chipText, on && s.chipTextOn]}>{size.label}</Text>
                    <Text style={[s.chipSub, on && s.chipTextOn]}>{size.sub}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </Group>

      <Group title="AMENITIES" sub="Only tick what's always true — drivers filter on these.">
        {AMENITY_CHOICES.map((amenity) => (
          <Checkbox
            key={amenity}
            label={AMENITY_LABELS[amenity]}
            checked={amenities.includes(amenity)}
            onChange={(on) => toggleAmenity(amenity, on)}
          />
        ))}
        <Checkbox label="Other" checked={otherOn} onChange={setOtherOn} />
        {otherOn ? (
          <Field label="Other amenity" value={other} onChangeText={setOther} placeholder="Car wash on request" maxLength={100} />
        ) : null}
        <Text style={s.note}>Covered is set above. 24/7 access is shown automatically when your hours cover every day, all day.</Text>
      </Group>

      <Fold title="Size limits" open={limitsOpen} onToggle={() => setLimitsOpen(!limitsOpen)}>
        <Text style={s.note}>So a driver knows their vehicle physically fits before they arrive.</Text>
        <Field
          label="Maximum vehicle height (ft)"
          optional
          value={height}
          onChangeText={(t) => setHeight(decimal(t))}
          keyboardType="decimal-pad"
          placeholder="7"
          error={heightBad ? "Between 3.3 and 16.4 ft." : null}
          hint="Leave blank if there's no roof or barrier."
        />
        <View style={s.pair}>
          <View style={s.flex}>
            <Field
              label="Bay width (ft)"
              optional
              value={width}
              onChangeText={(t) => setWidth(decimal(t))}
              keyboardType="decimal-pad"
              placeholder="8"
              error={bayBad(widthFt) ? "5–49 ft" : null}
            />
          </View>
          <View style={s.flex}>
            <Field
              label="Bay length (ft)"
              optional
              value={length}
              onChangeText={(t) => setLength(decimal(t))}
              keyboardType="decimal-pad"
              placeholder="16"
              error={bayBad(lengthFt) ? "5–49 ft" : null}
            />
          </View>
        </View>
      </Fold>

      <Fold title="Additional details" open={notesOpen} onToggle={() => setNotesOpen(!notesOpen)}>
        <Field
          label="Anything else drivers should know"
          optional
          value={notes}
          onChangeText={setNotes}
          placeholder="Space is suitable for sedans and compact SUVs. Large SUVs may have limited turning space."
          multiline
          maxLength={300}
          style={s.notes}
          hint={`Shown to drivers before they book · ${notes.length}/300`}
        />
      </Fold>
    </WizardShell>
  );
}

function Group({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <View style={s.group}>
      <Text style={s.groupTitle} accessibilityRole="header">
        {title}
      </Text>
      {sub ? <Text style={s.groupSub}>{sub}</Text> : null}
      {children}
    </View>
  );
}

/** An optional section, folded until the host wants it. */
function Fold({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <View style={s.fold}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        style={s.foldHead}
      >
        <Text style={s.foldTitle}>
          {title} <Text style={s.optional}>optional</Text>
        </Text>
        <View style={open ? s.chevronOpen : undefined}>
          <ChevronDownIcon size={18} color={colors.ink} />
        </View>
      </Pressable>
      {open ? <View style={s.foldBody}>{children}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: space.md },
  groupTitle: { ...type.label, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 0.6 },
  groupSub: { fontSize: 14, color: colors.ink, marginTop: -4 },
  pair: { flexDirection: "row", gap: space.md },
  sizes: { gap: space.sm, marginTop: space.xs },
  label: { ...type.label, color: colors.ink },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    minHeight: 52,
    minWidth: "47%",
    flexGrow: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 14, fontWeight: "700", color: colors.ink },
  chipSub: { fontSize: 12, color: colors.inkMuted },
  chipTextOn: { color: colors.onInk },
  note: { ...type.caption, color: colors.inkFaint, lineHeight: 18 },
  fold: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  foldHead: {
    minHeight: 52,
    paddingHorizontal: space.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  foldTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  optional: { fontSize: 11, fontWeight: "400", color: colors.inkFaint },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  foldBody: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.lg },
  notes: { minHeight: 80 },
});
