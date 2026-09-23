import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { authApi } from "@/api";
import { clearDraft } from "@/features/search/searchDraft";
import { clearSession, loadSession, saveSession } from "@/lib/tokenStore";
import type { AuthUser } from "@/types/api.types";

interface SessionValue {
  token: string | null;
  user: AuthUser | null;
  isSignedIn: boolean;
  /**
   * True until the stored token has been read back and checked. Screens must
   * wait for this before acting on `token`, or a reload bounces a signed-in
   * user to the sign-in screen in the moment before the token loads.
   */
  isRestoring: boolean;
  signIn: (token: string, user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * The session survives a reload and an app restart.
 *
 * The stored token is not trusted on sight: it is a 30-day JWT whose session
 * row can be revoked from another device, so restoring calls /auth/me once and
 * keeps it only if the API still accepts it. That also repopulates the user,
 * which the token itself does not carry in a form worth trusting.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await loadSession();

      if (!stored) {
        if (!cancelled) setIsRestoring(false);
        return;
      }

      try {
        const me = await authApi.getMe(stored);
        if (cancelled) return;
        setToken(stored);
        setUserState(me);
      } catch {
        // Expired, revoked, or the API is unreachable. Dropping the token is
        // the safe read: the worst case is one extra sign-in, where keeping it
        // means every screen retrying against a token that will never work.
        if (!cancelled) await clearSession();
      } finally {
        if (!cancelled) setIsRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback((nextToken: string, nextUser: AuthUser) => {
    setToken(nextToken);
    setUserState(nextUser);
    void saveSession(nextToken);
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setUserState(null);
    void clearSession();
    // Where this person was looking to park is theirs, not the next sign-in's.
    void clearDraft();
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      token,
      user,
      isSignedIn: token !== null,
      isRestoring,
      signIn,
      setUser: setUserState,
      signOut,
    }),
    [token, user, isRestoring, signIn, signOut]
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
