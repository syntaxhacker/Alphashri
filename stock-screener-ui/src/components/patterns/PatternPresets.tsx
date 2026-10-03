import { useState } from "react";
import { ActionIcon, Box, Button, Chip, Select, Text, TextInput, Tooltip } from "@/ui";
import { Close as CloseIcon } from "@mui/icons-material";
import { BUILTIN_PRESETS, type PatternPreset } from "@/config/patternCatalog";
import type { PatternFilters } from "@/types/chartPatterns";

/** localStorage key holding the user's saved filter presets. */
export const PATTERN_PRESETS_STORAGE_KEY = "alphashri.patternPresets";

export interface PatternPresetsProps {
  /** Current filter rail value, snapshotted when the user saves a preset. */
  filters: PatternFilters;
  /** Apply a partial filter patch (merged onto defaults) and reload. */
  applyFilters: (filters: Partial<PatternFilters>) => void;
}

function readSavedPresets(): PatternPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PATTERN_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PatternPreset[]) : [];
  } catch {
    return [];
  }
}

function writeSavedPresets(presets: PatternPreset[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PATTERN_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Storage may be unavailable (private mode / quota) — keep in-memory state.
  }
}

function newPresetId(): string {
  return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Compact PRESETS control for the filter rail: built-in preset chips, plus the
 * ability to save the current filters and re-apply/delete them later.
 */
export function PatternPresets({ filters, applyFilters }: PatternPresetsProps) {
  const [saved, setSaved] = useState<PatternPreset[]>(() => readSavedPresets());
  const [selected, setSelected] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const persist = (next: PatternPreset[]): void => {
    setSaved(next);
    writeSavedPresets(next);
  };

  const apply = (patch: Partial<PatternFilters>): void => {
    applyFilters({ ...patch });
  };

  const handleSave = (): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Deep-clone so later filter-rail edits can't mutate the saved snapshot.
    const snapshot = JSON.parse(JSON.stringify(filters)) as PatternFilters;
    const preset: PatternPreset = { id: newPresetId(), name: trimmed, filters: snapshot };
    persist([...saved, preset]);
    setName("");
    setNaming(false);
    setSelected(preset.id);
  };

  const handleDelete = (id: string): void => {
    persist(saved.filter((preset) => preset.id !== id));
    if (selected === id) setSelected(null);
  };

  const handleSelect = (value: string | null): void => {
    if (!value) return;
    setSelected(value);
    const found = saved.find((preset) => preset.id === value);
    if (found) apply(found.filters);
  };

  return (
    <Box
      data-testid="patterns-presets"
      sx={{ display: "flex", flexDirection: "column", gap: 0.75, minWidth: 0 }}
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {BUILTIN_PRESETS.map((preset) => (
          <Chip
            key={preset.id}
            size="xs"
            variant="light"
            onClick={() => apply(preset.filters)}
            data-testid={`patterns-preset-${preset.id}`}
          >
            {preset.name}
          </Chip>
        ))}
      </Box>

      {saved.length > 0 && (
        <>
          <Select
            data={saved.map((preset) => ({ value: preset.id, label: preset.name }))}
            value={selected ?? ""}
            onChange={(value) => handleSelect(value as string | null)}
            size="sm"
            placeholder="Saved presets"
            data-testid="patterns-preset-saved"
          />
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }} data-testid="patterns-preset-saved-list">
            {saved.map((preset) => (
              <Box
                key={preset.id}
                sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, minWidth: 0 }}
              >
                <Chip
                  size="xs"
                  variant="light"
                  onClick={() => {
                    setSelected(preset.id);
                    apply(preset.filters);
                  }}
                  data-testid={`patterns-preset-apply-${preset.id}`}
                >
                  {preset.name}
                </Chip>
                <Tooltip label={`Delete ${preset.name}`}>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color="error"
                    aria-label={`Delete ${preset.name}`}
                    onClick={() => handleDelete(preset.id)}
                    data-testid={`patterns-preset-delete-${preset.id}`}
                  >
                    <CloseIcon fontSize="inherit" />
                  </ActionIcon>
                </Tooltip>
              </Box>
            ))}
          </Box>
        </>
      )}

      {naming ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
            <label
              htmlFor="patterns-preset-name-input"
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                overflow: "hidden",
                clip: "rect(0 0 0 0)",
                whiteSpace: "nowrap",
              }}
            >
              Preset name
            </label>
            <TextInput
              id="patterns-preset-name-input"
              value={name}
              onChange={setName}
              size="sm"
              placeholder="Preset name"
              data-testid="patterns-preset-name"
              w={140}
            />
            <Button
              size="xs"
              onClick={handleSave}
              disabled={name.trim().length === 0}
              data-testid="patterns-preset-name-save"
            >
              Save
            </Button>
          </Box>
          {name.trim().length === 0 ? (
            <Text size="xs" c="dimmed" data-testid="patterns-preset-name-hint">
              Enter a name to save this preset.
            </Text>
          ) : null}
        </Box>
      ) : (
        <Button
          size="xs"
          variant="outline"
          onClick={() => setNaming(true)}
          data-testid="patterns-preset-save"
        >
          Save current
        </Button>
      )}
    </Box>
  );
}
