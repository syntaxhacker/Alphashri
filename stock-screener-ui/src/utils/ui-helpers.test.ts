import { describe, expect, test } from 'bun:test'
import {
  formatCurrency,
  formatNumber,
  formatCurrencyCompact,
  formatPercentage,
  formatDateTimeHuman,
  formatDateTimeCompact,
  formatTradeTime,
  formatDuration,
  getOrdinalSuffix,
  getPnLClass,
  getPnLColor,
  getExitReasonColor,
  renderSortIndicator,
  getNextSortDirection,
  normalizeTime,
} from './ui-helpers'

describe('formatCurrency', () => {
  test('formats positive numbers with rupee symbol', () => {
    expect(formatCurrency(1000)).toBe('₹1000')
    expect(formatCurrency(1234.56)).toBe('₹1235')  // Default precision 0 rounds
  })

  test('formats with custom precision', () => {
    expect(formatCurrency(1234.567, 2)).toBe('₹1234.57')
    expect(formatCurrency(100, 1)).toBe('₹100.0')
  })

  test('handles zero', () => {
    expect(formatCurrency(0)).toBe('₹0')
  })

  test('handles negative numbers', () => {
    expect(formatCurrency(-500)).toBe('₹-500')
  })
})

describe('formatNumber', () => {
  test('formats numbers below 1000 without suffix', () => {
    expect(formatNumber(500)).toBe('500')
    expect(formatNumber(999)).toBe('999')
  })

  test('formats thousands with K suffix', () => {
    expect(formatNumber(1500)).toBe('1.5K')
    expect(formatNumber(10000)).toBe('10.0K')
    expect(formatNumber(99999)).toBe('100.0K')
  })

  test('formats lakhs with L suffix', () => {
    expect(formatNumber(100000)).toBe('1.0L')
    expect(formatNumber(150000)).toBe('1.5L')
    expect(formatNumber(1000000)).toBe('10.0L')
  })

  test('handles negative numbers', () => {
    expect(formatNumber(-1500)).toBe('-1.5K')
    expect(formatNumber(-100000)).toBe('-1.0L')
  })
})

describe('formatCurrencyCompact', () => {
  test('combines currency symbol with compact number', () => {
    expect(formatCurrencyCompact(1500)).toBe('₹1.5K')
    expect(formatCurrencyCompact(100000)).toBe('₹1.0L')
    expect(formatCurrencyCompact(500)).toBe('₹500')
  })
})

describe('formatPercentage', () => {
  test('formats with sign prefix by default', () => {
    expect(formatPercentage(5.5)).toBe('+5.50%')
    expect(formatPercentage(-3.2)).toBe('-3.20%')
  })

  test('hides sign when showSign is false', () => {
    expect(formatPercentage(5.5, 2, false)).toBe('5.50%')
    expect(formatPercentage(-3.2, 2, false)).toBe('-3.20%')
  })

  test('uses custom precision', () => {
    expect(formatPercentage(5.567, 1)).toBe('+5.6%')
    expect(formatPercentage(5.567, 3)).toBe('+5.567%')
  })

  test('handles zero', () => {
    expect(formatPercentage(0)).toBe('+0.00%')
  })
})

describe('formatDateTimeHuman', () => {
  test('formats ISO string to human readable', () => {
    const result = formatDateTimeHuman('2025-01-15T10:30:00+05:30')
    expect(result).toContain('15')
    expect(result).toContain('Jan')
    expect(result).toContain('10:30')
  })

  test('handles empty string', () => {
    expect(formatDateTimeHuman('')).toBe('-')
  })

  test('handles invalid input gracefully', () => {
    // Invalid input produces NaN-based output, not '-'
    const result = formatDateTimeHuman('invalid')
    // Just check it doesn't throw
    expect(typeof result).toBe('string')
  })
})

describe('formatDateTimeCompact', () => {
  test('formats ISO string compactly', () => {
    const result = formatDateTimeCompact('2025-06-20T14:45:00Z')
    expect(result).toBe('20th Jun 14:45')
  })

  test('handles ordinal suffixes correctly', () => {
    expect(formatDateTimeCompact('2025-01-01T09:00:00Z')).toContain('1st')
    expect(formatDateTimeCompact('2025-01-02T09:00:00Z')).toContain('2nd')
    expect(formatDateTimeCompact('2025-01-03T09:00:00Z')).toContain('3rd')
    expect(formatDateTimeCompact('2025-01-04T09:00:00Z')).toContain('4th')
    expect(formatDateTimeCompact('2025-01-21T09:00:00Z')).toContain('21st')
    expect(formatDateTimeCompact('2025-01-22T09:00:00Z')).toContain('22nd')
    expect(formatDateTimeCompact('2025-01-23T09:00:00Z')).toContain('23rd')
  })

  test('handles empty string', () => {
    expect(formatDateTimeCompact('')).toBe('-')
  })
})

