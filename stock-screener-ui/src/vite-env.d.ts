/// <reference types="vite/client" />

/**
 * ECharts is loaded via CDN script tag (not bundled), so we declare a minimal
 * global type for window.echarts to avoid `as any` casts.
 */
declare global {
  interface Window {
    echarts: {
      init: (container: HTMLElement | null, theme?: string | null, options?: Record<string, unknown>) => EChartsInstance;
    };
    // Legacy preview chart handlers (assigned via inline onclick in previewChart.ts)
    showPreviewChart?: (event: MouseEvent, symbol: string) => void;
    hidePreviewChart?: () => void;
    toggleExpandedChart?: (symbol: string) => void;
    collapseChart?: () => void;
    navigateToFullChart?: (symbol: string) => void;
    setPreviewTimeframe?: (tf: number) => void;
    setPreviewOrMinutes?: (orMinutes: number) => void;
    // Legacy performance view handlers (assigned via inline onclick in performance.ts)
    selectStrategyForDetail?: (strategyId: number) => void;
    clearSelectedStrategy?: () => void;
    viewAllStrategyTrades?: (strategyName: string) => void;
    navigateToRoute?: (route: string) => void;
    __pendingStrategySelection?: string;
    // Bot config handlers (assigned in config.ts)
    closeBotConfigModal?: () => void;
    addStrategyAllocation?: () => void;
    removeStrategyAllocation?: (index: number) => void;
    updateAllocationSummary?: () => void;
    saveBotConfig?: (event: Event) => void;
    // Bot status handlers (assigned in status.ts)
    refreshBotStatus?: (botId: string) => Promise<void>;
    startBotFromStatus?: (botId: string) => Promise<void>;
    stopBotFromStatus?: (botId: string) => Promise<void>;
    refreshBotTrades?: (botId: string) => Promise<void>;
    // Bot view handlers (assigned in index.ts)
    setBotsView?: (view: string) => void;
    clearBotError?: () => void;
    viewBotStatus?: (botId: string) => void;
    startBot?: (botId: string) => Promise<void>;
    stopBot?: (botId: string) => Promise<void>;
    editBot?: (botId: string) => void;
    deleteBot?: (botId: string) => Promise<void>;
    openCreateBotModal?: () => void;
  }

  interface EChartsInstance {
    setOption: (option: unknown) => void;
    resize: () => void;
    dispose: () => void;
    on: (event: string, handler: (...args: unknown[]) => void) => void;
  }
}

export {};
