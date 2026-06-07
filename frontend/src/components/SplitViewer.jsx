import React, { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import { useStore } from '../store.js'
import { fetchScenario, fetchTreeSpecies } from '../api.js'
import Sidebar from './Sidebar.jsx'
import TreePanel from './TreePanel.jsx'
import AutoSimPanel from './AutoSimPanel.jsx'
import SimReport from './SimReport.jsx'
import { computeHotspotStats, buildHotspotOverlayUrl, buildImprovementOverlayUrl } from '../utils/hotspot.js'

const STYLE      = 'https://tiles.openfreemap.org/styles/liberty'
const MAT_COLORS = {
  concrete:   '#c8c8c8',
  asphalt:    '#555555',
  soil:       '#c4a265',
  vegetation: '#4caf50',
  water:      '#1e90ff',
}
const MATERIALS = ['concrete', 'asphalt', 'soil', 'vegetation', 'water']
const MAT_LABELS = {
  concrete: 'Concrete', asphalt: 'Asphalt',
  soil: 'Soil', vegetation: 'Vegetation', water: 'Water',
}

// ── Colormaps ────────────────────────────────────────────────────────────────
function rdYlBuR(t) {
  const stops = [
    [0.0,  [49,  54,  149]],
    [0.15, [69,  117, 180]],
    [0.3,  [116, 173, 209]],
    [0.45, [224, 243, 248]],
    [0.5,  [255, 255, 191]],
    [0.55, [254, 224, 144]],
    [0.7,  [253, 174,  97]],
    [0.85, [244, 109,  67]],
    [1.0,  [165,   0,  38]],
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]; const [t1, c1] = stops[i + 1]
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0)
      return c0.map((v, j) => Math.round(v + f * (c1[j] - v)))
    }
  }
  return stops[stops.length - 1][1]
}

function rdBu(t) {
  const stops = [
    [0.0,  [33,  102, 172]],
    [0.25, [103, 169, 207]],
    [0.45, [209, 229, 240]],
    [0.5,  [247, 247, 247]],
    [0.55, [253, 219, 199]],
    [0.75, [239, 138,  98]],
    [1.0,  [178,  24,  43]],
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]; const [t1, c1] = stops[i + 1]
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0)
      return c0.map((v, j) => Math.round(v + f * (c1[j] - v)))
    }
  }
  return stops[stops.length - 1][1]
}

