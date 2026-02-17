import { COLUMN_LABELS, getColumnKeysForProfile } from './ui_schema'

type ScreenerData = {
  screener: string
  profile_meta?: { section_labels?: { primary: string; secondary: string } }
  summary?: Array<{ label: string; value: string }>
}

export function renderSnapshotFromApiPayload(data: ScreenerData): string {
  const labels = data.profile_meta?.section_labels || {
    primary: '🎯 APPROACHING 52W HIGH',
    secondary: '✅ ALREADY TOUCHED 52W HIGH',
  }
  const headerLabels = getColumnKeysForProfile(data.screener, false).map((k) => COLUMN_LABELS[k]).join('|')
  const summaryLabels = (data.summary || []).map((s) => `${s.label}:${s.value}`).join('|')
  return `${labels.primary}\nHEADERS:${headerLabels}\nSUMMARY:${summaryLabels}`
}

export async function fetchAndRenderSnapshot(
  fetchImpl: (input: string) => Promise<{ ok: boolean; json: () => Promise<any> }>,
  baseUrl: string,
  screener = 'market_open_gap'
): Promise<string> {
  const screenersRes = await fetchImpl(`${baseUrl}/api/screeners`)
  if (!screenersRes.ok) throw new Error('screeners fetch failed')
  await screenersRes.json()

  const dataRes = await fetchImpl(`${baseUrl}/api/screener?provider=upstox&mode=historical&screener=${screener}`)
  if (!dataRes.ok) throw new Error('data fetch failed')
  const data = await dataRes.json()
  return renderSnapshotFromApiPayload(data)
}
