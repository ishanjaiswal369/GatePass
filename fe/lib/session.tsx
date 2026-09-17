import { createContext, useContext, useState, type ReactNode } from "react";
import type { AuthUser } from "./api";

interface SessionValue {
  token: string | null;
  user: AuthUser | null;
  signIn: (token: string, user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Token is held in memory only. That is deliberate for a test harness: a
 * reload signs you out, which makes it easy to exercise the flow repeatedly.
 * Persisting it needs expo-secure-store (native) and is a separate decision.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUserState] = useState<AuthUser | null>(null);

  return (
    <SessionContext.Provider
      value={{
        token,
        user,
        signIn: (nextToken, nextUser) => {
          setToken(nextToken);
          setUserState(nextUser);
        },
        setUser: setUserState,
        signOut: () => {
          setToken(null);
          setUserState(null);
        },
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return value;
}
