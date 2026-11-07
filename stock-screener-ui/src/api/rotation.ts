import { fetchWithAuth } from "../state/auth";
import { jsonOrThrow } from "./utils/request";
import { API_BASE } from "./config";
import type {
  RotationKind,
  RotationOverviewResponse,
  ThemeDetailResponse,
} from "../types/rotation";

export interface FetchRotationParams {
  market?: string;
  kind?: RotationKind;
  minMembers?: number;
  limit?: number;
  signal?: AbortSignal;
}

export async function fetchRotationOverview({
  market = "india",
  kind = "sector",
  minMembers = 3,
  limit = 48,
  signal,
}: FetchRotationParams = {}): Promise<RotationOverviewResponse> {
  const params = new URLSearchParams({
    market,
    kind,
    min_members: String(minMembers),
    limit: String(limit),
  });
  const response = await fetchWithAuth(`${API_BASE}/api/rotation/overview?${params.toString()}`, {
    signal,
  });
  return jsonOrThrow<RotationOverviewResponse>(response, "Failed to fetch rotation data");
}

export async function fetchThemeDetail(
  slug: string,
  signal?: AbortSignal,
): Promise<ThemeDetailResponse> {
  const response = await fetchWithAuth(
    `${API_BASE}/api/sector/themes/${encodeURIComponent(slug)}`,
    { signal },
  );
  return jsonOrThrow<ThemeDetailResponse>(response, "Failed to fetch theme members");
}
