import { describe, expect, test } from 'bun:test'
import { fetchAndRenderSnapshot } from './integration_renderer'

describe('integration snapshot with mocked api responses', () => {
  test('renders section title, profile headers and summary strip content', async () => {
    const responses: Record<string, any> = {
      'http://localhost:8765/api/screeners': {
        default: 'market_open_gap',
        screeners: [{ id: 'market_open_gap', label: 'Gap Open', description: '' }],
      },
      'http://localhost:8765/api/screener?provider=upstox&mode=historical&screener=market_open_gap': {
        screener: 'market_open_gap',
        profile_meta: {
          section_labels: {
            primary: '📈 GAP OPEN CANDIDATES',
            secondary: '✅ LARGER GAP MOVERS',
          },
        },
        summary: [
          { label: 'Avg Gap', value: '+1.80%' },
          { label: 'Max Gap', value: '+4.20%' },
        ],
      },
    }

    const fetchMock = async (input: string) => ({
      ok: true,
      json: async () => responses[input],
    })

    const snapshot = await fetchAndRenderSnapshot(fetchMock as any, 'http://localhost:8765', 'market_open_gap')
    expect(snapshot).toContain('📈 GAP OPEN CANDIDATES')
    expect(snapshot).toContain('HEADERS:Symbol|Score|Gap %|Pre-Mkt %|Day %|Volume M|Sector')
    expect(snapshot).toContain('SUMMARY:Avg Gap:+1.80%|Max Gap:+4.20%')
  })
})
