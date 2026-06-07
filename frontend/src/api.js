const BASE = import.meta.env.VITE_API_URL ?? ''  // set VITE_API_URL in production; empty = vite proxy in dev

export async function fetchTreeSpecies() {
  const res = await fetch(`${BASE}/api/trees`)
  if (!res.ok) throw new Error(`Failed to load tree species: ${res.status}`)
  return res.json()
}

export async function fetchBaseline(polygon) {
  const res = await fetch(`${BASE}/api/baseline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ polygon }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error('Baseline error response:', res.status, text)
    let detail = `HTTP ${res.status}`
    try { detail = JSON.parse(text).detail ?? text ?? detail } catch (_) { detail = text || detail }
    throw new Error(detail)
  }
  return res.json()
}

export async function fetchScenario(polygon, paintedZones, baselineGroundMaterials, buildings, treePlacements = []) {
  const res = await fetch(`${BASE}/api/scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      polygon,
      painted_zones: paintedZones.map((z) => ({
        material: z.material,
        polygon: z.polygon,
      })),
      baseline_ground_materials: baselineGroundMaterials,
      buildings,
      tree_placements: treePlacements.map((t) => ({
        species_id: t.species_id,
        lon: t.lon,
        lat: t.lat,
      })),
    }),
  })
  if (!res.ok) throw new Error(`Scenario failed: ${res.status}`)
  return res.json()
}

export async function fetchBestScenario(polygon, baselineGroundMaterials, buildings, baselineMeanUtci, utciGrid = null, utciBounds = null) {
  const res = await fetch(`${BASE}/api/best-scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      polygon,
      baseline_ground_materials: baselineGroundMaterials,
      buildings,
      baseline_mean_utci: baselineMeanUtci,
      utci_grid:   utciGrid,
      utci_bounds: utciBounds,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    let detail = `HTTP ${res.status}`
    try { detail = JSON.parse(text).detail ?? text ?? detail } catch (_) { detail = text || detail }
    throw new Error(detail)
  }
  return res.json()
}

export async function fetchAutoSimulate(polygon, baselineGroundMaterials, buildings, baselineMeanUtci, utciGrid = null, utciBounds = null) {
  const res = await fetch(`${BASE}/api/auto-simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      polygon,
      baseline_ground_materials: baselineGroundMaterials,
      buildings,
      baseline_mean_utci: baselineMeanUtci,
      utci_grid:   utciGrid,
      utci_bounds: utciBounds,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    let detail = `HTTP ${res.status}`
    try { detail = JSON.parse(text).detail ?? text ?? detail } catch (_) { detail = text || detail }
    throw new Error(detail)
  }
  return res.json()
}
