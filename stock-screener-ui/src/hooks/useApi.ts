import { useState, useCallback, useRef, useEffect } from "react";

export interface UseApiOptions<T> {
  url: string | (() => string);
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: object | null;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  immediate?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
}

export interface UseApiState<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
  isAborted: boolean;
  execute: () => Promise<void>;
  abort: () => void;
}

const API_BASE = "http://localhost:8765";

let globalAbortController: AbortController | null = null;

export function abortPendingRequest(): AbortController {
  if (globalAbortController) {
    globalAbortController.abort();
  }
  globalAbortController = new AbortController();
  return globalAbortController;
}

export function getAbortSignal(): AbortSignal | null {
  return globalAbortController?.signal || null;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function buildUrl(
  baseUrl: string,
  params?: Record<string, string | number | boolean | undefined>,
): string {
  if (!params || Object.keys(params).length === 0) {
    return baseUrl;
  }
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.append(key, String(value));
    }
  });
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}${searchParams.toString()}`;
}

export function useApi<T>(options: UseApiOptions<T>): UseApiState<T> {
  const {
    url: urlOrFn,
    method = "GET",
    body = null,
    params = {},
    headers = {},
    immediate = false,
    onSuccess,
    onError,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(immediate);
  const [isAborted, setIsAborted] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const execute = useCallback(async () => {
    const url = typeof urlOrFn === "function" ? urlOrFn() : urlOrFn;
    const fullUrl = buildUrl(url, params);

    abortControllerRef.current = abortPendingRequest();
    setIsAborted(false);
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(fullUrl, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
          ...headers,
        },
        body: body ? JSON.stringify(body) : null,
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const json = await res.json();

      if (!mountedRef.current) return;
      setData(json);
      onSuccess?.(json);
    } catch (err) {
      if (!mountedRef.current) return;
      if (isAbortError(err)) {
        setIsAborted(true);
        return;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [urlOrFn, method, body, params, headers, onSuccess, onError]);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsAborted(true);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (immediate) {
      execute();
    }
  }, [immediate]);

  return {
    data,
    error,
    isLoading,
    isAborted,
    execute,
    abort,
  };
}
