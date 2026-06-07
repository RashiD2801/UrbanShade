import React from 'react'
import { useStore } from '../store.js'
import { fetchBestScenario } from '../api.js'
import { computeHotspotStats } from '../utils/hotspot.js'

const COMFORT_UTCI = 26

export default function AutoSimPanel({ onCaptureMaps }) {
  const baseline          = useStore((s) => s.baseline)
  const polygon           = useStore((s) => s.polygon)
  const autoSimLoading    = useStore((s) => s.autoSimLoading)
  const autoSimResults    = useStore((s) => s.autoSimResults)   // single result now
  const setAutoSimResults = useStore((s) => s.setAutoSimResults)
  const setAutoSimLoading = useStore((s) => s.setAutoSimLoading)
  const setError          = useStore((s) => s.setError)
  const loadAutoSimScenario = useStore((s) => s.loadAutoSimScenario)

  const baselineUtci = baseline?.stats?.mean_utci ?? null
  const alreadyComfortable = baselineUtci != null && baselineUtci <= COMFORT_UTCI

  // Hotspot stats from baseline (no scenario yet)
  const hsBaseline = baseline?.grid ? computeHotspotStats(baseline.grid) : null
  // Hotspot stats from result
  const hsResult = (autoSimResults && !autoSimResults.error && baseline?.grid)
    ? computeHotspotStats(baseline.grid, autoSimResults.grid ?? null)
    : null

  async function handleRun() {
    if (!baseline || !polygon) return
    setAutoSimLoading(true)
    setAutoSimResults(null)
    setError(null)
    try {
      const result = await fetchBestScenario(
        polygon,
        baseline.ground_materials,
        baseline.buildings,
        baselineUtci,
        baseline.grid   ?? null,
        baseline.bounds ?? null,
      )
      setAutoSimResults(result)
    } catch (err) {
      setError(`Auto-simulate failed: ${err.message}`)
    } finally {
      setAutoSimLoading(false)
    }
  }

  function handleViewOnMap() {
    if (autoSimResults && !autoSimResults.error) {
      loadAutoSimScenario(autoSimResults)
    }
  }

  async function handleDownloadPDF() {
    if (!autoSimResults || autoSimResults.error) return
    const { jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')

    // 1. Load scenario on the maps so the screenshot shows trees + heatmap
    loadAutoSimScenario(autoSimResults)

    // 2. Capture both map canvases (waits for idle)
    let images = { axo: null, utci: null }
    if (onCaptureMaps) {
      images = await onCaptureMaps()
    }

    // 3. Build PDF
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const W = doc.internal.pageSize.getWidth()
    const M = 16
    let y = M

    // Header
    doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59)
    doc.text('Urban Heat Intervention Report', M, y); y += 7
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139)
    doc.text(
      `${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}  ·  Urban Heat Tool`,
      M, y
    ); y += 5
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 5

    // Hotspot headline
    if (hsResult?.delta != null) {
      doc.setFontSize(22); doc.setFont('helvetica', 'bold'); doc.setTextColor(21, 128, 61)
      doc.text(`−${hsResult.delta}°C`, M, y); y += 7
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 41, 59)
      doc.text(`Improvement in critical zones (top 25% hottest areas)`, M, y); y += 5
      doc.setFontSize(8); doc.setTextColor(100, 116, 139)
      doc.text(`Hotspot zones: ${hsResult.baselineMean}°C → ${hsResult.scenarioMean}°C`, M, y); y += 3
      doc.text(`Overall mean: −${autoSimResults.meta?.actual_delta_c}°C  (${baselineUtci?.toFixed(1)}°C → ${autoSimResults.stats?.mean_utci?.toFixed(1)}°C)`, M, y); y += 7
    }

    // Map images side by side
    if (images.axo || images.utci) {
      const imgW = (W - M * 2 - 4) / 2
      const imgH = imgW * 0.62
      if (images.axo)  doc.addImage(images.axo,  'JPEG', M,              y, imgW, imgH)
      if (images.utci) doc.addImage(images.utci, 'JPEG', M + imgW + 4,   y, imgW, imgH)
      doc.setFontSize(7); doc.setTextColor(100, 116, 139)
      doc.text('3D Axonometric View',     M + imgW / 2,           y + imgH + 3, { align: 'center' })
      doc.text('UTCI Thermal Comfort Map', M + imgW + 4 + imgW / 2, y + imgH + 3, { align: 'center' })
      y += imgH + 8
    }

    // Stats table
    const meta  = autoSimResults.meta ?? {}
    const stats = autoSimResults.stats ?? {}
    autoTable(doc, {
      startY: y,
      head: [],
      body: [
        ['Species planted',         meta.species_name ?? 'Tipuana tipu'],
        ['Trees planted',           `${meta.trees_count ?? 0}`],
        ['Surface zones changed',   `${meta.mat_zones ?? 0}`],
        ['Reaches comfort (< 26°C)', meta.reaches_comfort ? 'Yes' : `No — ${((stats.mean_utci ?? 26) - COMFORT_UTCI).toFixed(1)}°C above`],
        ['Total cost',              `€ ${(meta.cost_eur ?? 0).toLocaleString()}`],
        ['  Surface works',         `€ ${(stats.zones_cost_eur ?? 0).toLocaleString()}`],
        ['  Tree planting',         `€ ${(stats.trees_cost_eur ?? 0).toLocaleString()}`],
      ],
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 2.5 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 80 }, 1: { halign: 'right' } },
      margin: { left: M, right: M },
    })

    // Footer
    doc.setFontSize(6); doc.setTextColor(148, 163, 184)
    doc.text(
      'UTCI simulations via Infrared SDK · Trees placed in hottest zones first · Lime green = simulated trees',
      M, doc.internal.pageSize.getHeight() - 8
    )

    doc.save('urban-heat-best-scenario.pdf')
  }

  if (!baseline) {
    return (
      <div style={panelStyle}>
        <Heading />
        <p style={hintStyle}>Run a baseline analysis first.</p>
      </div>
    )
  }

  return (
    <div style={panelStyle}>
      <Heading />

      {/* Baseline hotspot summary */}
      {hsBaseline && !autoSimResults && (
        <div style={statBoxStyle}>
          <Row label="Overall mean UTCI"    value={`${baselineUtci?.toFixed(1)} °C`} />
          <Row label="Critical zones (top 25%)" value={`${hsBaseline.baselineMean} °C`} hot />
          <Row label="Target"               value={`< ${COMFORT_UTCI} °C`} green />
          <Row label="Gap in hotspot zones"
               value={alreadyComfortable ? 'Comfortable ✓' : `${Math.max(0, hsBaseline.baselineMean - COMFORT_UTCI).toFixed(1)} °C`}
               hot={!alreadyComfortable} green={alreadyComfortable} />
        </div>
      )}

      {/* Result card */}
      {autoSimResults && !autoSimResults.error && (() => {
        const meta  = autoSimResults.meta ?? {}
        const stats = autoSimResults.stats ?? {}
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Hotspot headline */}
            <div style={{
              background: '#14532d', border: '1px solid #166534',
              borderRadius: 10, padding: '12px 14px', textAlign: 'center',
            }}>
              {hsResult?.delta != null ? (
                <>
                  <div style={{ fontSize: 10, color: '#86efac', marginBottom: 2 }}>Critical zones improvement</div>
                  <div style={{ fontSize: 36, fontWeight: 900, color: '#4ade80', lineHeight: 1 }}>
                    −{hsResult.delta}°C
                  </div>
                  <div style={{ fontSize: 10, color: '#86efac', marginTop: 3 }}>
                    {hsResult.baselineMean}°C → {hsResult.scenarioMean}°C in hotspot zones
                  </div>
                  <div style={{ fontSize: 10, color: '#4ade80', marginTop: 1, opacity: 0.8 }}>
                    Overall mean: −{meta.actual_delta_c}°C
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 24, fontWeight: 900, color: '#4ade80' }}>
                  −{meta.actual_delta_c}°C
                </div>
              )}
            </div>

            {/* Intervention details */}
            <div style={statBoxStyle}>
              <Row label="Species"       value={meta.species_name ?? 'Tipuana'} />
              <Row label="Trees planted" value={`${meta.trees_count ?? 0}`} />
              <Row label="Surface zones" value={`${meta.mat_zones ?? 0} changed`} />
              <Row label="Total cost"    value={`€ ${(meta.cost_eur ?? 0).toLocaleString()}`} />
            </div>

            {/* Action buttons */}
            <button onClick={handleViewOnMap} style={btn('#166534')}>
              View on map (3D)
            </button>
            <button onClick={handleDownloadPDF} style={btn('#1e40af')}>
              Download PDF report
            </button>
            <button onClick={() => setAutoSimResults(null)} style={btn('#334155')}>
              Run again
            </button>
          </div>
        )
      })()}

      {autoSimResults?.error && (
        <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>
          {autoSimResults.error}
        </div>
      )}

      {/* Run button */}
      {!autoSimResults && !alreadyComfortable && (
        <button onClick={handleRun} disabled={autoSimLoading}
          style={btn(autoSimLoading ? '#334155' : '#2563eb')}>
          {autoSimLoading ? 'Simulating… (~30–60s)' : 'Find best cooling intervention'}
        </button>
      )}

      {!autoSimResults && alreadyComfortable && (
        <p style={{ ...hintStyle, color: '#4ade80' }}>Area is already comfortable.</p>
      )}

      {autoSimLoading && <ProgressSteps />}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Heading() {
  return (
    <div style={{ fontSize: 13, fontWeight: 800, color: '#1e293b',
      letterSpacing: '0.02em', textTransform: 'uppercase' }}>
      Auto-Simulate
    </div>
  )
}

