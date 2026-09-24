import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { ApiError, authApi } from "@/api";
import {
  BottomNav,
  Button,
  Card,
  ErrorNotice,
  HeaderAction,
  LockIcon,
  LogoutIcon,
  PhoneFrame,
  RestoringScreen,
  ScreenHeader,
  SettingsRow,
  TrashIcon,
  UserIcon,
  type NavKey,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSession } from "@/providers/SessionProvider";
import { colors, space } from "@/theme";
import type { MeResult, UserAddress, Vehicle } from "@/types/api.types";

/** +919876543210 reads better as +91 98765 43210. */
function formatPhone(phone: string | null): string | null {
  if (!phone) return null;
  const local = phone.replace("+91", "");
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}

function formatAddress(address: UserAddress | null): string | null {
  if (!address) return null;
  return `${address.addressLine}, ${address.city}`;
}

function formatVehicles(vehicles: Vehicle[]): string | null {
  if (vehicles.length === 0) return null;
  const preferred = vehicles.find((v) => v.isDefault) ?? vehicles[0]!;
  const others = vehicles.length - 1;
  return others > 0
    ? `${preferred.vehicleNumber} +${others} more`
    : preferred.vehicleNumber;
}

/**
 * The profile hub. Each row shows what that section currently holds, so the
 * answer to "have I filled this in?" is on this screen rather than one tap
 * inside each of them.
 */
export default function AccountScreen() {
  const { token, signOut, isRestoring } = useSession();

  const [me, setMe] = useState<MeResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // One request: /auth/me eager-loads vehicles and address with the user.
  const vehicles = me?.vehicles ?? [];
  const address = me?.address ?? null;

  const load = useCallback(async () => {
    if (!token) return;

    try {
      setMe(await authApi.getMe(token));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Could not load your profile"
      );
    }
  }, [token]);

  /**
   * On focus, not on mount. Returning from a sub-screen does not remount this
   * one -- it is still on the stack -- so a plain useEffect would leave the
   * rows showing whatever was true when the hub first opened. Saving an
   * address and coming back then still read "Not set" while the database had
   * it, which is exactly the bug this replaced.
   */
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const { run: endSession, busy } = useAsyncAction(async () => {
    if (token) {
      // Signing out locally matters more than the call succeeding.
      await authApi.logout(token).catch(() => undefined);
    }
    signOut();
  });

  const navigate = (key: NavKey) => {
    if (key === "home") router.push("/home");
    if (key === "bookings") router.push("/bookings");
    if (key === "host") router.push("/host");
  };

  if (isRestoring) {
    return <RestoringScreen />;
  }

  if (!token) {
    return <Redirect href="/" />;
  }

  const fullName = [me?.firstName, me?.lastName].filter(Boolean).join(" ");
  const initial = (me?.firstName ?? me?.email ?? "?").charAt(0).toUpperCase();

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader
          title={fullName || "Your profile"}
          sub={me?.email}
          initial={initial}
          leading={
            <HeaderAction
              label="Log out"
              icon={<LogoutIcon size={15} />}
              onPress={endSession}
              busy={busy}
            />
          }
        />

        <ScrollView contentContainerStyle={s.body}>
          {loadError ? <ErrorNotice message={loadError} /> : null}

          <Card heading="Account">
            <SettingsRow
              label="Personal details"
              value={
                fullName
                  ? `${fullName}${me?.phone ? ` · ${formatPhone(me.phone)}` : ""}`
                  : null
              }
              icon={<UserIcon />}
              onPress={() => router.push("/account/details")}
            />
            <SettingsRow
              label="Password"
              value={me?.hasPassword ? "Set" : null}
              icon={<LockIcon />}
              onPress={() => router.push("/password")}
              last
            />
          </Card>

          <Card heading="Driving">
            <SettingsRow
              label="Vehicles"
              value={formatVehicles(vehicles)}
              onPress={() => router.push("/account/vehicles")}
            />
            <SettingsRow
              label="Saved parking"
              value="Spaces you've saved for later"
              onPress={() => router.push("/account/saved")}
            />
            <SettingsRow
              label="Address"
              value={formatAddress(address)}
              onPress={() => router.push("/account/address")}
              last
            />
          </Card>

          <View style={s.spacer} />

          <Button
            label="Delete account"
            size="lg"
            variant="danger"
            leadingIcon={<TrashIcon color={colors.danger} />}
            onPress={() => router.push("/account/delete")}
          />
        </ScrollView>

        <BottomNav active="profile" onNavigate={navigate} />
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
  spacer: { flexGrow: 1, minHeight: space.lg },
});
