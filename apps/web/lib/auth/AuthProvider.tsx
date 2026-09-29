"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  loginWithGoogle,
  logout as logoutRequest,
  refresh as refreshRequest,
} from "./client";
import { getExpiresAt } from "./token-store";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Refresh this many ms before the access token actually expires. */
const REFRESH_SKEW_MS = 60_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Attempt a silent refresh, then schedule the next one before expiry.
  const runRefresh = useCallback(async (): Promise<void> => {
    const ok = await refreshRequest();
    if (!mountedRef.current) return;

    if (!ok) {
      clearTimer();
      setStatus("unauthenticated");
      return;
    }

    setStatus("authenticated");
    clearTimer();
    const delay = Math.max(getExpiresAt() - Date.now() - REFRESH_SKEW_MS, 1_000);
    timerRef.current = setTimeout(() => {
      void runRefresh();
    }, delay);
  }, [clearTimer]);

  // Bootstrap on mount: try to restore a session from the refresh cookie.
  useEffect(() => {
    mountedRef.current = true;
    void runRefresh();
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [runRefresh, clearTimer]);

  const login = useCallback(() => {
    loginWithGoogle();
  }, []);

  const logout = useCallback(async () => {
    clearTimer();
    await logoutRequest();
    if (mountedRef.current) setStatus("unauthenticated");
  }, [clearTimer]);

  const value: AuthContextValue = {
    status,
    isAuthenticated: status === "authenticated",
    isLoading: status === "loading",
    login,
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
