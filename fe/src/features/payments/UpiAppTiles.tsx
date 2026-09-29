import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRightIcon, QrIcon, UpiAppLogo } from "@/components/ui";
import { UPI_APP_LABELS } from "@/lib/payments";
import { colors, radius, space } from "@/theme";
import type { UpiApp } from "@/types/api.types";

/**
 * The UPI apps a payment can open, as logo tiles two to a row, then the
 * phone's own chooser ("default", Android only) and the QR fallback as full
 * rows beneath.
 *
 * Nothing here is "selected": each tile opens its app. The one opened last
 * says so, which answers "did it open GPay or PhonePe?" when the driver
 * comes back.
 */
export function UpiAppTiles({
  apps,
  lastOpened,
  onOpen,
  onShowQr,
}: {
  apps: UpiApp[];
  lastOpened: UpiApp | null;
  onOpen: (app: UpiApp) => void;
  onShowQr: () => void;
}) {
  const named = apps.filter((app) => app !== "default");
  const hasChooser = apps.includes("default");

  return (
    <View style={s.wrap}>
      <View style={s.grid}>
        {named.map((app) => (
          <Pressable
            key={app}
            onPress={() => onOpen(app)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${UPI_APP_LABELS[app]}`}
            style={({ pressed }) => [s.tile, pressed && s.pressed]}
          >
            <View style={s.tileTop}>
              <UpiAppLogo app={app} />
              {lastOpened === app ? <Text style={s.opened}>Opened</Text> : null}
            </View>
            <View style={s.tileBottom}>
              <Text style={s.tileName}>{UPI_APP_LABELS[app]}</Text>
              <ChevronRightIcon size={16} />
            </View>
          </Pressable>
        ))}
      </View>

      {hasChooser ? (
        <Row
          icon={<UpiAppLogo app="default" size={40} />}
          title="Other UPI app"
          sub={lastOpened === "default" ? "Opened · pick again from your phone's list" : "Pick from the UPI apps on this phone"}
          label="Open another UPI app"
          onPress={() => onOpen("default")}
        />
      ) : null}

      <Row
        icon={
          <View style={s.qrTile}>
            <QrIcon size={20} />
          </View>
        }
        title="Pay from another phone"
        sub="Show a QR code to scan"
        label="Show a QR code to pay from another phone"
        onPress={onShowQr}
      />
    </View>
  );
}

function Row({
  icon,
  title,
  sub,
  label,
  onPress,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [s.row, pressed && s.pressed]}
    >
      {icon}
      <View style={s.rowCopy}>
        <Text style={s.rowTitle}>{title}</Text>
        <Text style={s.rowSub}>{sub}</Text>
      </View>
      <ChevronRightIcon size={16} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  tile: {
    flexGrow: 1,
    flexBasis: "40%",
    minHeight: 108,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    justifyContent: "space-between",
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.canvas },
  tileTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  opened: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.accentInk,
    backgroundColor: colors.accentSurface,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    overflow: "hidden",
  },
  tileBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.md },
  tileName: { fontSize: 15, fontWeight: "600", color: colors.ink },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: space.md,
  },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  rowSub: { fontSize: 12, color: colors.inkMuted },
  qrTile: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
});
