import React from 'react'
import { useStore } from '../store.js'
import { computeHotspotStats } from '../utils/hotspot.js'

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
  const baseline        = useStore((s) => s.baseline)
  const scenario        = useStore((s) => s.scenario)
  const paintedZones    = useStore((s) => s.paintedZones)
  const treePlacements  = useStore((s) => s.treePlacements)
  const treeSpecies     = useStore((s) => s.treeSpecies)
  const clearZones      = useStore((s) => s.clearPaintedZones)
  const clearTrees      = useStore((s) => s.clearTreePlacements)

  const treeSpeciesMap = Object.fromEntries(treeSpecies.map((t) => [t.id, t]))

  const delta = scenario && baseline
    ? (scenario.stats.mean_utci - baseline.stats.mean_utci).toFixed(2)
    : null

  const hotspot = (baseline?.grid)
    ? computeHotspotStats(baseline.grid, scenario?.grid ?? null)
    : null

  const zoneSummary = paintedZones.reduce((acc, z) => {
    acc[z.material] = (acc[z.material] || 0) + 1
    return acc
  }, {})

  const treeSummary = treePlacements.reduce((acc, tp) => {
    acc[tp.species_id] = (acc[tp.species_id] || 0) + 1
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

      {/* Hotspot analysis — shown whenever baseline exists */}
      {hotspot && (
        <div style={{
          background: '#1e293b', border: '1px solid #334155',
          borderRadius: 10, padding: '12px 12px 10px',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Hotspot zones (top 25%)
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>Baseline</span>
            <span style={{ fontSize: 22, fontWeight: 900, color: '#f87171', lineHeight: 1 }}>
              {hotspot.baselineMean}°C
            </span>
          </div>
          {hotspot.delta != null && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>After scenario</span>
                <span style={{ fontSize: 22, fontWeight: 900, color: '#4ade80', lineHeight: 1 }}>
                  {hotspot.scenarioMean}°C
                </span>
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: '#166534', borderRadius: 8, padding: '6px 10px', marginTop: 4,
              }}>
                <span style={{ fontSize: 20, fontWeight: 900, color: '#bbf7d0' }}>
                  −{hotspot.delta}°C
                </span>
                <span style={{ fontSize: 10, color: '#86efac', lineHeight: 1.4 }}>
                  improvement in<br />critical zones
                </span>
              </div>
            </>
          )}
          <div style={{ fontSize: 10, color: '#475569', marginTop: 8 }}>
            Zones above {hotspot.threshold}°C · {Math.round(hotspot.hotspotFraction * 100)}% of area
          </div>
        </div>
      )}

      {/* Baseline */}
      <Section title="Overall baseline (July avg)">
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

      {/* Planted trees */}
      {treePlacements.length > 0 && (
        <Section title="Planted trees">
          {Object.entries(treeSummary).map(([sid, count]) => {
            const sp = treeSpeciesMap[sid]
            return (
              <div key={sid} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <div style={{ width: 14, height: 14, background: '#166534', borderRadius: 3, border: '1px solid #4ade80' }} />
                <span style={{ color: '#cbd5e1', fontSize: 12, flex: 1 }}>{sp?.common_name ?? sid}</span>
                <span style={{ color: '#94a3b8', fontSize: 11 }}>×{count}</span>
              </div>
            )
          })}
          <div style={{ borderTop: '1px solid #1e293b', marginTop: 6, paddingTop: 6 }}>
            <Kpi
              label="Est. planting cost"
              value={`€ ${treePlacements.reduce((sum, tp) => sum + (treeSpeciesMap[tp.species_id]?.planting_cost_eur ?? 0), 0).toLocaleString()}`}
            />
            <Kpi
              label="Annual maintenance"
              value={`€ ${treePlacements.reduce((sum, tp) => sum + (treeSpeciesMap[tp.species_id]?.annual_maintenance_eur ?? 0), 0).toLocaleString()}/yr`}
            />
          </div>
          <button onClick={clearTrees} style={{
            marginTop: 6, width: '100%', background: 'none',
            border: '1px solid #334155', color: '#94a3b8', borderRadius: 6,
            padding: '5px 0', cursor: 'pointer', fontSize: 12,
          }}>
            Clear all trees
          </button>
        </Section>
      )}

      {/* Scenario result */}
      {scenario && (
        <Section title="Scenario result">
          <Kpi label="Overall mean UTCI" value={`${fmt(scenario.stats.mean_utci)} °C`} />
          <Kpi
            label="Overall Δ UTCI"
            value={delta !== null ? `${delta > 0 ? '+' : ''}${delta} °C` : '--'}
            highlight={delta !== null ? (parseFloat(delta) < 0 ? 'green' : parseFloat(delta) > 0 ? 'red' : null) : null}
          />
          {scenario.stats.area_m2 > 0 && (
            <Kpi label="Painted area" value={`${fmt(scenario.stats.area_m2, 0)} m²`} />
          )}
          {scenario.stats.trees_count > 0 && (
            <Kpi label="Trees placed"    value={`${scenario.stats.trees_count}`} />
          )}
          {scenario.stats.trees_cost_eur > 0 && (
            <Kpi label="Trees cost"      value={`€ ${Number(scenario.stats.trees_cost_eur).toLocaleString()}`} />
          )}
          <Kpi label="Total cost"   value={`€ ${Number(scenario.stats.cost_eur).toLocaleString()}`} />
          {hotspot?.delta != null && scenario.stats.cost_eur > 0 && (
            <Kpi
              label="Cost / °C (hotspot)"
              value={`€ ${Math.round(scenario.stats.cost_eur / Math.abs(hotspot.delta)).toLocaleString()}`}
              highlight="green"
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
