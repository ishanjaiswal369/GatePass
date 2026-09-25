import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import Constants from "expo-constants";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, authApi, notificationsApi } from "@/api";
import {
  BellIcon,
  BottomNav,
  Button,
  Card,
  CardIcon,
  CarIcon,
  ChatIcon,
  HeartIcon,
  PinIcon,
  ShieldIcon,
  StatusChip,
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
import { LEGAL_BASE_URL, SUPPORT_EMAIL, supportMailto } from "@/constants/support";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSession } from "@/providers/SessionProvider";
import { colors, space } from "@/theme";
import type { MeResult, UserAddress, Vehicle } from "@/types/api.types";

const APP_VERSION = Constants.expoConfig?.version ?? "dev";

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
  return `${vehicles.length} saved · ${preferred.label ?? preferred.vehicleNumber} is default`;
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
  const [unread, setUnread] = useState(0);

  // One request: /auth/me eager-loads vehicles and address with the user.
  const vehicles = me?.vehicles ?? [];
  const address = me?.address ?? null;

  const load = useCallback(async () => {
    if (!token) return;

    try {
      const [profile, inbox] = await Promise.all([
        authApi.getMe(token),
        notificationsApi.unreadCount(token).catch(() => ({ unread: 0 })),
      ]);
      setMe(profile);
      setUnread(inbox.unread);
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
          sub={[me?.email, formatPhone(me?.phone ?? null)].filter(Boolean).join(" · ") || null}
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

          <View style={s.chips}>
            <StatusChip label="Driver" tone="ink" />
            {me?.hasHostProfile ? (
              <StatusChip
                label={`Host · ${me.liveSpaces} live ${me.liveSpaces === 1 ? "space" : "spaces"}`}
                tone="neutral"
              />
            ) : null}
          </View>

          <Card heading="Account">
            <SettingsRow
              label="Personal Information"
              value={fullName ? "Name, email, phone" : null}
              icon={<UserIcon />}
              onPress={() => router.push("/account/details")}
            />
            <SettingsRow
              label="My Vehicles"
              value={formatVehicles(vehicles)}
              icon={<CarIcon />}
              onPress={() => router.push("/account/vehicles")}
            />
            <SettingsRow
              label="Saved Parking"
              value={me ? `${me.savedCount} ${me.savedCount === 1 ? "space" : "spaces"}` : null}
              icon={<HeartIcon size={18} />}
              onPress={() => router.push("/account/saved")}
            />
            <SettingsRow
              label="Payment Methods"
              value="UPI, cards and netbanking"
              icon={<CardIcon />}
              onPress={() => router.push("/account/payments")}
            />
            <SettingsRow
              label="Notifications"
              value={unread > 0 ? `${unread} new` : "Reminders, bookings, payouts"}
              icon={<BellIcon />}
              onPress={() => router.push("/notifications")}
            />
            <SettingsRow
              label="Language"
              value="English · हिन्दी coming soon"
              icon={<ChatIcon />}
              onPress={() => undefined}
            />
            <SettingsRow
              label="Password"
              value={me?.hasPassword ? "Set" : null}
              icon={<LockIcon />}
              onPress={() => router.push("/password")}
            />
            <SettingsRow
              label="Address"
              value={formatAddress(address)}
              icon={<PinIcon size={18} color={colors.ink} />}
              onPress={() => router.push("/account/address")}
              last
            />
          </Card>

          <Card heading="Support">
            <SettingsRow
              label="Help & Support"
              value={SUPPORT_EMAIL ? `Email ${SUPPORT_EMAIL}` : "Not set up in this build"}
              icon={<ChatIcon />}
              onPress={() => {
                const mail = supportMailto("Help with GatePass");
                if (mail) void Linking.openURL(mail);
              }}
            />
            <SettingsRow
              label="Terms & Privacy"
              value={LEGAL_BASE_URL ? "How we handle bookings, refunds and your data" : "Not set up in this build"}
              icon={<ShieldIcon />}
              onPress={() => {
                if (LEGAL_BASE_URL) void Linking.openURL(`${LEGAL_BASE_URL.replace(/\/$/, "")}/terms.html`);
              }}
              last
            />
          </Card>

          <View style={s.spacer} />

          <Text style={s.version}>GatePass · version {APP_VERSION}</Text>

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
  chips: { flexDirection: "row", gap: space.sm },
  version: { fontSize: 12, color: colors.inkMuted, textAlign: "center" },
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
