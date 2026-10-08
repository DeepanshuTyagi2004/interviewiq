"use client";

import { useEffect, useState } from "react";

/** The value, settled for `ms` (typed filters shouldn't refetch on every keystroke). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
