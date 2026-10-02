import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { ApiError, notificationsApi, settingsApi } from "@/api";
import { BellIcon, Button, EmptyState, ErrorNotice, PhoneFrame, RestoringScreen, ScreenHeader, SegmentedControl } from "@/components/ui";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { InboxEntry, SettingSwitch, UserSettings } from "@/types/api.types";

type Tab = "inbox" | "settings";

/** The Settings tab, grouped and worded as the prototype has it. Each switch is a UserSettings key. */
const GROUPS: { title: string; rows: { key: SettingSwitch | null; label: string; sub: string }[] }[] = [
  {
    title: "AS A DRIVER",
    rows: [
      {
        key: null,
        label: "Bookings and payments",
        sub: "Confirmed, extended, cancelled; a payment that failed or a hold that ran out",
      },
      { key: "startingSoon", label: "Parking starting soon", sub: "30 minutes before" },
      { key: "endingSoon", label: "Parking ending soon", sub: "30 minutes before, with an option to extend" },
      { key: "refunds", label: "Refunds", sub: "When a refund is sent and when it arrives" },
      { key: "reviewReminders", label: "Review reminders", sub: "The day after a completed booking" },
    ],
  },
  {
    title: "AS A HOST",
    rows: [
      { key: "hostNewBookings", label: "New bookings", sub: "Each time a driver books your space" },
      { key: "hostPayouts", label: "Payouts", sub: "When money is sent to your bank, and when your payout account is active" },
      { key: "hostListing", label: "Listing status", sub: "Submitted, approved, and anything that needs your attention" },
    ],
  },
  {
    title: "HOW WE REACH YOU",
    rows: [
      { key: "push", label: "Push notifications", sub: "On your phones, as well as here" },
      { key: "email", label: "Email", sub: "Coming soon" },
      { key: "offers", label: "Offers and news", sub: "Occasional, never more than once a week" },
    ],
  },
];

/** Where an entry opens: its booking, else its spot, else nowhere. */
function destination(entry: InboxEntry): (() => void) | null {
  if (entry.bookingId) return () => router.push({ pathname: "/booking/[id]", params: { id: entry.bookingId! } });
  return null;
}

function stamp(iso: string): string {
  const at = new Date(iso);
  const today = new Date();
  return at.toDateString() === today.toDateString()
    ? at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toUpperCase()
    : at.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Inbox and settings on one screen, as the prototype has them.
 *
 * Opening the inbox marks what's on it as read -- the unread dot is "you
 * haven't seen this", and now they have. The entries themselves come from the
 * API, which is also what brings due reminders into being on each open.
 * Settings save per switch, optimistically, and roll back if the save fails.
 */
export default function NotificationsScreen() {
  const { token, isRestoring } = useSession();

  const [tab, setTab] = useState<Tab>("inbox");
  const [items, setItems] = useState<InboxEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<UserSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const page = await notificationsApi.list(token);
      setItems(page.items);
      setCursor(page.nextCursor);
      setError(null);
      if (page.unread > 0) void notificationsApi.markRead(token).catch(() => undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your notifications.");
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // The settings are read when their tab is first opened: most visits are to
  // the inbox and never look at them.
  useEffect(() => {
    if (tab !== "settings" || prefs !== null || !token) return;
    settingsApi
      .get(token)
      .then(setPrefs)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your settings."));
  }, [tab, prefs, token]);

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const back = () => (router.canGoBack() ? router.back() : router.replace("/account"));

  const loadMore = async () => {
    if (!cursor) return;
    setMore(true);
    try {
      const page = await notificationsApi.list(token, cursor);
      setItems((current) => [...(current ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setMore(false);
    }
  };

  const toggle = async (key: SettingSwitch, value: boolean) => {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, [key]: value });
    try {
      setPrefs(await settingsApi.update(token, { [key]: value }));
    } catch {
      setPrefs(before);
      setError("Couldn't save that setting. Try again.");
    }
  };

  const today = new Date().toDateString();
  const todays = (items ?? []).filter((n) => new Date(n.createdAt).toDateString() === today);
  const earlier = (items ?? []).filter((n) => new Date(n.createdAt).toDateString() !== today);

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title="Notifications" onBack={back} />

        <View style={s.tabs}>
          <SegmentedControl
            segments={[
              { value: "inbox", label: "Inbox" },
              { value: "settings", label: "Settings" },
            ]}
            value={tab}
            onChange={setTab}
          />
        </View>

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {tab === "inbox" ? (
            items === null ? (
              error ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<BellIcon size={26} />}
                title="Nothing here yet"
                body="Booking updates, reminders and refunds show up here."
              />
            ) : (
              <>
                {todays.length ? <Group title="TODAY" items={todays} /> : null}
                {earlier.length ? <Group title="EARLIER" items={earlier} /> : null}
                {cursor ? <Button label="Show more" variant="ghost" onPress={loadMore} busy={more} /> : null}
              </>
            )
          ) : prefs === null ? (
            <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : (
            GROUPS.map((group) => (
              <View key={group.title} style={s.group}>
                <Text style={s.label}>{group.title}</Text>
                <View style={s.card}>
                  {group.rows.map((row, i) => (
                    <View key={row.label} style={[s.prefRow, i === group.rows.length - 1 && s.last]}>
                      <View style={s.flex}>
                        <Text style={s.prefTitle}>{row.label}</Text>
                        <Text style={s.prefSub}>{row.sub}</Text>
                      </View>
                      {row.key === null ? (
                        <Text style={s.always}>Always on</Text>
                      ) : (
                        <Switch
                          value={prefs[row.key]}
                          onValueChange={(value) => void toggle(row.key!, value)}
                          accessibilityLabel={row.label}
                          trackColor={{ true: colors.ink, false: colors.trackOff }}
                          thumbColor={colors.surface}
                          // react-native-web colours the "on" thumb from this, not thumbColor.
                          {...({ activeThumbColor: colors.surface } as object)}
                        />
                      )}
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

function Group({ title, items }: { title: string; items: InboxEntry[] }) {
  return (
    <View style={s.group}>
      <Text style={s.label}>{title}</Text>
      {items.map((entry) => {
        const open = destination(entry);
        return (
          <Pressable
            key={entry.id}
            onPress={open ?? undefined}
            disabled={!open}
            accessibilityRole={open ? "button" : "text"}
            style={({ pressed }) => [s.entry, pressed && open ? s.pressed : null]}
          >
            <View style={[s.dot, entry.readAt ? s.dotRead : null]} />
            <View style={s.flex}>
              <Text style={s.entryTitle}>{entry.title}</Text>
              <Text style={s.entryBody}>{entry.body}</Text>
            </View>
            <Text style={s.when}>{stamp(entry.createdAt)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  tabs: { paddingHorizontal: 20, paddingTop: space.lg },
  body: { padding: 20, gap: space.lg, paddingBottom: 32 },
  loading: { paddingVertical: space.xxl },
  group: { gap: space.sm },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted },
  entry: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pressed: { backgroundColor: colors.canvas },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: colors.accent },
  dotRead: { backgroundColor: "transparent" },
  flex: { flex: 1, gap: 2 },
  entryTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  entryBody: { fontSize: 13, lineHeight: 19, color: colors.inkSoft },
  when: { fontSize: 12, color: colors.inkMuted },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.lg },
  prefRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 60,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  last: { borderBottomWidth: 0 },
  prefTitle: { fontSize: 14, fontWeight: "600", color: colors.ink },
  prefSub: { fontSize: 12, color: colors.inkMuted },
  always: { fontSize: 12, fontWeight: "700", color: colors.inkMuted },
});
