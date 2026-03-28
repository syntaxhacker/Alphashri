import { useState, useCallback } from "react";

interface UseTableSortOptions<T> {
  initialColumn?: string;
  initialDirection?: "asc" | "desc";
  defaultDirection?: "asc" | "desc";
}

interface UseTableSortReturn<T> {
  sortColumn: string | null;
  sortDirection: "asc" | "desc";
  handleSort: (column: string) => void;
  getSortedData: (data: T[], getColumnValue: (item: T) => string | number) => T[];
}

export function useTableSort<T>(options?: UseTableSortOptions<T>): UseTableSortReturn<T> {
  const { initialColumn, initialDirection = "desc", defaultDirection = "desc" } = options || {};

  const [sortColumn, setSortColumn] = useState<string | null>(initialColumn ?? null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(initialDirection);

  const handleSort = useCallback(
    (column: string) => {
      setSortColumn((prev) => {
        if (prev === column) {
          setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
          return prev;
        }
        setSortDirection(defaultDirection);
        return column;
      });
    },
    [defaultDirection],
  );

  const getSortedData = useCallback(
    (data: T[], getColumnValue: (item: T) => string | number): T[] => {
      if (!sortColumn) return data;
      return [...data].sort((a, b) => {
        const aVal = getColumnValue(a);
        const bVal = getColumnValue(b);
        if (typeof aVal === "string" && typeof bVal === "string") {
          return sortDirection === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        return sortDirection === "asc"
          ? (aVal as number) - (bVal as number)
          : (bVal as number) - (aVal as number);
      });
    },
    [sortColumn, sortDirection],
  );

  return { sortColumn, sortDirection, handleSort, getSortedData };
}
