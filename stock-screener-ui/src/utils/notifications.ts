/**
 * Notification utilities
 */

import type { ChangeNotification } from '../types'
import { NEW_ROW_HIGHLIGHT_MS } from '../constants'
import * as state from '../state'

// Forward declaration - will be set by main.ts
let renderCallback: () => void = () => {}

export function setRenderCallback(cb: () => void) {
  renderCallback = cb
}

export function pushNotification(title: string, detail: string, kind: 'primary' | 'secondary') {
  const newNotification: ChangeNotification = {
    id: state.notifSeq,
    ts: new Date().toLocaleTimeString(),
    title,
    detail,
    kind
  }
  state.incrementNotifSeq()
  state.setNotifications([newNotification, ...state.notifications].slice(0, 50))
}

export function markNewSymbols(symbols: string[]) {
  if (symbols.length === 0) return
  const expiry = Date.now() + NEW_ROW_HIGHLIGHT_MS
  const newRecentAdded = { ...state.recentAddedSymbols }
  symbols.forEach((symbol) => {
    newRecentAdded[symbol] = expiry
  })
  state.setRecentAddedSymbols(newRecentAdded)

  setTimeout(() => {
    const now = Date.now()
    const currentSymbols = { ...state.recentAddedSymbols }
    let changed = false
    for (const [symbol, expiresAt] of Object.entries(currentSymbols)) {
      if (expiresAt <= now) {
        delete currentSymbols[symbol]
        changed = true
      }
    }
    if (changed) {
      state.setRecentAddedSymbols(currentSymbols)
      renderCallback()
    }
  }, NEW_ROW_HIGHLIGHT_MS + 100)
}

export function isRecentlyAdded(symbol: string): boolean {
  const expiry = state.recentAddedSymbols[symbol]
  if (!expiry) return false
  if (expiry <= Date.now()) {
    const newSymbols = { ...state.recentAddedSymbols }
    delete newSymbols[symbol]
    state.setRecentAddedSymbols(newSymbols)
    return false
  }
  return true
}
