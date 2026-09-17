import { router } from "expo-router";
import { useState } from "react";
import { Button, ErrorNote, Field, Screen } from "../components/ui";
import { ApiError, updateMe } from "../lib/api";
import { useSession } from "../lib/session";

/**
 * Only reached when verify-code came back with profileComplete false -- i.e.
 * a new email arrived through the sign-in screen, so no name was captured.
 */
export default function ProfileScreen() {
  const { token, setUser } = useSession();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!token) {
      router.replace("/");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const user = await updateMe(token, {
        firstName: firstName.trim(),
        ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
      });
      setUser(user);
      router.replace("/account");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Your name" subtitle="So organizers know whose pass it is">
      <Field
        label="First name"
        value={firstName}
        onChangeText={setFirstName}
        placeholder="Ishan"
        autoCapitalize="words"
      />
      <Field
        label="Last name"
        value={lastName}
        onChangeText={setLastName}
        placeholder="Jaiswal"
        autoCapitalize="words"
        hint="Optional"
      />

      {error ? <ErrorNote message={error} /> : null}

      <Button
        label="Continue"
        onPress={submit}
        busy={busy}
        disabled={firstName.trim().length === 0}
      />
    </Screen>
  );
}
