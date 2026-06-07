import React, { useRef } from 'react'
import { useStore } from '../store.js'
import { computeHotspotStats } from '../utils/hotspot.js'

const ARCHETYPE_META = {
  most_cost_effective: {
    label: 'Most Cost-Effective',
    icon: '💶',
    accent: '#0369a1',
    bg: '#eff6ff',
    border: '#bfdbfe',
    desc: 'Least spend. Fewest trees, no surface changes.',
  },
  most_impactful: {
    label: 'Most Impactful',
    icon: '🌡',
    accent: '#b91c1c',
    bg: '#fff1f2',
    border: '#fecaca',
    desc: 'All surfaces → vegetation + up to 75 trees. No limits.',
  },
  most_balanced: {
    label: 'Most Balanced',
    icon: '⚖',
    accent: '#15803d',
    bg: '#f0fdf4',
    border: '#bbf7d0',
    desc: 'Partial surface swap + moderate tree planting.',
  },
}

export default function SimReport({ onClose }) {
  const autoSimResults      = useStore((s) => s.autoSimResults)
  const loadAutoSimScenario = useStore((s) => s.loadAutoSimScenario)
  const openAutoSimViewer   = useStore((s) => s.openAutoSimViewer)
  const baseline            = useStore((s) => s.baseline)
  const reportRef = useRef(null)

  if (!autoSimResults) return null

  const { baseline_utci, comfort_threshold, gap_c, scenarios } = autoSimResults

  async function downloadPDF() {
    const { jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')

    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageW = doc.internal.pageSize.getWidth()
    const margin = 18
    let y = margin

    // ── Header ─────────────────────────────────────────────────────────────
    doc.setFontSize(20)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 41, 59)
    doc.text('Urban Heat Simulation Report', margin, y)
    y += 7

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 116, 139)
    doc.text(`Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}  ·  Urban Heat Tool`, margin, y)
    y += 8

    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.4)
    doc.line(margin, y, pageW - margin, y)
    y += 8

    // ── Baseline summary ───────────────────────────────────────────────────
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 41, 59)
    doc.text('Baseline Conditions', margin, y)
    y += 6

    const baselineRows = [
      ['Baseline mean UTCI', `${baseline_utci} °C`],
      ['Human comfort threshold', `< ${comfort_threshold} °C`],
      ['Temperature gap to close', gap_c > 0 ? `${gap_c} °C` : 'Already comfortable'],
    ]
    autoTable(doc, {
      startY: y,
      head: [],
      body: baselineRows,
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 80 }, 1: { halign: 'right' } },
      margin: { left: margin, right: margin },
    })
    y = doc.lastAutoTable.finalY + 10

    // ── Scenario cards ─────────────────────────────────────────────────────
    const archetypeOrder = ['most_cost_effective', 'most_impactful', 'most_balanced']

    for (const key of archetypeOrder) {
      const scenario = scenarios[key]
      if (!scenario || scenario.error) continue
      const meta = ARCHETYPE_META[key]
      const stats = scenario.stats ?? {}
      const sim_meta = scenario.meta ?? {}

      if (y > 230) { doc.addPage(); y = margin }

      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(30, 41, 59)
      doc.text(`${meta.icon}  ${meta.label}`, margin, y)
      y += 5

      doc.setFontSize(8)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(100, 116, 139)
      doc.text(meta.desc, margin, y)
      y += 5

      const actual_delta = sim_meta.actual_delta_c ?? (baseline_utci - (stats.mean_utci ?? baseline_utci))
      const reaches = sim_meta.reaches_comfort ?? stats.mean_utci <= comfort_threshold

      const rows = [
        ['Simulated mean UTCI', `${stats.mean_utci?.toFixed(1) ?? '—'} °C`],
        ['UTCI reduction', `${actual_delta?.toFixed(1) ?? '—'} °C`],
        ['Reaches comfort', reaches ? 'Yes ✓' : `No — ${(stats.mean_utci - comfort_threshold).toFixed(1)} °C above target`],
        ['Trees planted', `${stats.trees_count ?? 0}`],
        ['Surface changes', `${sim_meta.mat_zones ?? 0} zone(s)`],
        ['Total cost', `€ ${(stats.cost_eur ?? 0).toLocaleString()}`],
        ['  — Surface works', `€ ${(stats.zones_cost_eur ?? 0).toLocaleString()}`],
        ['  — Tree planting', `€ ${(stats.trees_cost_eur ?? 0).toLocaleString()}`],
      ]

      autoTable(doc, {
        startY: y,
        head: [],
        body: rows,
        theme: 'striped',
        styles: { fontSize: 8, cellPadding: 2.5 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 80 }, 1: { halign: 'right' } },
        margin: { left: margin, right: margin },
      })
      y = doc.lastAutoTable.finalY + 8
    }

    // ── Footer ─────────────────────────────────────────────────────────────
    doc.setFontSize(7)
    doc.setTextColor(148, 163, 184)
    doc.text(
      'UTCI simulations powered by Infrared SDK · Heuristic pre-screening + 3 real simulations per report',
      margin, doc.internal.pageSize.getHeight() - 10
    )

    doc.save('urban-heat-simulation-report.pdf')
  }

  return (
    <div style={overlayStyle}>
      <div ref={reportRef} style={panelStyle}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#1e293b' }}>Simulation Results</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              Baseline: <b>{baseline_utci} °C</b> mean UTCI &nbsp;·&nbsp;
              Gap to comfort: <b style={{ color: gap_c > 0 ? '#dc2626' : '#16a34a' }}>
                {gap_c > 0 ? `${gap_c} °C` : 'Already comfortable'}
              </b>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={downloadPDF} style={actionBtn('#475569')}>
              Download PDF
            </button>
            <button onClick={openAutoSimViewer} style={actionBtn('#2563eb')}>
              View all 3 on map
            </button>
            <button onClick={onClose} style={actionBtn('#64748b')}>
              Close
            </button>
          </div>
        </div>

        {/* Scenario cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {['most_cost_effective', 'most_impactful', 'most_balanced'].map((key) => (
            <ScenarioCard
              key={key}
              archetypeKey={key}
              scenario={scenarios[key]}
              baselineGrid={baseline?.grid}
              baselineUtci={baseline_utci}
              comfortThreshold={comfort_threshold}
              onViewOnMap={() => { loadAutoSimScenario(scenarios[key]); onClose() }}
            />
          ))}
        </div>

        {/* Methodology note */}
        <div style={{ marginTop: 14, fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
          <b>Methodology:</b> Candidate scenarios are pre-screened with a fast heuristic model (material
          albedo + tree canopy effectiveness), then the top 3 archetypes are verified with full Infrared
          UTCI simulations. Costs include installation and demolition only; annual maintenance not included.
        </div>
      </div>
    </div>
  )
}

function ScenarioCard({ archetypeKey, scenario, baselineGrid, baselineUtci, comfortThreshold, onViewOnMap }) {
  const meta = ARCHETYPE_META[archetypeKey]

  if (!scenario || scenario.error) {
    return (
      <div style={{ ...cardStyle(meta), opacity: 0.6 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{meta.icon} {meta.label}</div>
        <div style={{ fontSize: 11, color: '#dc2626', marginTop: 8 }}>Simulation failed</div>
        {scenario?.error && (
          <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 4, wordBreak: 'break-word' }}>
            {scenario.error}
          </div>
        )}
      </div>
    )
  }

  const stats    = scenario.stats ?? {}
  const sim_meta = scenario.meta ?? {}
  const overallDelta  = sim_meta.actual_delta_c ?? (baselineUtci - (stats.mean_utci ?? baselineUtci))
  const reachesComfort = stats.mean_utci <= comfortThreshold
  const remaining = Math.max(0, (stats.mean_utci ?? comfortThreshold) - comfortThreshold)

  // Hotspot stats — the headline metric
  const hs = baselineGrid ? computeHotspotStats(baselineGrid, scenario.grid ?? null) : null

  return (
    <div style={cardStyle(meta)}>
      {/* Title */}
      <div style={{ fontSize: 13, fontWeight: 800, color: meta.accent, marginBottom: 2 }}>
        {meta.icon} {meta.label}
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 10 }}>{meta.desc}</div>

      {/* Hotspot headline */}
      {hs?.delta != null ? (
        <div style={{ textAlign: 'center', padding: '10px 0', borderTop: `1px solid ${meta.border}`, borderBottom: `1px solid ${meta.border}`, marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>Hotspot zones (top 25%)</div>
          <div style={{ fontSize: 32, fontWeight: 900, color: '#15803d', lineHeight: 1 }}>
            −{hs.delta}°C
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
            {hs.baselineMean}°C → {hs.scenarioMean}°C in critical areas
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 4, borderTop: `1px solid ${meta.border}`, paddingTop: 4 }}>
            Overall mean: −{overallDelta?.toFixed(1)}°C &nbsp;·&nbsp;
            <span style={{ color: reachesComfort ? '#15803d' : '#a16207' }}>
              {reachesComfort ? 'Comfort reached ✓' : `${remaining.toFixed(1)}°C above comfort`}
            </span>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '10px 0', borderTop: `1px solid ${meta.border}`, borderBottom: `1px solid ${meta.border}`, marginBottom: 10 }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: meta.accent, lineHeight: 1 }}>
            −{overallDelta?.toFixed(1)}°C
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
            {stats.mean_utci?.toFixed(1)}°C after intervention
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <CardRow icon="🌳" label="Trees planted" value={stats.trees_count ?? 0} />
        <CardRow icon="🏗" label="Surface zones"  value={`${sim_meta.mat_zones ?? 0} changed`} />
        <CardRow icon="💶" label="Total cost"      value={`€ ${(stats.cost_eur ?? 0).toLocaleString()}`} accent />
        <div style={{ borderTop: `1px solid ${meta.border}`, paddingTop: 5, marginTop: 2 }}>
          <CardRow icon="" label="  Surface works" value={`€ ${(stats.zones_cost_eur ?? 0).toLocaleString()}`} small />
          <CardRow icon="" label="  Tree planting"  value={`€ ${(stats.trees_cost_eur ?? 0).toLocaleString()}`} small />
        </div>
      </div>

    </div>
  )
}

function CardRow({ icon, label, value, accent, small }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: small ? 10 : 11, color: '#64748b' }}>{icon} {label}</span>
      <span style={{ fontSize: small ? 10 : 11, fontWeight: accent ? 800 : 600, color: accent ? '#1e293b' : '#475569' }}>
        {value}
      </span>
    </div>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 24,
}

const panelStyle = {
  background: '#fff',
  borderRadius: 16,
  padding: '24px 28px',
  width: '100%',
  maxWidth: 920,
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
}

function cardStyle(meta) {
  return {
    background: meta.bg,
    border: `1.5px solid ${meta.border}`,
    borderRadius: 12,
    padding: '16px 14px',
  }
}

function actionBtn(bg) {
  return {
    background: bg,
    color: '#fff',
    border: 'none',
    padding: '8px 16px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  }
}
