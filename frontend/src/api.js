const BASE = ''  // proxied via vite to localhost:8000

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

export async function fetchScenario(polygon, paintedZones, baselineGroundMaterials, buildings) {
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
    }),
  })
  if (!res.ok) throw new Error(`Scenario failed: ${res.status}`)
  return res.json()
}
