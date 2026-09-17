import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { healthCheck } from "../lib/api";

export default function Home() {
  const [status, setStatus] = useState<string>("checking...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    healthCheck()
      .then((data) => setStatus(data.status))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <View style={styles.frame}>
      <View style={styles.container}>
        <Text style={styles.title}>GatePass</Text>
        <Text style={styles.label}>API Status:</Text>
        <Text style={error ? styles.error : styles.status}>
          {error ?? status}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f3f4f6",
  },
  container: {
    width: 375,
    height: 667,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  title: { fontSize: 32, fontWeight: "bold" },
  label: { fontSize: 16, color: "#666" },
  status: { fontSize: 18, color: "#22c55e", fontWeight: "600" },
  error: { fontSize: 18, color: "#ef4444" },
});
