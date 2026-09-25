import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, hostApi } from "@/api";
import {
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  ErrorNotice,
  Field,
  PhoneFrame,
  RestoringScreen,
  ScreenHeader,
  TimeRangeField,
  WarningIcon,
  formatMinute,
} from "@/components/ui";
import { groupByHours } from "@/lib/hours";
import { formatRupees } from "@/lib/money";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { CalendarBlock, HostBooking, HostCalendar } from "@/types/api.types";

/**
 * Dates here are the space's own (IST) days, whatever zone the phone is in:
 * a host blocking "24 Sep" means 24 Sep at the space.
 */
const IST = "+05:30";
const dayStart = (date: string) => Date.parse(`${date}T00:00:00${IST}`);
const at = (date: string, minute: number) => new Date(dayStart(date) + minute * 60_000).toISOString();
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Segment =
  | { kind: "closed" | "available"; from: number; to: number }
  | { kind: "booked"; from: number; to: number; booking: HostBooking }
  | { kind: "blocked"; from: number; to: number; block: CalendarBlock };

/** One day as a run of closed / available / booked / blocked stretches, in minutes from midnight. */
function segmentsOf(day: HostCalendar["days"][number]): Segment[] {
  const start = dayStart(day.date);
  const clamp = (iso: string) => Math.max(0, Math.min(1440, Math.round((Date.parse(iso) - start) / 60_000)));
  const taken: Segment[] = [
    ...day.bookings.filter((b) => b.startsAt && b.endsAt).map((b) => ({ kind: "booked" as const, from: clamp(b.startsAt!), to: clamp(b.endsAt!), booking: b })),
    ...day.blocks.map((b) => ({ kind: "blocked" as const, from: clamp(b.startsAt), to: clamp(b.endsAt), block: b })),
  ].sort((a, b) => a.from - b.from);

  const open = (m: number) => day.windows.some((w) => w.startMinute <= m && m < w.endMinute);
  const points = new Set<number>([0, 1440]);
  day.windows.forEach((w) => (points.add(w.startMinute), points.add(Math.min(1440, w.endMinute))));
  taken.forEach((t) => (points.add(t.from), points.add(t.to)));
  const sorted = [...points].sort((a, b) => a - b);

  const out: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i]!, to = sorted[i + 1]!;
    if (to <= from) continue;
    const hit = taken.find((t) => t.from <= from && t.to >= to);
    const seg: Segment = hit ? { ...hit, from, to } : { kind: open(from) ? "available" : "closed", from, to };
    const prev = out.at(-1);
    // Merge neighbours of the same kind (and the same booking or block).
    if (
      prev &&
      prev.kind === seg.kind &&
      prev.to === seg.from &&
      (prev.kind !== "booked" || (seg.kind === "booked" && prev.booking.id === seg.booking.id)) &&
      (prev.kind !== "blocked" || (seg.kind === "blocked" && prev.block.id === seg.block.id))
    ) {
      prev.to = seg.to;
    } else out.push(seg);
  }
  return out;
}

/**
 * Calendar & blocking, as the prototype has it: a week strip, the chosen
 * day laid out hour by hour, and blocking that never touches a confirmed
 * booking. Blocking a whole day that has one is refused by the API with the
 * booking named; this screen turns that into the prototype's warning and
 * offers to block only the free hours around it.
 */
