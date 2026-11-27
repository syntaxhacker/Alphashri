/**
 * Per-user saved UI state — `GET/PUT/DELETE /api/user-configs/{scope}`.
 *
 * One envelope shape on both reads and writes. Every failure is a typed
 * `UserConfigError` so the store can tell an expired token (401/403, go quiet)
 * from a conflict (409) from a client bug (422) from a network drop.
 */

import { fetchWithAuth } from "../state/auth";
import { API_BASE } from "@/api/config";

const USER_CONFIGS_API = `${API_BASE}/api/user-configs`;

export interface UserConfig<T = Record<string, unknown>> {
  scope: string;
  version: number;
  /** `false` on a first visit: `config` is then the server's default payload. */
  saved: boolean;
  updated_at: string | null;
  config: T;
  /** `invalid_saved_config` when the server kept a row it could not read. */
  warning?: string;
}

export interface DeleteUserConfigResult {
  scope: string;
  deleted: boolean;
}

export class UserConfigError extends Error {
  readonly status: number;
  readonly code: string;
  /** Parsed error body — a 409 carries `current`, the other tab's envelope. */
  readonly payload: unknown;

  constructor(message: string, status: number, code: string, payload?: unknown) {
    super(message);
    this.name = "UserConfigError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

async function failure(response: Response, fallback: string): Promise<UserConfigError> {
  const body = (await response.json().catch(() => null)) as
    | { detail?: unknown }
    | null;
  const detail = body && typeof body.detail === "string" ? body.detail : null;
  return new UserConfigError(
    detail ?? `${fallback} (HTTP ${response.status})`,
    response.status,
    detail ?? `http_${response.status}`,
    body,
  );
}

function endpoint(scope: string): string {
  return `${USER_CONFIGS_API}/${encodeURIComponent(scope)}`;
}

export async function getUserConfig<T = Record<string, unknown>>(
  scope: string,
  options: { signal?: AbortSignal } = {},
): Promise<UserConfig<T>> {
  const response = await fetchWithAuth(endpoint(scope), { signal: options.signal });
  if (!response.ok) throw await failure(response, "Failed to load saved config");
  return (await response.json()) as UserConfig<T>;
}

export interface PutUserConfigOptions {
  /** Registry version the payload was written against; the server 422s on a mismatch. */
  version?: number;
  /** `updated_at` of the revision this write is based on (sent as `If-Match`). */
  ifMatch?: string | null;
  /** `pagehide` flush: the request must outlive the page. */
  keepalive?: boolean;
  signal?: AbortSignal;
}

export async function putUserConfig<T = Record<string, unknown>>(
  scope: string,
  config: T,
  options: PutUserConfigOptions = {},
): Promise<UserConfig<T>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.ifMatch) headers["If-Match"] = options.ifMatch;

  const body: Record<string, unknown> = { config };
  if (options.version != null) body.version = options.version;

  const response = await fetchWithAuth(endpoint(scope), {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
    keepalive: options.keepalive === true,
    signal: options.signal,
  });
  if (!response.ok) throw await failure(response, "Failed to save config");
  return (await response.json()) as UserConfig<T>;
}

export async function deleteUserConfig(scope: string): Promise<DeleteUserConfigResult> {
  const response = await fetchWithAuth(endpoint(scope), { method: "DELETE" });
  if (!response.ok) throw await failure(response, "Failed to delete saved config");
  return (await response.json()) as DeleteUserConfigResult;
}