// ── Heatmap helpers ───────────────────────────────────────────────────────────
function buildHeatmapUrl(grid, minLeg, maxLeg, colorFn = rdYlBuR, alpha = 200) {
  const rows = grid.length; const cols = grid[0]?.length || 0
  if (!rows || !cols) return null
  const canvas = document.createElement('canvas')
  canvas.width = cols; canvas.height = rows
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(cols, rows)
  const span = (maxLeg - minLeg) || 1
  for (let r = 0; r < rows; r++) {
    const gr = rows - 1 - r   // grid row 0 = south, PNG row 0 = north
    for (let c = 0; c < cols; c++) {
      const v = grid[gr][c]
      if (v == null) continue  // null = NaN cell, leave transparent
      const t = Math.max(0, Math.min(1, (v - minLeg) / span))
      const [R, G, B] = colorFn(t)
      const i = (r * cols + c) * 4
      img.data[i] = R; img.data[i+1] = G; img.data[i+2] = B; img.data[i+3] = alpha
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

function setHeatmapLayer(map, id, url, bounds) {
  if (!url || !map) return
  const [w, s, e, n] = bounds
  const apply = () => {
    if (map.getLayer(id)) map.removeLayer(id)
    if (map.getSource(id)) map.removeSource(id)
    map.addSource(id, { type: 'image', url, coordinates: [[w, n], [e, n], [e, s], [w, s]] })
    map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.78 } })
  }
  if (map.isStyleLoaded()) apply(); else map.once('load', apply)
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SplitViewer() {
  const leftEl  = useRef(null)
  const rightEl = useRef(null)
  const mapL    = useRef(null)
  const mapR    = useRef(null)
  const drawRef = useRef(null)
  const syncing = useRef(false)
  const savedView = useRef({ pitch: 50, bearing: -15 })

  const baseline       = useStore((s) => s.baseline)
  const scenario       = useStore((s) => s.scenario)
  const paintedZones   = useStore((s) => s.paintedZones)
  const activeMaterial = useStore((s) => s.activeMaterial)
  const polygon        = useStore((s) => s.polygon)
  const setScenario    = useStore((s) => s.setScenario)
  const setLoading     = useStore((s) => s.setLoading)
  const setError       = useStore((s) => s.setError)
  const addZone        = useStore((s) => s.addPaintedZone)
  const setActiveMat   = useStore((s) => s.setActiveMaterial)
  const loading        = useStore((s) => s.loading)

  // Tree state
  const treeSpecies          = useStore((s) => s.treeSpecies)
  const treePlacements       = useStore((s) => s.treePlacements)
  const activeTreeSpecies    = useStore((s) => s.activeTreeSpecies)
  const treeMode             = useStore((s) => s.treeMode)
  const setTreeSpecies       = useStore((s) => s.setTreeSpecies)
  const setTreeMode          = useStore((s) => s.setTreeMode)
  const addTreePlacement     = useStore((s) => s.addTreePlacement)

  // Auto-sim state
  const viewerMode          = useStore((s) => s.viewerMode)
  const setViewerMode       = useStore((s) => s.setViewerMode)
  const autoSimResults      = useStore((s) => s.autoSimResults)
  const setAutoSimResults   = useStore((s) => s.setAutoSimResults)
  const autoSimViewerOpen   = useStore((s) => s.autoSimViewerOpen)
  const activeAutoSimTab    = useStore((s) => s.activeAutoSimTab)
  const setActiveAutoSimTab = useStore((s) => s.setActiveAutoSimTab)
  const closeAutoSimViewer  = useStore((s) => s.closeAutoSimViewer)
  const setTreePlacements   = useStore((s) => s.setTreePlacements)

  const [pickerPos, setPickerPos]           = useState(null)
  const [pendingFeature, setPendingFeature] = useState(null)
  const [showDelta, setShowDelta]           = useState(false)
  const [isDrawing, setIsDrawing]           = useState(false)

  const treeModeRef       = useRef(treeMode)
  const activeSpeciesRef  = useRef(activeTreeSpecies)
  const treeSpeciesMapRef = useRef({})

  const [w, s, e, n] = baseline?.bounds || [2.163, 41.393, 2.167, 41.397]
  const center = [(w + e) / 2, (s + n) / 2]

  // Keep refs in sync so the map click closure reads fresh values
  useEffect(() => { treeModeRef.current = treeMode }, [treeMode])
  useEffect(() => { activeSpeciesRef.current = activeTreeSpecies }, [activeTreeSpecies])
  useEffect(() => {
    treeSpeciesMapRef.current = Object.fromEntries(treeSpecies.map((t) => [t.id, t]))
  }, [treeSpecies])

  // ── Init maps ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapL.current || !leftEl.current || !rightEl.current) return

    const opts = { style: STYLE, center, zoom: 16, pitch: 50, bearing: -15, preserveDrawingBuffer: true }
    mapL.current = new maplibregl.Map({ container: leftEl.current,  ...opts })
    mapR.current = new maplibregl.Map({ container: rightEl.current, ...opts })

    mapL.current.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapR.current.addControl(new maplibregl.NavigationControl(), 'top-right')

    // Camera sync
    const sync = (src, tgt) => {
      if (syncing.current || !tgt) return
      syncing.current = true
      tgt.jumpTo({ center: src.getCenter(), zoom: src.getZoom(), bearing: src.getBearing(), pitch: src.getPitch() })
      requestAnimationFrame(() => { syncing.current = false })
    }
    mapL.current.on('move', () => sync(mapL.current, mapR.current))
    mapR.current.on('move', () => sync(mapR.current, mapL.current))

    // Draw control (polygon + trash, hidden until user presses Paint)
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      defaultMode: 'simple_select',
      styles: [
        { id: 'gl-draw-polygon-fill',   type: 'fill',
          filter: ['all', ['==', '$type', 'Polygon']],
          paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.25 } },
        { id: 'gl-draw-polygon-stroke', type: 'line',
          filter: ['all', ['==', '$type', 'Polygon']],
          paint: { 'line-color': '#2563eb', 'line-width': 2 } },
        { id: 'gl-draw-polygon-vertex', type: 'circle',
          filter: ['all', ['==', '$type', 'Point']],
          paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#2563eb', 'circle-stroke-width': 2 } },
      ],
    })
    mapL.current.addControl(draw, 'bottom-left')
    drawRef.current = draw

    mapL.current.on('draw.create', (e) => {
      const feat = e.features?.[0]
      if (!feat) return
      // Restore 3D view
      mapL.current.easeTo({ pitch: savedView.current.pitch, bearing: savedView.current.bearing, duration: 400 })
      setIsDrawing(false)
      // Position the picker at the center of the drawn polygon
      const coords = feat.geometry.coordinates[0]
      const cx = coords.reduce((a, c) => a + c[0], 0) / coords.length
      const cy = coords.reduce((a, c) => a + c[1], 0) / coords.length
      const px = mapL.current.project([cx, cy])
      setPendingFeature(feat)
      setPickerPos({ x: px.x, y: px.y })
    })

    mapL.current.on('draw.modechange', (e) => {
      if (e.mode === 'simple_select') setIsDrawing(false)
    })

    // Tree placement: click on left map to place a tree
    mapL.current.on('click', (e) => {
      if (!treeModeRef.current || !activeSpeciesRef.current) return
      const { lng, lat } = e.lngLat
      addTreePlacement({ id: `${Date.now()}`, species_id: activeSpeciesRef.current, lon: lng, lat })
    })

    return () => { mapL.current?.remove(); mapR.current?.remove() }
  }, [])

  // ── Load tree species from backend ────────────────────────────────────────
  useEffect(() => {
    fetchTreeSpecies().then(setTreeSpecies).catch(console.error)
  }, [])

  // ── Fetch existing OSM trees via Overpass, render as 3D spheres ───────────
  useEffect(() => {
    if (!baseline?.bounds || !mapL.current || !mapR.current) return
    const [w, sb, e, nb] = baseline.bounds

    const overpassQuery = `[out:json][timeout:25];node[natural=tree](${sb},${w},${nb},${e});out;`
    fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: new URLSearchParams({ data: overpassQuery }),
    })
      .then((r) => r.json())
      .then((data) => {
        const nodes = data.elements ?? []

        function circleCoords(lon, lat, radiusM, n = 20) {
          const mLat = 111320.0
          const mLon = 111320.0 * Math.cos(lat * Math.PI / 180)
          const pts = Array.from({ length: n }, (_, i) => {
            const a = (2 * Math.PI * i) / n
            return [lon + (radiusM / mLon) * Math.cos(a), lat + (radiusM / mLat) * Math.sin(a)]
          })
          pts.push(pts[0])
          return pts
        }

        function sphereRings(lon, lat, trunkH, sphereR, n = 10) {
          const centerZ = trunkH + sphereR
          const rings = []
          for (let i = 0; i < n; i++) {
            const zBase = centerZ - sphereR + (2 * sphereR * i / n)
            const zTop  = centerZ - sphereR + (2 * sphereR * (i + 1) / n)
            const t     = ((zBase + zTop) / 2) - centerZ
            const ringR = Math.sqrt(Math.max(0, sphereR * sphereR - t * t))
            if (ringR < 0.1) continue
            rings.push({
              type: 'Feature',
              geometry: { type: 'Polygon', coordinates: [circleCoords(lon, lat, ringR)] },
              properties: { z_base: Math.max(0, zBase), z_top: Math.max(0.01, zTop) },
            })
          }
          return rings
        }

        const TRUNK_R   = 3.5   // default canopy sphere radius (m)
        const TRUNK_H   = 3.5   // default trunk height (m)

        const sphereFeatures = []
        const trunkFeatures  = []

        nodes.forEach((node) => {
          const rawH = parseFloat(node.tags?.height ?? node.tags?.['canopy_height'] ?? NaN)
          const rawC = parseFloat(node.tags?.canopy_circumference ?? NaN)
          let trunkH = TRUNK_H
          let sphereR = TRUNK_R
          if (!isNaN(rawH))       { sphereR = Math.max(1, rawH * 0.28); trunkH = Math.max(sphereR, rawH * 0.55) }
          else if (!isNaN(rawC))  { sphereR = Math.max(1, rawC / (2 * Math.PI)); trunkH = sphereR }

          sphereFeatures.push(...sphereRings(node.lon, node.lat, trunkH, sphereR))
          trunkFeatures.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [circleCoords(node.lon, node.lat, 0.25)] },
            properties: { z_top: trunkH },
          })
        })

        const sphereData = { type: 'FeatureCollection', features: sphereFeatures }
        const trunkData  = { type: 'FeatureCollection', features: trunkFeatures }

        const addTo = (map) => {
          const apply = () => {
            ;['osm-trees-canopy', 'osm-trees-trunk'].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id) })
            ;['osm-trees-canopy-src', 'osm-trees-trunk-src'].forEach((id) => { if (map.getSource(id)) map.removeSource(id) })
            map.addSource('osm-trees-canopy-src', { type: 'geojson', data: sphereData })
            map.addSource('osm-trees-trunk-src',  { type: 'geojson', data: trunkData })
            map.addLayer({
              id: 'osm-trees-trunk', type: 'fill-extrusion', source: 'osm-trees-trunk-src',
              paint: { 'fill-extrusion-color': '#713f12', 'fill-extrusion-height': ['get', 'z_top'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.9 },
            })
            map.addLayer({
              id: 'osm-trees-canopy', type: 'fill-extrusion', source: 'osm-trees-canopy-src',
              paint: { 'fill-extrusion-color': '#15803d', 'fill-extrusion-height': ['get', 'z_top'], 'fill-extrusion-base': ['get', 'z_base'], 'fill-extrusion-opacity': 0.72 },
            })
          }
          if (map.isStyleLoaded()) apply(); else map.once('load', apply)
        }

        addTo(mapL.current)
        addTo(mapR.current)
      })
      .catch((err) => console.warn('OSM tree fetch failed:', err))
  }, [baseline])

  // ── SDK buildings on both maps ─────────────────────────────────────────────
  useEffect(() => {
    if (!baseline?.buildings_geojson || !mapL.current || !mapR.current) return
    const geojson = baseline.buildings_geojson

    const addBuildings = (map) => {
      const apply = () => {
        ;['sdk-buildings', 'sdk-buildings-stroke'].forEach(id => {
          if (map.getLayer(id)) map.removeLayer(id)
        })
        if (map.getSource('sdk-buildings')) map.removeSource('sdk-buildings')

        map.addSource('sdk-buildings', { type: 'geojson', data: geojson })
        map.addLayer({
          id: 'sdk-buildings',
          type: 'fill-extrusion',
          source: 'sdk-buildings',
          paint: {
            'fill-extrusion-color': '#94a3b8',
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base':   ['get', 'base_height'],
            'fill-extrusion-opacity': 0.85,
          },
        })
      }
      if (map.isStyleLoaded()) apply(); else map.once('load', apply)
    }

    addBuildings(mapL.current)
    addBuildings(mapR.current)
  }, [baseline])

  // ── Ground material zones on left map ─────────────────────────────────────
  useEffect(() => {
    if (!mapL.current || !baseline?.ground_materials) return
    Object.entries(baseline.ground_materials).forEach(([key, fc]) => {
      const color = MAT_COLORS[key] || '#aaa'
      const lid   = `gm-${key}`
      const apply = () => {
        ;[lid, lid + '-s'].forEach(id => { if (mapL.current.getLayer(id)) mapL.current.removeLayer(id) })
        if (mapL.current.getSource(lid)) mapL.current.removeSource(lid)
        mapL.current.addSource(lid, { type: 'geojson', data: fc })
        mapL.current.addLayer({ id: lid,       type: 'fill', source: lid, paint: { 'fill-color': color, 'fill-opacity': 0.5 } })
        mapL.current.addLayer({ id: lid + '-s', type: 'line', source: lid, paint: { 'line-color': color, 'line-width': 1 } })
      }
      if (mapL.current.isStyleLoaded()) apply(); else mapL.current.once('load', apply)
    })
  }, [baseline])

  // ── Painted zones layer ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapL.current) return
    const data = {
      type: 'FeatureCollection',
      features: paintedZones.map((z) => ({
        ...z.polygon,
        properties: { material: z.material, color: MAT_COLORS[z.material] || '#888' },
      })),
    }
    const apply = () => {
      ;['zones', 'zones-stroke'].forEach(id => { if (mapL.current.getLayer(id)) mapL.current.removeLayer(id) })
      if (mapL.current.getSource('zones')) mapL.current.removeSource('zones')
      mapL.current.addSource('zones', { type: 'geojson', data })
      mapL.current.addLayer({ id: 'zones',        type: 'fill', source: 'zones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.6 } })
      mapL.current.addLayer({ id: 'zones-stroke', type: 'line', source: 'zones', paint: { 'line-color': ['get', 'color'], 'line-width': 2 } })
    }
    if (mapL.current.isStyleLoaded()) apply(); else mapL.current.once('load', apply)
  }, [paintedZones])

  // ── 3D tree: sphere canopy + trunk on left map ────────────────────────────
  useEffect(() => {
    if (!mapL.current) return
    const speciesMap = treeSpeciesMapRef.current

    function circleCoords(lon, lat, radiusM, n = 20) {
      const mLat = 111320.0
      const mLon = 111320.0 * Math.cos(lat * Math.PI / 180)
      const rLat = radiusM / mLat
      const rLon = radiusM / mLon
      const pts = Array.from({ length: n }, (_, i) => {
        const a = (2 * Math.PI * i) / n
        return [lon + rLon * Math.cos(a), lat + rLat * Math.sin(a)]
      })
      pts.push(pts[0])
      return pts
    }

    // Approximate sphere with N horizontal ring slices of varying radius
    function sphereRings(lon, lat, trunkH, sphereR, n = 10) {
      const centerZ = trunkH + sphereR
      const rings = []
      for (let i = 0; i < n; i++) {
        const zBase = centerZ - sphereR + (2 * sphereR * i / n)
        const zTop  = centerZ - sphereR + (2 * sphereR * (i + 1) / n)
        const t     = ((zBase + zTop) / 2) - centerZ   // distance from centre
        const ringR = Math.sqrt(Math.max(0, sphereR * sphereR - t * t))
        if (ringR < 0.1) continue
        rings.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [circleCoords(lon, lat, ringR)] },
          properties: { z_base: Math.max(0, zBase), z_top: Math.max(0.01, zTop) },
        })
      }
      return rings
    }

    const sphereFeatures = []
    const trunkFeatures  = []

    // Visual radius is capped so planted trees match the scale of existing OSM trees.
    // The actual canopy_radius_m is still sent to the backend for accurate shade simulation.
    const VISUAL_CAP = 4.5

    treePlacements.forEach((placement) => {
      const sp = speciesMap[placement.species_id]
      if (!sp) return
      const vR  = Math.min(sp.canopy_radius_m, VISUAL_CAP)
      const vH  = Math.min(sp.trunk_height_m,  VISUAL_CAP)
      const src = placement.source ?? 'manual'
      // Store source on each ring so MapLibre can colour them differently
      sphereRings(placement.lon, placement.lat, vH, vR).forEach((ring) => {
        ring.properties.source = src
        sphereFeatures.push(ring)
      })
      trunkFeatures.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [circleCoords(placement.lon, placement.lat, 0.35)] },
        properties: { z_top: vH, source: src },
      })
    })

    const sphereData = { type: 'FeatureCollection', features: sphereFeatures }
    const trunkData  = { type: 'FeatureCollection', features: trunkFeatures }

    // auto-placed → lime green; manual → dark green
    const canopyColorExpr = ['match', ['get', 'source'], 'auto', '#84cc16', '#166534']
    const trunkColorExpr  = ['match', ['get', 'source'], 'auto', '#4d7c0f', '#5c3d1e']

    const apply = () => {
      ;['trees-canopy', 'trees-trunk'].forEach((id) => { if (mapL.current.getLayer(id)) mapL.current.removeLayer(id) })
      ;['trees-canopy-src', 'trees-trunk-src'].forEach((id) => { if (mapL.current.getSource(id)) mapL.current.removeSource(id) })

      mapL.current.addSource('trees-canopy-src', { type: 'geojson', data: sphereData })
      mapL.current.addSource('trees-trunk-src',  { type: 'geojson', data: trunkData })

      mapL.current.addLayer({
        id: 'trees-trunk', type: 'fill-extrusion', source: 'trees-trunk-src',
        paint: {
          'fill-extrusion-color':   trunkColorExpr,
          'fill-extrusion-height':  ['get', 'z_top'],
          'fill-extrusion-base':    0,
          'fill-extrusion-opacity': 0.95,
        },
      })
      mapL.current.addLayer({
        id: 'trees-canopy', type: 'fill-extrusion', source: 'trees-canopy-src',
        paint: {
          'fill-extrusion-color':   canopyColorExpr,
          'fill-extrusion-height':  ['get', 'z_top'],
          'fill-extrusion-base':    ['get', 'z_base'],
          'fill-extrusion-opacity': 0.88,
        },
      })
    }
    if (mapL.current.isStyleLoaded()) apply(); else mapL.current.once('load', apply)
  }, [treePlacements, treeSpecies])

  // ── UTCI heatmap on right map ──────────────────────────────────────────────
  useEffect(() => {
    if (!mapR.current || !baseline) return
    let grid = baseline.grid, minLeg = baseline.min_legend, maxLeg = baseline.max_legend
    let colorFn = rdYlBuR, alpha = 200
    let bounds  = baseline.bounds

    if (showDelta && scenario) {
      const bg = baseline.grid, sg = scenario.grid
      const flat = []
      const dg = bg.map((row, r) => row.map((v, c) => {
        if (v == null) return null
        const sv = sg[r]?.[c]
        if (sv == null) return null
        const d = sv - v; flat.push(d); return d
      }))
      const absMax = flat.length ? Math.max(Math.abs(Math.min(...flat)), Math.abs(Math.max(...flat)), 0.1) : 1
      grid = dg; minLeg = -absMax; maxLeg = absMax; colorFn = rdBu; alpha = 210
      bounds = scenario.bounds
    } else if (scenario) {
      grid = scenario.grid; minLeg = scenario.min_legend; maxLeg = scenario.max_legend; bounds = scenario.bounds
    }

    const url = buildHeatmapUrl(grid, minLeg, maxLeg, colorFn, alpha)
    setHeatmapLayer(mapR.current, 'utci', url, bounds)
  }, [baseline, scenario, showDelta])

  // ── Hotspot overlay on right map ───────────────────────────────────────────
  useEffect(() => {
    if (!mapR.current || !baseline?.grid) return

    const hs = computeHotspotStats(baseline.grid, scenario?.grid ?? null)
    if (!hs) return

    const [w, s, e, n] = baseline.bounds
    const coords = [[w, n], [e, n], [e, s], [w, s]]

    // Choose overlay: improvement (green gradient) when scenario active, else hotspot highlight (red)
    const url = scenario
      ? buildImprovementOverlayUrl(hs.cells, baseline.grid, scenario.grid, hs.rows, hs.cols)
      : buildHotspotOverlayUrl(hs.cells, hs.rows, hs.cols)

    if (!url) return

    const apply = () => {
      ;['hotspot-overlay'].forEach((id) => { if (mapR.current.getLayer(id)) mapR.current.removeLayer(id) })
      ;['hotspot-overlay-src'].forEach((id) => { if (mapR.current.getSource(id)) mapR.current.removeSource(id) })
      mapR.current.addSource('hotspot-overlay-src', { type: 'image', url, coordinates: coords })
      mapR.current.addLayer({
        id: 'hotspot-overlay', type: 'raster', source: 'hotspot-overlay-src',
        paint: { 'raster-opacity': scenario ? 0.75 : 0.55 },
      })
    }
    if (mapR.current.isStyleLoaded()) apply(); else mapR.current.once('load', apply)
  }, [baseline, scenario])

  // ── Auto-sim viewer: switch tab content ───────────────────────────────────
  useEffect(() => {
    if (!autoSimViewerOpen || !autoSimResults) return
    const scenarios = autoSimResults.scenarios

    if (activeAutoSimTab === 'baseline') {
      setTreePlacements([])
      setScenario(null)
      return
    }

    const sc = scenarios?.[activeAutoSimTab]
    if (!sc || sc.error) {
      setTreePlacements([])
      setScenario(null)
      return
    }

    const tps = (sc.meta?.tree_placements ?? []).map((tp, i) => ({
      id: `auto_${i}`, source: 'auto',
      species_id: tp.species_id, lon: tp.lon, lat: tp.lat,
    }))
    setTreePlacements(tps)
    setScenario(sc)
  }, [autoSimViewerOpen, activeAutoSimTab, autoSimResults])

  // ── PDF download with map screenshots ─────────────────────────────────────
  async function downloadAutoSimPDF() {
    const { jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')

    const ARCHETYPE_LABELS = {
      most_impactful:      'Most Impactful',
      most_cost_effective: 'Most Cost-Effective',
      most_balanced:       'Most Balanced',
    }
    const tabKeys = ['most_impactful', 'most_cost_effective', 'most_balanced']
    const scenarios = autoSimResults?.scenarios ?? {}
    const baselineUtci = autoSimResults?.baseline_utci ?? 0
    const comfortThreshold = autoSimResults?.comfort_threshold ?? 26

    // Capture each scenario's maps
    const images = {}
    for (const key of tabKeys) {
      if (!scenarios[key] || scenarios[key].error) continue
      setActiveAutoSimTab(key)
      await new Promise((resolve) => {
        const waitBoth = () => {
          let done = 0
          const check = () => { if (++done === 2) setTimeout(resolve, 400) }
          if (mapL.current) mapL.current.once('idle', check); else check()
          if (mapR.current) mapR.current.once('idle', check); else check()
        }
        setTimeout(waitBoth, 200)
      })
      images[key] = {
        axo:  mapL.current?.getCanvas().toDataURL('image/jpeg', 0.82) ?? null,
        utci: mapR.current?.getCanvas().toDataURL('image/jpeg', 0.82) ?? null,
      }
    }

    // Build PDF
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const W = doc.internal.pageSize.getWidth()
    const M = 15

    const addPage = (first) => { if (!first) doc.addPage() }

    let firstPage = true
    for (const key of tabKeys) {
      if (!scenarios[key] || scenarios[key].error) continue
      addPage(firstPage); firstPage = false
      let y = M

      // Title
      doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59)
      doc.text(ARCHETYPE_LABELS[key], M, y); y += 6
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139)
      doc.text(`Baseline: ${baselineUtci} °C mean UTCI  ·  Comfort target: < ${comfortThreshold} °C`, M, y); y += 5
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 4

      // Map images (axo top-left, utci top-right)
      const imgW = (W - M * 2 - 4) / 2
      const imgH = imgW * 0.65
      if (images[key]?.axo)  doc.addImage(images[key].axo,  'JPEG', M,          y, imgW, imgH)
      if (images[key]?.utci) doc.addImage(images[key].utci, 'JPEG', M + imgW + 4, y, imgW, imgH)
      doc.setFontSize(7); doc.setTextColor(100, 116, 139)
      doc.text('3D Axonometric View',       M + imgW / 2,          y + imgH + 3, { align: 'center' })
      doc.text('UTCI Thermal Comfort Map',  M + imgW + 4 + imgW / 2, y + imgH + 3, { align: 'center' })
      y += imgH + 8

      // Stats table
      const sc    = scenarios[key]
      const stats = sc.stats ?? {}
      const meta  = sc.meta ?? {}
      const rows  = [
        ['Simulated mean UTCI', `${stats.mean_utci?.toFixed(1) ?? '—'} °C`],
        ['Reduction vs baseline', `${meta.actual_delta_c ?? '—'} °C`],
        ['Reaches comfort (< 26 °C)', meta.reaches_comfort ? 'Yes' : `No — ${(stats.mean_utci - comfortThreshold).toFixed(1)} °C above target`],
        ['Trees planted', `${stats.trees_count ?? 0}`],
        ['Surface zones changed', `${meta.mat_zones ?? 0}`],
        ['Total cost', `€ ${(stats.cost_eur ?? 0).toLocaleString()}`],
        ['  Surface works', `€ ${(stats.zones_cost_eur ?? 0).toLocaleString()}`],
        ['  Tree planting', `€ ${(stats.trees_cost_eur ?? 0).toLocaleString()}`],
      ]
      autoTable(doc, {
        startY: y, head: [], body: rows, theme: 'striped',
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 80 }, 1: { halign: 'right' } },
        margin: { left: M, right: M },
      })
    }

    // Footer
    const lastY = doc.internal.pageSize.getHeight() - 8
    doc.setFontSize(6); doc.setTextColor(148, 163, 184)
    doc.text(
      'Generated by Urban Heat Tool · UTCI simulations via Infrared SDK · Trees planted in hottest zones first',
      M, lastY
    )

    doc.save('urban-heat-auto-sim-report.pdf')
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  function startPainting() {
    if (!mapL.current || !drawRef.current) return
    savedView.current = { pitch: mapL.current.getPitch(), bearing: mapL.current.getBearing() }
    setIsDrawing(true)
    // Flatten to 2D so polygon clicks register accurately
    mapL.current.easeTo({ pitch: 0, bearing: 0, duration: 350 }, () => {
      drawRef.current.changeMode('draw_polygon')
    })
    // Fallback: enter draw mode after animation
    setTimeout(() => drawRef.current.changeMode('draw_polygon'), 400)
  }

  function cancelDraw() {
    drawRef.current?.changeMode('simple_select')
    drawRef.current?.deleteAll()
    mapL.current?.easeTo({ pitch: savedView.current.pitch, bearing: savedView.current.bearing, duration: 400 })
    setIsDrawing(false)
    setPickerPos(null)
    setPendingFeature(null)
  }

  function confirmMaterial(mat) {
    if (!pendingFeature) return
    addZone({ id: pendingFeature.id, material: mat, polygon: pendingFeature })
    drawRef.current?.deleteAll()
    setPickerPos(null)
    setPendingFeature(null)
  }

  async function runScenario() {
    if (!paintedZones.length && !treePlacements.length) return
    setLoading(true); setError(null)
    setTreeMode(false)
    try {
      const data = await fetchScenario(
        polygon, paintedZones, baseline.ground_materials, baseline.buildings, treePlacements,
      )
      setScenario(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Map screenshot capture (used by AutoSimPanel PDF export) ──────────────
  function captureMaps() {
    return new Promise((resolve) => {
      let done = 0
      const tryCapture = () => {
        done++
        if (done < 2) return
        // Both maps idle — give an extra frame for WebGL to flush
        setTimeout(() => {
          resolve({
            axo:  mapL.current?.getCanvas().toDataURL('image/jpeg', 0.88) ?? null,
            utci: mapR.current?.getCanvas().toDataURL('image/jpeg', 0.88) ?? null,
          })
        }, 250)
      }
      if (mapL.current) mapL.current.once('idle', tryCapture); else tryCapture()
      if (mapR.current) mapR.current.once('idle', tryCapture); else tryCapture()
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const AUTO_TABS = [
    { key: 'baseline',           label: 'Baseline' },
    { key: 'most_impactful',     label: 'Most Impactful' },
    { key: 'most_cost_effective', label: 'Most Cost-Effective' },
    { key: 'most_balanced',      label: 'Most Balanced' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh' }}>

      {/* ── Auto-sim scenario tab bar ── */}
      {autoSimViewerOpen && autoSimResults && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: '#0f172a', borderBottom: '2px solid #1e40af',
          padding: '6px 12px', flexShrink: 0, zIndex: 50,
        }}>
          <button onClick={closeAutoSimViewer} style={tabActionBtn}>
            ← Back
          </button>
          <div style={{ width: 1, background: '#334155', height: 20, margin: '0 4px' }} />
          {AUTO_TABS.map(({ key, label }) => {
            const sc = autoSimResults.scenarios?.[key]
            const failed    = sc?.error
            const isActive  = activeAutoSimTab === key
            // Use hotspot delta in tab label if available, else mean delta
            const hs        = (!failed && sc && baseline) ? computeHotspotStats(baseline.grid, sc.grid ?? null) : null
            const displayDelta = hs?.delta ?? sc?.meta?.actual_delta_c ?? null
            const isHotspot    = hs?.delta != null
            return (
              <button key={key} onClick={() => setActiveAutoSimTab(key)} style={{
                padding: '5px 14px', borderRadius: 6, border: 'none',
                background: isActive ? '#1e40af' : 'transparent',
                color: isActive ? '#fff' : (failed ? '#ef4444' : 'rgba(255,255,255,0.65)'),
                fontSize: 12, fontWeight: isActive ? 700 : 400,
                cursor: 'pointer', transition: 'all 0.15s',
              }}>
                {label}
                {displayDelta != null && !failed && (
                  <span style={{ marginLeft: 5, fontSize: 10, color: isHotspot ? '#86efac' : 'rgba(255,255,255,0.6)' }}>
                    (−{Math.abs(displayDelta).toFixed(1)}°C{isHotspot ? ' HS' : ''})
                  </span>
                )}
                {failed && <span style={{ marginLeft: 4, fontSize: 10 }}>✕</span>}
              </button>
            )
          })}
          <div style={{ flex: 1 }} />
          {/* Scenario stats strip — hotspot-focused */}
          {activeAutoSimTab !== 'baseline' && autoSimResults.scenarios?.[activeAutoSimTab]?.stats && (() => {
            const sc    = autoSimResults.scenarios[activeAutoSimTab]
            const stats = sc.stats
            const hs    = baseline ? computeHotspotStats(baseline.grid, sc.grid ?? null) : null
            return (
              <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'rgba(255,255,255,0.7)', alignItems: 'center' }}>
                {hs?.delta != null && (
                  <span style={{ background: '#166534', color: '#bbf7d0', padding: '2px 10px', borderRadius: 99, fontWeight: 800, fontSize: 12 }}>
                    Hotspot zones: −{hs.delta}°C
                  </span>
                )}
                <span>Overall: <b style={{ color: '#fff' }}>{stats.mean_utci?.toFixed(1)}°C</b></span>
                <span>Trees: <b style={{ color: '#84cc16' }}>{stats.trees_count ?? 0}</b></span>
                <span>Cost: <b style={{ color: '#fff' }}>€{(stats.cost_eur ?? 0).toLocaleString()}</b></span>
              </div>
            )
          })()}
          <div style={{ width: 1, background: '#334155', height: 20, margin: '0 4px' }} />
          <button onClick={downloadAutoSimPDF} style={{ ...tabActionBtn, background: '#1e40af' }}>
            Download PDF
          </button>
        </div>
      )}

      {/* ── Main split view ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

      {/* ── Left map: Surface Materials ── */}
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        <div ref={leftEl} style={{ width: '100%', height: '100%', cursor: treeMode ? 'crosshair' : 'default' }} />

        {/* Mode toggle */}
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', zIndex: 20,
          background: 'rgba(15,23,42,0.88)', borderRadius: 20,
          padding: 3, gap: 2,
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}>
          {['manual', 'auto'].map((mode) => (
            <button key={mode} onClick={() => setViewerMode(mode)} style={{
              padding: '5px 16px', borderRadius: 16, border: 'none',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              background: viewerMode === mode ? '#2563eb' : 'transparent',
              color: viewerMode === mode ? '#fff' : 'rgba(255,255,255,0.55)',
              transition: 'all 0.15s',
            }}>
              {mode === 'manual' ? 'Manual' : 'Auto-Simulate'}
            </button>
          ))}
        </div>

        {viewerMode === 'manual' && (
          <>
            {/* Material palette */}
            <div style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              display: 'flex', flexDirection: 'column', gap: 6, zIndex: 10,
            }}>
              {MATERIALS.map((m) => (
                <button key={m} onClick={() => setActiveMat(m)} title={MAT_LABELS[m]}
                  style={{
                    width: 36, height: 36, borderRadius: 6,
                    border: activeMaterial === m ? '2px solid #fff' : '2px solid transparent',
                    background: MAT_COLORS[m], cursor: 'pointer',
                    boxShadow: activeMaterial === m ? '0 0 0 2px #2563eb' : '0 1px 4px rgba(0,0,0,0.35)',
                  }}
                />
              ))}
              <div style={{
                fontSize: 10, color: '#fff', textAlign: 'center', marginTop: 2,
                background: 'rgba(0,0,0,0.55)', borderRadius: 4, padding: '2px 4px',
              }}>
                {MAT_LABELS[activeMaterial]}
              </div>
            </div>

            {/* Tree Panel */}
            <div style={{
              position: 'absolute', bottom: (paintedZones.length > 0 || treePlacements.length > 0) ? 64 : 18,
              left: 56, zIndex: 20, maxWidth: 240,
              background: 'rgba(15,23,42,0.92)', borderRadius: 10,
              padding: '10px 12px', boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}>
              <TreePanel />
            </div>

            {/* Paint / Cancel button */}
            <div style={{
              position: 'absolute', bottom: (paintedZones.length > 0 || treePlacements.length > 0) ? 64 : 18,
              left: '50%', transform: 'translateX(-50%)',
              display: 'flex', gap: 8, zIndex: 10,
            }}>
              {!isDrawing ? (
                <button onClick={startPainting} style={actionBtn('#2563eb')}>
                  ✏ Paint area
                </button>
              ) : (
                <>
                  <div style={{
                    background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: 8,
                    padding: '8px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    Click to add points · Double-click to finish
                  </div>
                  <button onClick={cancelDraw} style={actionBtn('#dc2626')}>Cancel</button>
                </>
              )}
            </div>

            {/* Run scenario */}
            {(paintedZones.length > 0 || treePlacements.length > 0) && (
              <button onClick={runScenario} disabled={loading} style={{
                ...actionBtn(loading ? '#94a3b8' : '#16a34a'),
                position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)',
                zIndex: 10, padding: '10px 22px', fontSize: 14, fontWeight: 700,
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}>
                {loading ? 'Running...' : (() => {
                  const parts = []
                  if (paintedZones.length) parts.push(`${paintedZones.length} zone${paintedZones.length > 1 ? 's' : ''}`)
                  if (treePlacements.length) parts.push(`${treePlacements.length} tree${treePlacements.length > 1 ? 's' : ''}`)
                  return `Run scenario  (${parts.join(', ')})`
                })()}
              </button>
            )}
          </>
        )}

        {viewerMode === 'auto' && (
          <div style={{
            position: 'absolute', top: 52, left: '50%', transform: 'translateX(-50%)',
            width: 280, zIndex: 20,
            background: 'rgba(255,255,255,0.97)', borderRadius: 12,
            boxShadow: '0 4px 24px rgba(0,0,0,0.22)',
            border: '1px solid #e2e8f0',
          }}>
            <AutoSimPanel onCaptureMaps={captureMaps} />
          </div>
        )}

        {/* Tree colour legend — visible when auto-placed trees are on the map */}
        {treePlacements.some((t) => t.source === 'auto') && (
          <div style={{
            position: 'absolute', bottom: 24, right: 12, zIndex: 10,
            background: 'rgba(255,255,255,0.93)', borderRadius: 8,
            padding: '8px 12px', fontSize: 11,
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          }}>
            <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: 5 }}>Trees</div>
            {[['#84cc16', 'Simulated (new)'], ['#15803d', 'Existing (OSM)']].map(([c, l]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: c }} />
                <span style={{ color: '#475569' }}>{l}</span>
              </div>
            ))}
          </div>
        )}

        {/* Material picker popup */}
        {pickerPos && (
          <div style={{
            position: 'absolute',
            left: Math.min(pickerPos.x + 10, window.innerWidth / 2 - 180),
            top:  Math.max(pickerPos.y - 60, 10),
            background: '#fff', borderRadius: 10, padding: '12px 14px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)', zIndex: 30,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
              Assign material to painted area
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {MATERIALS.map((m) => (
                <button key={m} onClick={() => confirmMaterial(m)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: activeMaterial === m ? '#eff6ff' : '#f8fafc',
                    border: activeMaterial === m ? '1.5px solid #2563eb' : '1px solid #e2e8f0',
                    borderRadius: 6, padding: '7px 10px', cursor: 'pointer', fontSize: 12,
                    borderLeft: `4px solid ${MAT_COLORS[m]}`,
                  }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: MAT_COLORS[m] }} />
                  {MAT_LABELS[m]}
                </button>
              ))}
            </div>
            <button onClick={cancelDraw}
              style={{ marginTop: 8, width: '100%', background: 'none', border: 'none',
                color: '#94a3b8', cursor: 'pointer', fontSize: 11, padding: '4px 0' }}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ width: 3, background: '#1e293b', zIndex: 10, flexShrink: 0 }} />

      {/* ── Right map: Microclimate ── */}
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        <div ref={rightEl} style={{ width: '100%', height: '100%' }} />

        <div style={labelStyle}>UTCI Thermal Comfort</div>

        {scenario && (
          <button onClick={() => setShowDelta(!showDelta)} style={{
            position: 'absolute', top: 48, right: 12, zIndex: 10,
            background: showDelta ? '#7c3aed' : 'rgba(255,255,255,0.92)',
            color: showDelta ? '#fff' : '#1e293b',
            border: '1.5px solid #ddd', borderRadius: 6,
            padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            {showDelta ? 'Show scenario' : 'Show delta'}
          </button>
        )}

        {/* UTCI Legend */}
        <div style={{
          position: 'absolute', bottom: 24, right: 12, zIndex: 10,
          background: 'rgba(255,255,255,0.93)', borderRadius: 8,
          padding: '8px 12px', fontSize: 11, minWidth: 130,
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        }}>
          {showDelta && scenario ? (
            <>
              <div style={{ fontWeight: 700, marginBottom: 6, color: '#1e293b' }}>Delta UTCI (°C)</div>
              {[['Cooler', '#2166ac'], ['No change', '#f7f7f7'], ['Hotter', '#b2182b']].map(([l, c]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <div style={{ width: 16, height: 10, background: c, borderRadius: 2, border: '1px solid #ddd' }} />
                  <span>{l}</span>
                </div>
              ))}
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, marginBottom: 6, color: '#1e293b' }}>UTCI (°C)</div>
              {[['Cool (&lt;9)', '#3135957f'], ['Moderate', '#ffffa0'], ['Hot (26–32)', '#ef6c00'], ['Extreme (&gt;38)', '#a50026']].map(([l, c]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <div style={{ width: 16, height: 10, background: c, borderRadius: 2 }} />
                  <span dangerouslySetInnerHTML={{ __html: l }} />
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Sidebar */}
      <Sidebar />

      {loading && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: 100, color: '#fff',
        }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Running scenario simulation...</div>
          <div style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>~30–60 seconds</div>
        </div>
      )}

      </div>{/* end main split view */}
    </div>
  )
}

const tabActionBtn = {
  background: 'rgba(255,255,255,0.08)',
  color: '#fff', border: 'none',
  padding: '5px 12px', borderRadius: 6,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
}

const labelStyle = {
  position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
  background: 'rgba(15,23,42,0.85)', color: '#fff',
  borderRadius: 8, padding: '5px 14px', fontSize: 13, fontWeight: 600,
  zIndex: 10, letterSpacing: '0.02em', pointerEvents: 'none',
}

function actionBtn(bg) {
  return {
    background: bg, color: '#fff', border: 'none',
    borderRadius: 8, padding: '8px 18px',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
  }
}
