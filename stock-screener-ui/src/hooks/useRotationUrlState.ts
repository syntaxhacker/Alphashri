import { useCallback, useState } from "react";
import type { RotationKind, RotationPeriod } from "../types/rotation";

const KINDS: RotationKind[] = ["sector", "theme", "industry"];
const PERIODS: RotationPeriod[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"];
const MIN_MEMBERS = [1, 3, 5, 10] as const;

function readEnum<T extends string>(key: string, allowed: T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const value = new URLSearchParams(window.location.search).get(key);
  return value && allowed.includes(value as T) ? (value as T) : fallback;
}

function readNumber(key: string, allowed: readonly number[], fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const value = Number(new URLSearchParams(window.location.search).get(key));
  return allowed.includes(value) ? value : fallback;
}

function writeParams(patch: Record<string, string | null>): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function useRotationUrlState() {
  const [kind, setKindState] = useState<RotationKind>(() => readEnum("kind", KINDS, "sector"));
  const [period, setPeriodState] = useState<RotationPeriod>(() => readEnum("period", PERIODS, "1M"));
  const [minMembers, setMinMembersState] = useState<number>(() =>
    readNumber("min", MIN_MEMBERS, 3),
  );
  const [selectedId, setSelectedIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("group");
  });

  const setKind = useCallback((next: RotationKind) => {
    setKindState(next);
    setSelectedIdState(null);
    writeParams({ kind: next, group: null });
  }, []);

  const setPeriod = useCallback((next: RotationPeriod) => {
    setPeriodState(next);
    writeParams({ period: next });
  }, []);

  const setMinMembers = useCallback((next: number) => {
    const safe = MIN_MEMBERS.includes(next as (typeof MIN_MEMBERS)[number]) ? next : 3;
    setMinMembersState(safe);
    writeParams({ min: String(safe) });
  }, []);

  const setSelectedId = useCallback((next: string | null) => {
    setSelectedIdState(next);
    writeParams({ group: next });
  }, []);

  return {
    kind,
    period,
    minMembers,
    selectedId,
    setKind,
    setPeriod,
    setMinMembers,
    setSelectedId,
  };
}
