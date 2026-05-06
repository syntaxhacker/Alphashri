// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StrategyConfig } from "../../types/strategies";

// Import via the strategies module since modal actions are now defined there
import {
  openCreateModal,
  closeCreateModal,
  openEditModal,
  closeEditModal,
  getStrategiesState,
} from "../strategies";

describe("modalActions", () => {
  beforeEach(() => {
    // Reset state using the actual state object from getStrategiesState
    const s = getStrategiesState();
    s.showCreateModal = false;
    s.showEditModal = false;
    s.parentTemplate = null;
    s.editingStrategy = null;
  });

  describe("openCreateModal", () => {
    it("sets showCreateModal to true", () => {
      openCreateModal();

      expect(getStrategiesState().showCreateModal).toBe(true);
    });

    it("sets showEditModal to false", () => {
      getStrategiesState().showEditModal = true;
      openCreateModal();

      expect(getStrategiesState().showEditModal).toBe(false);
    });

    it("clears parentTemplate when no template provided", () => {
      getStrategiesState().parentTemplate = { name: "test" } as StrategyConfig;
      openCreateModal();

      expect(getStrategiesState().parentTemplate).toBeNull();
    });

    it("sets parentTemplate when template provided", () => {
      const template = { name: "test template" } as StrategyConfig;
      openCreateModal(template);

      expect(getStrategiesState().parentTemplate).toBe(template);
    });

    it("clears editingStrategy", () => {
      getStrategiesState().editingStrategy = { name: "test" } as StrategyConfig;
      openCreateModal();

      expect(getStrategiesState().editingStrategy).toBeNull();
    });
  });

  describe("closeCreateModal", () => {
    it("sets showCreateModal to false", () => {
      openCreateModal();
      closeCreateModal();

      expect(getStrategiesState().showCreateModal).toBe(false);
    });

    it("clears parentTemplate", () => {
      openCreateModal({ name: "test" } as StrategyConfig);
      closeCreateModal();

      expect(getStrategiesState().parentTemplate).toBeNull();
    });
  });

  describe("openEditModal", () => {
    const mockStrategy = {
      name: "Test Strategy",
      strategy_type: "ORB",
      is_active: true,
    } as StrategyConfig;

    it("sets showEditModal to true", () => {
      openEditModal(mockStrategy);

      expect(getStrategiesState().showEditModal).toBe(true);
    });

    it("sets editingStrategy", () => {
      openEditModal(mockStrategy);

      expect(getStrategiesState().editingStrategy).toBe(mockStrategy);
    });

    it("clears showCreateModal", () => {
      getStrategiesState().showCreateModal = true;
      openEditModal(mockStrategy);

      expect(getStrategiesState().showCreateModal).toBe(false);
    });

    it("clears parentTemplate", () => {
      getStrategiesState().parentTemplate = { name: "test" } as StrategyConfig;
      openEditModal(mockStrategy);

      expect(getStrategiesState().parentTemplate).toBeNull();
    });
  });

  describe("closeEditModal", () => {
    it("sets showEditModal to false", () => {
      getStrategiesState().showEditModal = true;
      closeEditModal();

      expect(getStrategiesState().showEditModal).toBe(false);
    });

    it("clears editingStrategy", () => {
      getStrategiesState().editingStrategy = {
        name: "test",
        type: "ORB",
        enabled: true,
      } as StrategyConfig;
      closeEditModal();

      expect(getStrategiesState().editingStrategy).toBeNull();
    });
  });
});