export default function HostCalendarScreen() {
  const { token, isRestoring } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [weekStart, setWeekStart] = useState(todayIST());
  const [selected, setSelected] = useState(todayIST());
  const [data, setData] = useState<HostCalendar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflictText, setConflictText] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [range, setRange] = useState({ startMinute: 8 * 60, endMinute: 10 * 60 });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      setData(await hostApi.calendar(token, id, weekStart, 7));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? "This space isn't yours, or no longer exists." : "Could not load the calendar.");
    }
  }, [token, id, weekStart]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const day = data?.days.find((d) => d.date === selected) ?? data?.days[0] ?? null;
  const segments = useMemo(() => (day ? segmentsOf(day) : []), [day]);

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      setConflictText(null);
      setPicking(false);
      setReason("");
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && /confirmed booking|being paid for/.test(err.message)) {
        setConflictText(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't change the calendar.");
      }
    } finally {
      setBusy(false);
    }
  };

  const blockDay = () => day && run(() => hostApi.block(token, id!, { kind: "day", date: day.date, reason: reason || undefined }), "The whole day is blocked.");
  const blockFree = () =>
    day && run(() => hostApi.block(token, id!, { kind: "day", date: day.date, freeOnly: true, reason: reason || undefined }), "Free hours blocked. The booking is untouched.");
  const blockRange = () =>
    day &&
    run(
      () => hostApi.block(token, id!, { kind: "range", startsAt: at(day.date, range.startMinute), endsAt: at(day.date, range.endMinute), reason: reason || undefined }),
      `${formatMinute(range.startMinute)}–${formatMinute(range.endMinute)} blocked.`
    );
  const unblockAll = () => day && run(async () => {
    for (const b of day.blocks) await hostApi.unblock(token, id!, b.id);
  }, "Unblocked.");

  const title = (date: string) => {
    const d = new Date(`${date}T00:00:00Z`);
    return `${WEEKDAYS_LONG[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`;
  };

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title="Calendar" sub={data?.listing.name ?? null} onBack={() => (router.canGoBack() ? router.back() : router.replace({ pathname: "/host/listing/[id]", params: { id: id! } }))} />
        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          <View style={s.monthRow}>
            <Pressable
              onPress={() => {
                const prev = addDays(weekStart, -7);
                if (prev >= todayIST()) (setWeekStart(prev), setSelected(prev));
                else (setWeekStart(todayIST()), setSelected(todayIST()));
              }}
              disabled={weekStart <= todayIST()}
              accessibilityRole="button"
              accessibilityLabel="Previous week"
              style={[s.arrow, weekStart <= todayIST() && s.dim]}
            >
              <ChevronLeftIcon />
            </Pressable>
            <Text style={s.month}>
              {MONTHS[new Date(`${weekStart}T00:00:00Z`).getUTCMonth()]} {weekStart.slice(0, 4)}
            </Text>
            <Pressable
              onPress={() => {
                const next = addDays(weekStart, 7);
                setWeekStart(next);
                setSelected(next);
              }}
              accessibilityRole="button"
              accessibilityLabel="Next week"
              style={s.arrow}
            >
              <ChevronRightIcon color={colors.ink} />
            </Pressable>
          </View>

          <View style={s.strip}>
            {(data?.days ?? []).map((d) => {
              const on = d.date === (day?.date ?? selected);
              const dot = d.blocks.length ? colors.danger : d.bookings.length ? colors.ink : null;
              return (
                <Pressable
                  key={d.date}
                  onPress={() => (setSelected(d.date), setConflictText(null), setNotice(null))}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  style={[s.dayChip, on && s.dayChipOn]}
                >
                  <Text style={[s.dayName, on && s.onInk]}>{WEEKDAYS[d.weekday]}</Text>
                  <Text style={[s.dayNum, on && s.onInk]}>{Number(d.date.slice(8))}</Text>
                  <View style={[s.dot, dot ? { backgroundColor: on ? colors.onInk : dot } : null]} />
                </Pressable>
              );
            })}
          </View>

          <View style={s.legend}>
            <Legend color={colors.ink} label="Booked" />
            <Legend color="#dcfce7" label="Available" border="#166534" />
            <Legend color={colors.dangerSurface} label="Blocked" border={colors.danger} />
            <Legend color={colors.canvas} label="Closed" />
          </View>

          {!data || !day ? (
            error ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : (
            <>
              <Text style={s.dayTitle}>{title(day.date)}</Text>

              {notice ? <Text style={s.notice}>{notice}</Text> : null}

              <View style={s.timeline}>
                {segments.map((seg, i) => (
                  <View key={i} style={s.segRow}>
                    <Text style={s.segTime}>{formatMinute(seg.from)}</Text>
                    <View
                      style={[
                        s.seg,
                        seg.kind === "closed" && s.segClosed,
                        seg.kind === "available" && s.segOpen,
                        seg.kind === "booked" && s.segBooked,
                        seg.kind === "blocked" && s.segBlocked,
                      ]}
                    >
                      {seg.kind === "closed" ? (
                        <Text style={s.segMuted}>Closed · outside your hours</Text>
                      ) : seg.kind === "available" ? (
                        <Text style={s.segOpenText}>Available {formatMinute(seg.from)} – {formatMinute(seg.to)}</Text>
                      ) : seg.kind === "booked" ? (
                        <>
                          <Text style={s.segBookedTitle}>
                            {seg.booking.held ? "BEING PAID FOR" : "BOOKED"} · {seg.booking.driver}
                          </Text>
                          <Text style={s.segBookedSub}>
                            {formatMinute(seg.from)} – {formatMinute(seg.to)} · {[seg.booking.vehicle.label, seg.booking.vehicle.number].filter(Boolean).join(" · ")}
                            {Number(seg.booking.earning) > 0 ? ` · earns ${formatRupees(seg.booking.earning)}` : ""}
                          </Text>
                        </>
                      ) : seg.kind === "blocked" ? (
                        <Text style={s.segBlockedText}>
                          Blocked {formatMinute(seg.from)} – {formatMinute(seg.to)}
                          {seg.block.reason ? ` · ${seg.block.reason}` : ""}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>

              {conflictText ? (
                <View style={s.warn}>
                  <View style={s.warnHead}>
                    <WarningIcon size={18} color={colors.accentInk} />
                    <Text style={s.warnTitle}>{title(day.date)} has a booking</Text>
                  </View>
                  <Text style={s.warnBody}>{conflictText}</Text>
                  <Button label="Block Free Hours Only" onPress={blockFree} busy={busy} />
                  <Button label="Cancel" variant="ghost" onPress={() => setConflictText(null)} />
                  <Text style={s.small}>Need to cancel the booking itself? Contact support — the driver is refunded in full.</Text>
                </View>
              ) : null}

              {picking ? (
                <View style={s.picker}>
                  <TimeRangeField startMinute={range.startMinute} endMinute={range.endMinute} onChange={setRange} />
                  <Field label="Reason" optional value={reason} onChangeText={setReason} placeholder="e.g. Plumber visiting" maxLength={100} />
                  <Button label={`Block ${formatMinute(range.startMinute)} – ${formatMinute(range.endMinute)}`} onPress={blockRange} busy={busy} />
                  <Button label="Cancel" variant="ghost" onPress={() => setPicking(false)} />
                </View>
              ) : conflictText ? null : (
                <View style={s.actions}>
                  {day.blocks.length > 0 ? <Button label="Unblock This Day" variant="ghost" onPress={unblockAll} busy={busy} /> : null}
                  <View style={s.actionRow}>
                    <View style={s.flex}>
                      <Button label="Block Time" variant="ghost" onPress={() => setPicking(true)} />
                    </View>
                    <View style={s.flex}>
                      <Button label="Block Whole Day" onPress={blockDay} busy={busy} />
                    </View>
                  </View>
                </View>
              )}

              <View style={s.weekly}>
                <View style={s.weeklyHead}>
                  <Text style={s.label}>WEEKLY HOURS</Text>
                  <Pressable onPress={() => router.push({ pathname: "/host/spot/availability", params: { id: id! } })} accessibilityRole="link" hitSlop={10}>
                    <Text style={s.link}>Edit</Text>
                  </Pressable>
                </View>
                {groupByHours(data.weeklyHours.map((w, i) => ({ ...w, id: String(i), isActive: true }))).map((row) => (
                  <Text key={row.label} style={s.weeklyRow}>
                    {row.label} · {row.hours}
                  </Text>
                ))}
                <Text style={s.small}>Repeats every week. Blocked dates override it.</Text>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

function Legend({ color, label, border }: { color: string; label: string; border?: string }) {
  return (
    <View style={s.legendItem}>
      <View style={[s.swatch, { backgroundColor: color, borderColor: border ?? color }]} />
      <Text style={s.small}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, gap: space.lg, paddingBottom: 32 },
  loading: { paddingVertical: space.xxl },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  arrow: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dim: { opacity: 0.3 },
  month: { fontSize: 17, fontWeight: "700", color: colors.ink },
  strip: { flexDirection: "row", gap: 6 },
  dayChip: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.canvas, gap: 2, minHeight: 64 },
  dayChipOn: { backgroundColor: colors.ink },
  dayName: { fontSize: 11, color: colors.inkMuted },
  dayNum: { fontSize: 16, fontWeight: "700", color: colors.ink },
  onInk: { color: colors.onInk },
  dot: { width: 6, height: 6, borderRadius: 3 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 3, borderWidth: 1 },
  small: { fontSize: 12, color: colors.inkMuted },
  dayTitle: { fontSize: 18, fontWeight: "700", color: colors.ink },
  notice: { fontSize: 13, color: "#166534", backgroundColor: "#f0fdf4", padding: space.md, borderRadius: radius.sm },
  timeline: { gap: 6 },
  segRow: { flexDirection: "row", gap: space.md, alignItems: "stretch" },
  segTime: { width: 44, fontSize: 12, color: colors.inkMuted, paddingTop: 10 },
  seg: { flex: 1, borderRadius: radius.sm, padding: space.md, minHeight: 44, justifyContent: "center", gap: 2 },
  segClosed: { backgroundColor: colors.canvas },
  segOpen: { backgroundColor: "#f0fdf4", borderWidth: 1, borderColor: "#bbf7d0" },
  segBooked: { backgroundColor: colors.ink },
  segBlocked: { backgroundColor: colors.dangerSurface, borderWidth: 1, borderColor: "#fecaca" },
  segMuted: { fontSize: 13, color: colors.inkMuted },
  segOpenText: { fontSize: 13, fontWeight: "600", color: "#166534" },
  segBookedTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.5, color: colors.onInk },
  segBookedSub: { fontSize: 12, color: colors.onInkMuted },
  segBlockedText: { fontSize: 13, fontWeight: "600", color: "#b91c1c" },
  warn: { backgroundColor: colors.accentSurface, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  warnHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  warnTitle: { fontSize: 15, fontWeight: "700", color: colors.accentInk },
  warnBody: { fontSize: 13, lineHeight: 19, color: colors.accentInk },
  picker: { gap: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.lg },
  actions: { gap: space.sm },
  actionRow: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  weekly: { gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.lg },
  weeklyHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted },
  link: { fontSize: 13, fontWeight: "600", color: colors.ink, textDecorationLine: "underline" },
  weeklyRow: { fontSize: 14, color: colors.ink },
});
