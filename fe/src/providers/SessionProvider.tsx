import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { AuthUser } from "@/types/api.types";

interface SessionValue {
  token: string | null;
  user: AuthUser | null;
  isSignedIn: boolean;
  signIn: (token: string, user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Token is held in memory only, deliberately: a reload signs you out, which
 * makes the flow easy to exercise repeatedly. Persisting it needs
 * expo-secure-store on native and is a separate decision.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUserState] = useState<AuthUser | null>(null);

  const value = useMemo<SessionValue>(
    () => ({
      token,
      user,
      isSignedIn: token !== null,
      signIn: (nextToken, nextUser) => {
        setToken(nextToken);
        setUserState(nextUser);
      },
      setUser: setUserState,
      signOut: () => {
        setToken(null);
        setUserState(null);
      },
    }),
    [token, user]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return value;
}
