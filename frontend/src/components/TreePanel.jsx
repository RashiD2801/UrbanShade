import React from 'react'
import { useStore } from '../store.js'

export default function TreePanel() {
  const treeSpecies       = useStore((s) => s.treeSpecies)
  const activeTreeSpecies = useStore((s) => s.activeTreeSpecies)
  const treeMode          = useStore((s) => s.treeMode)
  const treePlacements    = useStore((s) => s.treePlacements)
  const setActiveTreeSpecies = useStore((s) => s.setActiveTreeSpecies)
  const setTreeMode          = useStore((s) => s.setTreeMode)
  const removeLastTree       = useStore((s) => s.removeLastTree)
  const clearTreePlacements  = useStore((s) => s.clearTreePlacements)

  function toggleTreeMode() {
    if (treeMode) {
      setTreeMode(false)
    } else {
      setTreeMode(true)
      if (!activeTreeSpecies && treeSpecies.length > 0)
        setActiveTreeSpecies(treeSpecies[0].id)
    }
  }

  const active = treeSpecies.find((t) => t.id === activeTreeSpecies)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* Mode toggle */}
      <button onClick={toggleTreeMode} style={{
        background: treeMode ? '#15803d' : 'rgba(255,255,255,0.12)',
        color: '#fff', border: treeMode ? '2px solid #4ade80' : '2px solid transparent',
        borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600,
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        transition: 'all 0.15s',
      }}>
        <span style={{ fontSize: 16 }}>🌳</span>
        {treeMode ? 'Placing trees — click map' : 'Plant trees'}
      </button>

      {treeMode && (
        <>
          {/* Hint */}
          <div style={{
            background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)',
            borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#86efac', lineHeight: 1.4,
          }}>
            Select a species below, then click on the left map to place it.
          </div>

          {/* Species list */}
          <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {treeSpecies.map((sp) => {
              const isSelected = sp.id === activeTreeSpecies
              return (
                <button key={sp.id} onClick={() => setActiveTreeSpecies(sp.id)}
                  style={{
                    background: isSelected ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.05)',
                    border: isSelected ? '1.5px solid #4ade80' : '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8, padding: '9px 10px', cursor: 'pointer',
                    textAlign: 'left', color: '#e2e8f0',
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12, color: isSelected ? '#4ade80' : '#f1f5f9' }}>
                        {sp.common_name}
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic', marginTop: 1 }}>
                        {sp.species}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
                      <div style={{
                        background: 'rgba(74,222,128,0.15)', borderRadius: 4,
                        padding: '2px 6px', fontSize: 10, color: '#86efac', whiteSpace: 'nowrap',
                      }}>
                        ⌀ {(sp.canopy_radius_m * 2).toFixed(0)} m
                      </div>
                      {sp.trunk_height_m != null && (
                        <div style={{ fontSize: 10, color: '#64748b', whiteSpace: 'nowrap' }}>
                          ↕ {(sp.trunk_height_m + sp.canopy_depth_m).toFixed(0)} m tall
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 5, fontSize: 10, color: '#94a3b8' }}>
                    <span>🌱 €{sp.planting_cost_eur.toLocaleString()}</span>
                    <span>🔧 €{sp.annual_maintenance_eur}/yr</span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Undo / clear */}
          {treePlacements.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <button onClick={removeLastTree} style={ghostBtn}>
                ↩ Undo last
              </button>
              <button onClick={clearTreePlacements} style={ghostBtn}>
                ✕ Clear all ({treePlacements.length})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const ghostBtn = {
  flex: 1, background: 'none', border: '1px solid #334155',
  color: '#94a3b8', borderRadius: 6, padding: '5px 0',
  cursor: 'pointer', fontSize: 11,
}
