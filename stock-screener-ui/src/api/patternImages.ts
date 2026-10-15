/**
 * Chart-pattern reference-image API client.
 *
 * Typed wrappers over the admin upload / public read endpoints
 * (`GET /images`, `PUT|DELETE /image/{pattern_id}`). Pure transport: functions
 * throw on failure and never touch app state.
 */

import { fetchWithAuth } from "../state/auth";
import { API_BASE } from "./config";

const PATTERN_IMAGES_BASE = `${API_BASE}/api/chart-patterns`;

/** Response returned by the upload/replace endpoint. */
export interface UploadedPatternImage {
  pattern_id: string;
  url: string;
  content_type?: string;
  size?: number;
  updated_at?: string | null;
}

interface ErrorBody {
  detail?: unknown;
  error?: unknown;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as ErrorBody;
    const raw = body?.detail ?? body?.error;
    if (typeof raw === "string" && raw) return raw;
    if (raw != null) return JSON.stringify(raw);
  } catch {
    // Non-JSON error body — fall through to the fallback label.
  }
  return fallback;
}

/** Map of `pattern_id` → public image URL for every uploaded image. */
export async function fetchPatternImages(): Promise<Record<string, string>> {
  const response = await fetchWithAuth(`${PATTERN_IMAGES_BASE}/images`);
  if (!response.ok) {
    throw new Error(
      await readError(response, `Failed to load pattern images (${response.status})`),
    );
  }
  const data = (await response.json()) as { images?: Record<string, string> };
  return data.images ?? {};
}

/** Create or replace the reference image for one pattern (`multipart/form-data`). */
export async function uploadPatternImage(
  patternId: string,
  file: File,
): Promise<UploadedPatternImage> {
  const form = new FormData();
  form.append("file", file);

  const response = await fetchWithAuth(
    `${PATTERN_IMAGES_BASE}/image/${encodeURIComponent(patternId)}`,
    { method: "PUT", body: form },
  );
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to upload image (${response.status})`));
  }
  return (await response.json()) as UploadedPatternImage;
}

/** Delete the reference image for one pattern. */
export async function deletePatternImage(patternId: string): Promise<void> {
  const response = await fetchWithAuth(
    `${PATTERN_IMAGES_BASE}/image/${encodeURIComponent(patternId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(await readError(response, `Failed to delete image (${response.status})`));
  }
}
