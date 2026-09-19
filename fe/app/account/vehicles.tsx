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
  SegmentedControl,
  TrashIcon,
} from "@/components/ui";
import { VEHICLE_TYPES, type VehicleType } from "@/constants/enums";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { Vehicle } from "@/types/api.types";

const TYPE_SEGMENTS = VEHICLE_TYPES.map((value) => ({
  value,
  label: value.charAt(0) + value.slice(1).toLowerCase(),
}));

export default function VehiclesScreen() {
  const { token, isRestoring } = useSession();

  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [number, setNumber] = useState("");
  const [vehicleType, setVehicleType] = useState<VehicleType>("CAR");

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
      vehicleType,
    });

    setNumber("");
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
        <ScreenHeader title="Vehicles" sub={"Saved vehicles save you typing a number plate at every booking."} onBack={() => router.back()} />

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
                  <Text style={s.number}>{vehicle.vehicleNumber}</Text>
                  <Text style={s.type}>
                    {vehicle.vehicleType.charAt(0) +
                      vehicle.vehicleType.slice(1).toLowerCase()}
                    {vehicle.isDefault ? " · default" : ""}
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
            label="Vehicle number"
            value={number}
            // Uppercased as it is typed, which is how the API stores it, so
            // what the driver sees is what gets saved.
            onChangeText={(next) => setNumber(next.toUpperCase())}
            placeholder="MH01AB1234"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={15}
          />

          <SegmentedControl
            segments={TYPE_SEGMENTS}
            value={vehicleType}
            onChange={setVehicleType}
          />

          {error ? <ErrorNotice message={error} /> : null}

          <Button
            label="Add vehicle"
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
