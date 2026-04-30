// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { openCreateModal, closeCreateModal, openEditModal, closeEditModal } from "./modalActions";
import type { StrategyConfig } from "../../types/strategies";
import { state as strategiesState } from "../strategies";
import * as strategiesModule from "../strategies";

// Helper to reset state
function resetStrategiesState() {
  strategiesState.showCreateModal = false;
  strategiesState.showEditModal = false;
  strategiesState.parentTemplate = null;
  strategiesState.editingStrategy = null;
}

describe("modalActions", () => {
  beforeEach(() => {
    resetStrategiesState();
    vi.clearAllMocks();
  });

  describe("openCreateModal", () => {
    it("sets showCreateModal to true", () => {
      openCreateModal();

      expect(strategiesState.showCreateModal).toBe(true);
    });

    it("sets showEditModal to false", () => {
      strategiesState.showEditModal = true;
      openCreateModal();

      expect(strategiesState.showEditModal).toBe(false);
    });

    it("clears parentTemplate when no template provided", () => {
      strategiesState.parentTemplate = { name: "test" } as StrategyConfig;
      openCreateModal();

      expect(strategiesState.parentTemplate).toBeNull();
    });

    it("accepts template parameter", () => {
      const template: StrategyConfig = {
        name: "ORB Strategy",
        type: "ORB",
        enabled: true,
        risk_per_trade_pct: 1.0,
        sl_pct: 1.0,
        tp_pct: 1.5,
        cooldown_minutes: 75,
        eod_exit_hour: 15,
        eod_exit_minute: 0,
        min_rr_ratio: 1.5,
        enable_shorts: false,
        breakout_buffer_pct: 0.3,
        min_or_range_pct: 0.8,
      };

      openCreateModal(template);

      expect(strategiesState.parentTemplate).toEqual(template);
    });

    it("calls notify to update subscribers", () => {
      const mockNotify = vi.spyOn(strategiesModule, "notify");

      openCreateModal();

      expect(mockNotify).toHaveBeenCalledTimes(1);
    });

    it("clears editingStrategy", () => {
      strategiesState.editingStrategy = {
        name: "test",
        type: "ORB",
        enabled: true,
      } as StrategyConfig;
      openCreateModal();

      expect(strategiesState.editingStrategy).toBeNull();
    });
  });

  describe("closeCreateModal", () => {
    it("sets showCreateModal to false", () => {
      strategiesState.showCreateModal = true;
      closeCreateModal();

      expect(strategiesState.showCreateModal).toBe(false);
    });

    it("clears parentTemplate", () => {
      strategiesState.parentTemplate = { name: "test" } as StrategyConfig;
      closeCreateModal();

      expect(strategiesState.parentTemplate).toBeNull();
    });

    it("calls notify", () => {
      const mockNotify = vi.spyOn(strategiesModule, "notify");

      closeCreateModal();

      expect(mockNotify).toHaveBeenCalledTimes(1);
    });
  });

  describe("openEditModal", () => {
    const mockStrategy: StrategyConfig = {
      name: "ORB Strategy",
      type: "ORB",
      enabled: true,
      risk_per_trade_pct: 1.0,
      sl_pct: 1.0,
      tp_pct: 1.5,
      cooldown_minutes: 75,
      eod_exit_hour: 15,
      eod_exit_minute: 0,
      min_rr_ratio: 1.5,
      enable_shorts: false,
      breakout_buffer_pct: 0.3,
      min_or_range_pct: 0.8,
    };

    it("sets showEditModal to true", () => {
      openEditModal(mockStrategy);

      expect(strategiesState.showEditModal).toBe(true);
    });

    it("sets editingStrategy to provided strategy", () => {
      openEditModal(mockStrategy);

      expect(strategiesState.editingStrategy).toEqual(mockStrategy);
    });

    it("sets showCreateModal to false", () => {
      strategiesState.showCreateModal = true;
      openEditModal(mockStrategy);

      expect(strategiesState.showCreateModal).toBe(false);
    });

    it("clears parentTemplate", () => {
      strategiesState.parentTemplate = { name: "test" } as StrategyConfig;
      openEditModal(mockStrategy);

      expect(strategiesState.parentTemplate).toBeNull();
    });

    it("calls notify", () => {
      const mockNotify = vi.spyOn(strategiesModule, "notify");

      openEditModal(mockStrategy);

      expect(mockNotify).toHaveBeenCalledTimes(1);
    });
  });

  describe("closeEditModal", () => {
    it("sets showEditModal to false", () => {
      strategiesState.showEditModal = true;
      closeEditModal();

      expect(strategiesState.showEditModal).toBe(false);
    });

    it("clears editingStrategy", () => {
      strategiesState.editingStrategy = {
        name: "test",
        type: "ORB",
        enabled: true,
      } as StrategyConfig;
      closeEditModal();

      expect(strategiesState.editingStrategy).toBeNull();
    });

    it("calls notify", () => {
      const mockNotify = vi.spyOn(strategiesModule, "notify");

      closeEditModal();

      expect(mockNotify).toHaveBeenCalledTimes(1);
    });
  });
});
