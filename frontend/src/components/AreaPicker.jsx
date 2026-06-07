import React, { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import { useStore } from '../store.js'
import { fetchBaseline } from '../api.js'

const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

export default function AreaPicker() {
  const mapRef  = useRef(null)
  const mapEl   = useRef(null)
  const drawRef = useRef(null)

  const [polygon,        setPolygon]        = useState(null)
  const [query,          setQuery]          = useState('')
  const [results,        setResults]        = useState([])
  const [searchLoading,  setSearchLoading]  = useState(false)
  const [showResults,    setShowResults]    = useState(false)
  const debounceRef = useRef(null)

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
      center: [10, 51],   // Europe centre
      zoom: 4,
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
    if (feat?.geometry?.type === 'Polygon') setPolygon(feat.geometry)
  }

  function startDraw() {
    drawRef.current?.changeMode('draw_polygon')
  }

  // ── Address search via Nominatim ────────────────────────────────────────────
  const search = useCallback((q) => {
    if (!q.trim()) { setResults([]); return }
    setSearchLoading(true)
    fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&addressdetails=0`,
      { headers: { 'Accept-Language': 'en' } }
    )
      .then((r) => r.json())
      .then((data) => { setResults(data); setShowResults(true) })
      .catch(() => setResults([]))
      .finally(() => setSearchLoading(false))
  }, [])

  function onQueryChange(e) {
    const v = e.target.value
    setQuery(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(v), 420)
  }

  function selectResult(r) {
    setQuery(r.display_name.split(',').slice(0, 2).join(','))
    setShowResults(false)
    setResults([])
    const lon = parseFloat(r.lon)
    const lat = parseFloat(r.lat)
    if (r.boundingbox) {
      const [s, n, w, e] = r.boundingbox.map(parseFloat)
      mapRef.current?.fitBounds([[w, s], [e, n]], { padding: 80, duration: 1200, maxZoom: 16 })
    } else {
      mapRef.current?.flyTo({ center: [lon, lat], zoom: 15, duration: 1200 })
    }
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

      {/* Control panel */}
      <div style={{
        position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(255,255,255,0.97)', borderRadius: 12,
        padding: '16px 20px', boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
        minWidth: 340, zIndex: 10,
      }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 2, color: '#1e293b' }}>
          Urban Heat Tool
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
          Search for any city or address in Europe
        </div>

        {/* Search box */}
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <div style={{ position: 'relative' }}>
            <input
              value={query}
              onChange={onQueryChange}
              onFocus={() => results.length > 0 && setShowResults(true)}
              onBlur={() => setTimeout(() => setShowResults(false), 180)}
              placeholder="e.g. Eixample, Barcelona…"
              style={{
                width: '100%', boxSizing: 'border-box',
                border: '1.5px solid #e2e8f0', borderRadius: 8,
                padding: '8px 36px 8px 12px', fontSize: 13,
                outline: 'none', color: '#1e293b',
              }}
            />
            {searchLoading
              ? <span style={iconStyle}>⟳</span>
              : <span style={iconStyle}>🔍</span>
            }
          </div>

          {/* Results dropdown */}
          {showResults && results.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)', marginTop: 4, overflow: 'hidden',
            }}>
              {results.map((r) => (
                <div key={r.place_id} onMouseDown={() => selectResult(r)}
                  style={{
                    padding: '9px 12px', cursor: 'pointer', fontSize: 12,
                    borderBottom: '1px solid #f1f5f9', color: '#1e293b',
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ color: '#94a3b8', flexShrink: 0, marginTop: 1 }}>📍</span>
                  <span style={{ lineHeight: 1.4 }}>
                    {r.display_name.split(',').slice(0, 4).join(', ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Draw / Analyse buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={startDraw} style={btnStyle('#2563eb')}>
            ✏ Draw area
          </button>
          {polygon && (
            <button onClick={analyze} disabled={loading} style={btnStyle(loading ? '#94a3b8' : '#16a34a')}>
              {loading ? 'Analysing…' : 'Analyse heat'}
            </button>
          )}
        </div>

        {polygon && !loading && (
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
            Area selected — click Analyse heat to run simulation.
          </div>
        )}
      </div>

      {loading && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.38)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: 20, color: '#fff',
        }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Running UTCI simulation…</div>
          <div style={{ fontSize: 13, opacity: 0.8 }}>Fetching weather · buildings · thermal comfort (~30s)</div>
        </div>
      )}
    </div>
  )
}

const iconStyle = {
  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
  fontSize: 14, pointerEvents: 'none', color: '#94a3b8',
}

function btnStyle(bg) {
  return {
    background: bg, color: '#fff', border: 'none',
    padding: '8px 18px', borderRadius: 6,
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    flex: 1,
  }
}
