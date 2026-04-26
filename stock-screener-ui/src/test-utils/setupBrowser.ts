import { vi } from "vitest";

export function setupBrowserMocks() {
  // Mock matchMedia
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock scrollTo
  window.scrollTo = vi.fn();

  // Mock ResizeObserver as a class (needs to be constructable with 'new')
  class ResizeObserverMock {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    constructor(callback: ResizeObserverCallback) {}
  }
  global.ResizeObserver = ResizeObserverMock as any;
}
