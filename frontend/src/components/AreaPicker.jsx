import React, { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import { useStore } from '../store.js'
import { fetchBaseline } from '../api.js'

const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

export default function AreaPicker() {
  const mapRef    = useRef(null)
  const mapEl     = useRef(null)
  const drawRef   = useRef(null)
  const [polygon, setPolygon] = useState(null)

  const setStorePolygon = useStore((s) => s.setPolygon)
  const setBaseline     = useStore((s) => s.setBaseline)
  const setLoading      = useStore((s) => s.setLoading)
  const setError        = useStore((s) => s.setError)
  const loading         = useStore((s) => s.loading)

  useEffect(() => {
    if (mapRef.current) return
    mapRef.current = new maplibregl.Map({
      container: mapEl.current,
      style: STYLE,
      center: [2.165, 41.390],
      zoom: 13,
      pitch: 0,
    })

    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-right')

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: false, trash: true },
      modes: { ...MapboxDraw.modes },
      defaultMode: 'simple_select',
      styles: [
        {
          id: 'gl-draw-polygon-fill',
          type: 'fill',
          filter: ['all', ['==', '$type', 'Polygon']],
          paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.2 },
        },
        {
          id: 'gl-draw-polygon-stroke',
          type: 'line',
          filter: ['all', ['==', '$type', 'Polygon']],
          paint: { 'line-color': '#2563eb', 'line-width': 2 },
        },
      ],
    })
    mapRef.current.addControl(draw, 'top-left')
    drawRef.current = draw

    mapRef.current.on('draw.create', handleDraw)
    mapRef.current.on('draw.update', handleDraw)
    mapRef.current.on('draw.delete', () => setPolygon(null))

    return () => mapRef.current?.remove()
  }, [])

  function handleDraw(e) {
    const feat = e.features?.[0]
    if (feat?.geometry?.type === 'Polygon') {
      setPolygon(feat.geometry)
    }
  }

  function startDraw() {
    drawRef.current?.changeMode('draw_polygon')
  }

  async function analyze() {
    if (!polygon) return
    setStorePolygon(polygon)
    setLoading(true)
    setError(null)
    try {
      const data = await fetchBaseline(polygon)
      setBaseline(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={mapEl} style={{ width: '100%', height: '100%' }} />

      {/* Instruction banner */}
      <div style={{
        position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(255,255,255,0.95)', borderRadius: 10,
        padding: '12px 20px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        textAlign: 'center', minWidth: 280, zIndex: 10,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: '#1e293b' }}>
          Barcelona Urban Heat Tool
        </div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
          Draw a square on the map to select a neighbourhood
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button onClick={startDraw} style={btnStyle('#2563eb')}>
            Draw area
          </button>
          {polygon && (
            <button onClick={analyze} disabled={loading} style={btnStyle(loading ? '#94a3b8' : '#16a34a')}>
              {loading ? 'Analysing...' : 'Analyse heat'}
            </button>
          )}
        </div>
        {polygon && !loading && (
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
            Area selected. Click Analyse heat to run simulation.
          </div>
        )}
      </div>

      {loading && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: 20, color: '#fff',
        }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Running UTCI simulation...</div>
          <div style={{ fontSize: 13, opacity: 0.8 }}>Fetching Barcelona weather + buildings + thermal comfort (~30s)</div>
        </div>
      )}
    </div>
  )
}

function btnStyle(bg) {
  return {
    background: bg, color: '#fff', border: 'none',
    padding: '8px 18px', borderRadius: 6,
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
  }
}
