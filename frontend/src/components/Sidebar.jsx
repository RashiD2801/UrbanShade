import React from 'react'
import { useStore } from '../store.js'

const MAT_COLORS = {
  concrete: '#c8c8c8', asphalt: '#555555',
  soil: '#c4a265', vegetation: '#4caf50', water: '#1e90ff',
}
const MAT_LABELS = {
  concrete: 'Light Concrete', asphalt: 'Asphalt',
  soil: 'Permeable Soil', vegetation: 'Grass/Plants', water: 'Water Feature',
}

function fmt(n, dec = 1) {
  if (n == null) return '--'
  return Number(n).toFixed(dec)
}

export default function Sidebar() {
  const baseline     = useStore((s) => s.baseline)
  const scenario     = useStore((s) => s.scenario)
  const paintedZones = useStore((s) => s.paintedZones)
  const clearZones   = useStore((s) => s.clearPaintedZones)

  const delta = scenario && baseline
    ? (scenario.stats.mean_utci - baseline.stats.mean_utci).toFixed(2)
    : null

  const zoneSummary = paintedZones.reduce((acc, z) => {
    acc[z.material] = (acc[z.material] || 0) + 1
    return acc
  }, {})

  return (
    <div style={{
      width: 260, background: '#0f172a', color: '#e2e8f0',
      display: 'flex', flexDirection: 'column', padding: '16px 14px',
      gap: 16, overflowY: 'auto', fontSize: 13, zIndex: 10,
    }}>
      <div style={{ fontWeight: 800, fontSize: 15, color: '#f8fafc', letterSpacing: '0.01em' }}>
        Urban Heat Impact
      </div>

      {/* Baseline */}
      <Section title="Baseline (July avg)">
        <Kpi label="Mean UTCI"   value={`${fmt(baseline?.stats?.mean_utci)} °C`} />
        <Kpi label="Max UTCI"    value={`${fmt(baseline?.stats?.max_utci)} °C`} />
        <Kpi label="Buildings"   value={baseline?.stats?.n_buildings ?? '--'} />
      </Section>

      {/* Painted zones */}
      {paintedZones.length > 0 && (
        <Section title="Painted zones">
          {Object.entries(zoneSummary).map(([mat, count]) => (
            <div key={mat} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <div style={{ width: 14, height: 14, background: MAT_COLORS[mat], borderRadius: 3 }} />
              <span style={{ color: '#cbd5e1' }}>{MAT_LABELS[mat]}</span>
              <span style={{ marginLeft: 'auto', color: '#94a3b8' }}>{count} zone{count > 1 ? 's' : ''}</span>
            </div>
          ))}
          <button onClick={clearZones} style={{
            marginTop: 8, width: '100%', background: 'none',
            border: '1px solid #334155', color: '#94a3b8', borderRadius: 6,
            padding: '5px 0', cursor: 'pointer', fontSize: 12,
          }}>
            Clear all zones
          </button>
        </Section>
      )}

      {/* Scenario result */}
      {scenario && (
        <Section title="Scenario result">
          <Kpi label="Mean UTCI"  value={`${fmt(scenario.stats.mean_utci)} °C`} />
          <Kpi
            label="Delta UTCI"
            value={delta !== null ? `${delta > 0 ? '+' : ''}${delta} °C` : '--'}
            highlight={delta !== null ? (parseFloat(delta) < 0 ? 'green' : parseFloat(delta) > 0 ? 'red' : null) : null}
          />
          <Kpi label="Painted area" value={`${fmt(scenario.stats.area_m2, 0)} m²`} />
          <Kpi label="Total cost"   value={`€ ${Number(scenario.stats.cost_eur).toLocaleString()}`} />
          {scenario.stats.area_m2 > 0 && parseFloat(delta) < 0 && (
            <Kpi
              label="Cost / °C improvement"
              value={`€ ${Math.round(scenario.stats.cost_eur / Math.abs(parseFloat(delta))).toLocaleString()}`}
            />
          )}
        </Section>
      )}

      {/* Material legend */}
      <Section title="Material key">
        {Object.entries(MAT_LABELS).map(([k, l]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <div style={{ width: 14, height: 14, background: MAT_COLORS[k], borderRadius: 3 }} />
            <span style={{ color: '#cbd5e1', fontSize: 12 }}>{l}</span>
          </div>
        ))}
      </Section>

      <div style={{ marginTop: 'auto', color: '#475569', fontSize: 11, lineHeight: 1.5 }}>
        Infrared SDK · UTCI July 9am–6pm<br />
        5 materials · Barcelona, Spain
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 700, color: '#475569',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8,
        borderBottom: '1px solid #1e293b', paddingBottom: 4,
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Kpi({ label, value, highlight }) {
  const color = highlight === 'green' ? '#4ade80' : highlight === 'red' ? '#f87171' : '#f8fafc'
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
      <span style={{ color: '#94a3b8' }}>{label}</span>
      <span style={{ fontWeight: 600, color }}>{value}</span>
    </div>
  )
}
