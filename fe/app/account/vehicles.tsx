import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ApiError, profileApi } from "@/api";
import {
  Button,
  CheckIcon,
  ErrorNotice,
  Field,
  PhoneFrame,
  ScreenHeader,
  RestoringScreen,
  TrashIcon,
} from "@/components/ui";
import type { VehicleSize, VehicleType } from "@/constants/enums";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { Vehicle } from "@/types/api.types";

/**
 * The prototype's five body types. Pricing is per vehicle type (car or bike),
 * so four of these are a CAR with a size -- the same sizes a spot's limit is
 * given in -- and Bike is a BIKE.
 */
const BODY_TYPES: { key: string; label: string; vehicleType: VehicleType; size: VehicleSize | null }[] = [
  { key: "HATCHBACK", label: "Hatchback", vehicleType: "CAR", size: "HATCHBACK" },
  { key: "SEDAN", label: "Sedan", vehicleType: "CAR", size: "SEDAN" },
  { key: "SUV", label: "SUV", vehicleType: "CAR", size: "SUV" },
  { key: "BIKE", label: "Bike", vehicleType: "BIKE", size: null },
  { key: "VAN", label: "Van", vehicleType: "CAR", size: "VAN" },
];

/** "SUV", "Bike", "Car": what a saved vehicle is, in words. */
function bodyLabel(vehicle: Vehicle): string {
  if (vehicle.size) return BODY_TYPES.find((t) => t.key === vehicle.size)?.label ?? vehicle.size;
  return vehicle.vehicleType === "BIKE" ? "Bike" : vehicle.vehicleType === "CAR" ? "Car" : "Other";
}

export default function VehiclesScreen() {
  const { token, isRestoring } = useSession();

  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [number, setNumber] = useState("");
  const [label, setLabel] = useState("");
  const [body, setBody] = useState(BODY_TYPES[2]!);

  const load = useCallback(async () => {
    if (!token) return;

    try {
      const { vehicles: rows } = await profileApi.listVehicles(token);
      setVehicles(rows);
      setLoadError(null);
    } catch (err) {
      setVehicles([]);
      setLoadError(
        err instanceof ApiError ? err.message : "Could not load your vehicles"
      );
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const { run: add, busy, error } = useAsyncAction(async () => {
    if (!token) return;

    await profileApi.addVehicle(token, {
      vehicleNumber: number.trim(),
      vehicleType: body.vehicleType,
      size: body.size,
      ...(label.trim() ? { label: label.trim() } : {}),
    });

    setNumber("");
    setLabel("");
    await load();
  });

  const { run: makeDefault } = useAsyncAction(async (id: string) => {
    if (!token) return;
    await profileApi.setDefaultVehicle(token, id);
    await load();
  });

  const { run: remove } = useAsyncAction(async (id: string) => {
    if (!token) return;
    await profileApi.removeVehicle(token, id);
    await load();
  });

  if (isRestoring) {
    return <RestoringScreen />;
  }

  if (!token) {
    return <Redirect href="/" />;
  }

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title="My Vehicles" sub={"Your default vehicle is picked for you at checkout. You can switch before paying."} onBack={() => router.back()} />

        <ScrollView contentContainerStyle={s.body}>
        {loadError ? <ErrorNotice message={loadError} /> : null}

        {vehicles === null ? (
          <ActivityIndicator color={colors.ink} style={s.loading} />
        ) : vehicles.length === 0 ? (
          <Text style={s.empty}>No vehicles saved yet.</Text>
        ) : (
          <View style={s.list}>
            {vehicles.map((vehicle) => (
              <View key={vehicle.id} style={s.row}>
                <View style={s.rowCopy}>
                  <Text style={s.number}>{vehicle.label ?? vehicle.vehicleNumber}</Text>
                  <Text style={s.type}>
                    {vehicle.label ? `${vehicle.vehicleNumber} · ` : ""}
                    {bodyLabel(vehicle)}
                    {vehicle.isDefault ? " · Default for bookings" : ""}
                  </Text>
                </View>

                {vehicle.isDefault ? (
                  <View style={s.defaultMark}>
                    <CheckIcon size={14} color={colors.onInk} />
                  </View>
                ) : (
                  <Pressable
                    onPress={() => makeDefault(vehicle.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Make ${vehicle.vehicleNumber} the default`}
                    style={s.action}
                  >
                    <Text style={s.actionLabel}>Default</Text>
                  </Pressable>
                )}

                <Pressable
                  onPress={() => remove(vehicle.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${vehicle.vehicleNumber}`}
                  style={s.action}
                >
                  <TrashIcon />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={s.addBlock}>
          <Text style={s.addHeading}>ADD A VEHICLE</Text>

          <Field
            label="Make and model"
            optional
            value={label}
            onChangeText={setLabel}
            placeholder="e.g. Hyundai Creta"
            maxLength={60}
          />

          <Field
            label="Registration number"
            hint="As printed on your RC. Security checks it at the gate."
            value={number}
            // Uppercased as it is typed, which is how the API stores it, so
            // what the driver sees is what gets saved.
            onChangeText={(next) => setNumber(next.toUpperCase())}
            placeholder="e.g. MH 12 AB 1234"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={15}
          />

          <View style={s.types} accessibilityRole="radiogroup" accessibilityLabel="Type">
            {BODY_TYPES.map((type) => {
              const on = type.key === body.key;
              return (
                <Pressable
                  key={type.key}
                  onPress={() => setBody(type)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  style={[s.typeChip, on && s.typeChipOn]}
                >
                  <Text style={[s.typeText, on && s.typeTextOn]}>{type.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {error ? <ErrorNotice message={error} /> : null}

          <Button
            label="Save Vehicle"
            size="lg"
            onPress={add}
            busy={busy}
            disabled={number.trim().length < 6}
          />
        </View>
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  types: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  typeChip: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  typeChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  typeText: { fontSize: 14, fontWeight: "600", color: colors.ink },
  typeTextOn: { color: colors.onInk },
  screen: { flex: 1, backgroundColor: colors.surface },
  body: {
    paddingHorizontal: 20,
    paddingTop: space.lg,
    paddingBottom: 20,
    gap: space.lg,
    flexGrow: 1,
  },
  loading: { paddingVertical: space.xl },
  empty: { fontSize: 14, color: colors.inkMuted },
  list: { gap: space.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  rowCopy: { flexGrow: 1, flexShrink: 1, gap: 2 },
  number: { fontSize: 15, fontWeight: "700", color: colors.ink, letterSpacing: 0.5 },
  type: { fontSize: 12, color: colors.inkMuted },
  defaultMark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  action: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { fontSize: 12, fontWeight: "600", color: colors.inkMuted },
  addBlock: { gap: space.md, paddingTop: space.sm },
  addHeading: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: colors.inkMuted,
  },
});
