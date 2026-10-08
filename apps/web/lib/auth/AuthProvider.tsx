"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  loginWithGoogle,
  loginWithPassword,
  logout as logoutRequest,
  refreshSession,
  registerWithPassword,
} from "./client";
import { getExpiresAt } from "./token-store";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Start the Google OAuth redirect; `next` is where to land afterwards (same-origin only). */
  login: (next?: string | null) => void;
  /** Email + password sign-in. Rejects with ApiFetchError (e.g. `invalid_credentials`). */
  signIn: (input: { email: string; password: string }) => Promise<void>;
  /** Email + password sign-up. Rejects with ApiFetchError (e.g. `email_taken`, `use_google`). */
  signUp: (input: { name: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Refresh this many ms before the access token actually expires. */
const REFRESH_SKEW_MS = 60_000;
/** While the API can't be reached, retry after 2 s, 4 s, 8 s … up to every 30 s. */
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriesRef = useRef(0);
  const mountedRef = useRef(true);
  // Latest refresh routine, so the scheduled timer can call it without a declaration cycle.
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Mark the session live and schedule the next silent refresh just before expiry. */
  const scheduleRefresh = useCallback(() => {
    setStatus("authenticated");
    clearTimer();
    const delay = Math.max(getExpiresAt() - Date.now() - REFRESH_SKEW_MS, 1_000);
    timerRef.current = setTimeout(() => {
      void refreshRef.current();
    }, delay);
  }, [clearTimer]);

  // Attempt a silent refresh, then schedule the next one before expiry.
  const runRefresh = useCallback(async (): Promise<void> => {
    const outcome = await refreshSession();
    if (!mountedRef.current) return;
    if (outcome === "unreachable") {
      // No answer is not a sign-out: keep the current status (a page stays put, a first load keeps
      // its spinner) and try again shortly, backing off while the API stays away.
      clearTimer();
      const delay = Math.min(RETRY_BASE_MS * 2 ** retriesRef.current, RETRY_MAX_MS);
      retriesRef.current += 1;
      timerRef.current = setTimeout(() => {
        void refreshRef.current();
      }, delay);
      return;
    }
    retriesRef.current = 0;
    if (outcome === "signed-out") {
      clearTimer();
      setStatus("unauthenticated");
      return;
    }
    scheduleRefresh();
  }, [clearTimer, scheduleRefresh]);

  useEffect(() => {
    refreshRef.current = runRefresh;
  }, [runRefresh]);

  // Bootstrap on mount: try to restore a session from the refresh cookie.
  useEffect(() => {
    mountedRef.current = true;
    // runRefresh only sets state after awaiting the network, never synchronously in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runRefresh();
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [runRefresh, clearTimer]);

  const login = useCallback((next?: string | null) => {
    loginWithGoogle(next);
  }, []);

  const signIn = useCallback<AuthContextValue["signIn"]>(
    async (input) => {
      await loginWithPassword(input);
      // Never let a previous account's cached data leak into this session.
      queryClient.clear();
      if (mountedRef.current) scheduleRefresh();
    },
    [queryClient, scheduleRefresh],
  );

  const signUp = useCallback<AuthContextValue["signUp"]>(
    async (input) => {
      await registerWithPassword(input);
      queryClient.clear();
      if (mountedRef.current) scheduleRefresh();
    },
    [queryClient, scheduleRefresh],
  );

  const logout = useCallback(async () => {
    clearTimer();
    await logoutRequest();
    queryClient.clear();
    if (mountedRef.current) setStatus("unauthenticated");
  }, [clearTimer, queryClient]);

  const value: AuthContextValue = {
    status,
    isAuthenticated: status === "authenticated",
    isLoading: status === "loading",
    login,
    signIn,
    signUp,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return ctx;
}
