import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, authApi, profileApi } from "@/api";
import {
  BottomNav,
  Button,
  Card,
  ErrorNotice,
  LockIcon,
  MailIcon,
  PhoneFrame,
  RestoringScreen,
  SettingsRow,
  UserIcon,
  type NavKey,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { useSession } from "@/providers/SessionProvider";
import { colors, space } from "@/theme";
import type { MeResult, SessionRow, UserAddress, Vehicle } from "@/types/api.types";

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
  const insets = useScreenInsets();

  const [me, setMe] = useState<MeResult | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [address, setAddress] = useState<UserAddress | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;

    try {
      const [user, vehicleList, addressResult, sessionResult] = await Promise.all([
        authApi.getMe(token),
        profileApi.listVehicles(token),
        profileApi.getAddress(token),
        authApi.listSessions(token),
      ]);

      setMe(user);
      setVehicles(vehicleList.vehicles);
      setAddress(addressResult.address);
      setSessions(sessionResult.sessions);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Could not load your profile"
      );
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScrollView
          contentContainerStyle={[s.body, { paddingTop: insets.top + 32 }]}
        >
          <View style={s.heading}>
            <Text style={s.title}>{fullName || "Your profile"}</Text>
            <Text style={s.sub}>{me?.email}</Text>
          </View>

          {loadError ? <ErrorNotice message={loadError} /> : null}

          <Card heading="Account">
            <SettingsRow
              label="Personal details"
              value={fullName ? `${fullName}${me?.phone ? ` · ${formatPhone(me.phone)}` : ""}` : null}
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
              label="Address"
              value={formatAddress(address)}
              onPress={() => router.push("/account/address")}
              last
            />
          </Card>

          <Card heading={`Devices (${sessions.length})`}>
            {sessions.map((session) => (
              <View key={session.id} style={s.session}>
                <Text style={s.sessionName}>
                  {session.deviceName ?? session.deviceType}
                  {session.current ? "  · this device" : ""}
                </Text>
                <Text style={s.sessionMeta}>
                  {new Date(session.lastActiveAt).toLocaleString()}
                </Text>
              </View>
            ))}
          </Card>

          <View style={s.spacer} />

          <Button label="Log out" size="lg" variant="ghost" onPress={endSession} busy={busy} />
        </ScrollView>

        <BottomNav active="profile" onNavigate={navigate} />
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { paddingHorizontal: 20, paddingBottom: 20, gap: space.lg, flexGrow: 1 },
  heading: { gap: space.xs },
  title: { fontSize: 27, fontWeight: "700", color: colors.ink, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: colors.inkMuted },
  session: {
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 2,
  },
  sessionName: { fontSize: 15, color: colors.ink, fontWeight: "600" },
  sessionMeta: { fontSize: 12, color: colors.inkFaint },
  spacer: { flexGrow: 1, minHeight: space.lg },
});