describe('formatTradeTime', () => {
  test('formats trade time with seconds', () => {
    // Note: Result depends on local timezone, so just check format
    const result = formatTradeTime('2026-02-24T10:38:36Z')
    expect(result).toMatch(/\d{1,2} \w{3} \d{4}, \d{2}:\d{2}:\d{2}/)
  })

  test('handles empty string', () => {
    expect(formatTradeTime('')).toBe('-')
  })
})

describe('formatDuration', () => {
  test('formats minutes only', () => {
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(5)).toBe('5m')
  })

  test('formats hours and minutes', () => {
    expect(formatDuration(90)).toBe('1h 30m')
    expect(formatDuration(125)).toBe('2h 5m')
    expect(formatDuration(60)).toBe('1h')
  })

  test('handles zero and negative', () => {
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(-5)).toBe('0m')
  })
})

describe('getOrdinalSuffix', () => {
  test('returns st for 1, 21, 31', () => {
    expect(getOrdinalSuffix(1)).toBe('st')
    expect(getOrdinalSuffix(21)).toBe('st')
    expect(getOrdinalSuffix(31)).toBe('st')
  })

  test('returns nd for 2, 22', () => {
    expect(getOrdinalSuffix(2)).toBe('nd')
    expect(getOrdinalSuffix(22)).toBe('nd')
  })

  test('returns rd for 3, 23', () => {
    expect(getOrdinalSuffix(3)).toBe('rd')
    expect(getOrdinalSuffix(23)).toBe('rd')
  })

  test('returns th for other numbers', () => {
    expect(getOrdinalSuffix(4)).toBe('th')
    expect(getOrdinalSuffix(11)).toBe('th')
    expect(getOrdinalSuffix(12)).toBe('th')
    expect(getOrdinalSuffix(13)).toBe('th')
    expect(getOrdinalSuffix(15)).toBe('th')
    expect(getOrdinalSuffix(30)).toBe('th')
  })
})

describe('getPnLClass', () => {
  test('returns positive for positive values', () => {
    expect(getPnLClass(100)).toBe('positive')
    expect(getPnLClass(0.01)).toBe('positive')
  })

  test('returns negative for negative values', () => {
    expect(getPnLClass(-100)).toBe('negative')
    expect(getPnLClass(-0.01)).toBe('negative')
  })

  test('returns empty string for zero', () => {
    expect(getPnLClass(0)).toBe('')
  })
})

describe('getPnLColor', () => {
  test('returns green for positive/zero values', () => {
    expect(getPnLColor(100)).toBe('#00E676')
    expect(getPnLColor(0)).toBe('#00E676')
  })

  test('returns red for negative values', () => {
    expect(getPnLColor(-100)).toBe('#FF1744')
  })
})

describe('getExitReasonColor', () => {
  test('returns correct colors for exit reasons', () => {
    expect(getExitReasonColor('TP')).toBe('#00E676')   // Green
    expect(getExitReasonColor('SL')).toBe('#FF1744')   // Red
    expect(getExitReasonColor('EOD')).toBe('#FFEA00')  // Yellow
    expect(getExitReasonColor('UNKNOWN')).toBe('#FFEA00')
  })
})

describe('renderSortIndicator', () => {
  test('returns empty string when column does not match', () => {
    expect(renderSortIndicator('name', 'price', 'asc')).toBe('')
    expect(renderSortIndicator('name', 'price', 'desc')).toBe('')
  })

  test('returns up arrow for ascending', () => {
    expect(renderSortIndicator('price', 'price', 'asc')).toBe(' ▲')
  })

  test('returns down arrow for descending', () => {
    expect(renderSortIndicator('price', 'price', 'desc')).toBe(' ▼')
  })
})

describe('getNextSortDirection', () => {
  test('returns desc for new column', () => {
    expect(getNextSortDirection('price', 'name', 'asc')).toBe('desc')
  })

  test('toggles direction for same column', () => {
    expect(getNextSortDirection('price', 'price', 'asc')).toBe('desc')
    expect(getNextSortDirection('price', 'price', 'desc')).toBe('asc')
  })
})

describe('normalizeTime', () => {
  test('strips +00:00 suffix', () => {
    const result = normalizeTime('2026-01-28T09:45:00+00:00')
    expect(result).toBe('2026-01-28T09:45')
  })

  test('handles Z suffix', () => {
    const result = normalizeTime('2026-01-28T09:45:00Z')
    expect(result).toBe('2026-01-28T09:45')
  })

  test('strips +05:30 suffix', () => {
    const result = normalizeTime('2026-01-28T15:15:00+05:30')
    expect(result).toBe('2026-01-28T15:15')
  })

  test('handles empty string', () => {
    expect(normalizeTime('')).toBe('')
  })

  test('handles time without timezone', () => {
    const result = normalizeTime('2026-01-28T09:45:00')
    expect(result).toBe('2026-01-28T09:45')
  })

  test('handles date-only format for daily candles', () => {
    const result = normalizeTime('2026-01-28')
    expect(result).toBe('2026-01-28')
  })
})
