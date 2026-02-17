import { describe, expect, test } from 'bun:test'
import { getColumnKeysForProfile } from './ui_schema'

describe('ui schema dynamic header mapping', () => {
  test('market open uses gap columns', () => {
    const cols = getColumnKeysForProfile('market_open_gap', false)
    expect(cols).toEqual(['symbol', 'score', 'gap_pct', 'premarket_change', 'day_change', 'volume_m', 'sector'])
  })

  test('rsi reversal uses oscillator columns', () => {
    const cols = getColumnKeysForProfile('rsi_reversal', false)
    expect(cols).toEqual(['symbol', 'score', 'rsi', 'stoch_k', 'day_change', 'volume_m', 'sector'])
  })

  test('default profile adds time_to_52w only for non-touched table', () => {
    const cols1 = getColumnKeysForProfile('trending', false)
    const cols2 = getColumnKeysForProfile('trending', true)
    expect(cols1.includes('time_to_52w')).toBeTrue()
    expect(cols2.includes('time_to_52w')).toBeFalse()
  })
})