function Row({ label, value, hot, green }) {
  const color = hot ? '#dc2626' : green ? '#16a34a' : '#1e293b'
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{ fontWeight: 700, color }}>{value}</span>
    </div>
  )
}

function ProgressSteps() {
  const steps = [
    'Identifying hotspot zones…',
    'Placing trees in critical areas…',
    'Running UTCI simulation…',
  ]
  const [active, setActive] = React.useState(0)
  React.useEffect(() => {
    const ts = [800, 5000, 12000].map((ms, i) => setTimeout(() => setActive(i + 1), ms))
    return () => ts.forEach(clearTimeout)
  }, [])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      {steps.map((s, i) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
          <span style={{ color: i < active ? '#16a34a' : i === active ? '#2563eb' : '#cbd5e1' }}>
            {i < active ? '✓' : i === active ? '⟳' : '○'}
          </span>
          <span style={{ color: i < active ? '#64748b' : i === active ? '#1e293b' : '#cbd5e1' }}>
            {s}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const panelStyle   = { padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }
const statBoxStyle = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px' }
const hintStyle    = { fontSize: 11, color: '#64748b', lineHeight: 1.5 }

function btn(bg) {
  return {
    background: bg, color: '#fff', border: 'none',
    padding: '9px 14px', borderRadius: 8,
    fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%',
  }
}
