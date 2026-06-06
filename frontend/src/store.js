import { create } from 'zustand'

export const useStore = create((set, get) => ({
  phase: 'picker',       // 'picker' | 'viewer'
  polygon: null,         // GeoJSON Polygon

  baseline: null,        // full API response from /api/baseline
  scenario: null,        // full API response from /api/scenario

  paintedZones: [],      // [{id, material, polygon (GeoJSON Feature)}]
  activeMaterial: 'vegetation',

  // Tree placement state
  treeSpecies: [],            // loaded from GET /api/trees
  treePlacements: [],         // [{id, species_id, lon, lat}]
  activeTreeSpecies: null,    // species_id string or null
  treeMode: false,            // whether click-to-place is active

  loading: false,
  error: null,

  // Actions
  setPolygon: (p) => set({ polygon: p }),
  setBaseline: (b) => set({ baseline: b, phase: 'viewer', scenario: null }),
  setScenario: (s) => set({ scenario: s }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),
  setActiveMaterial: (m) => set({ activeMaterial: m }),

  addPaintedZone: (zone) =>
    set((s) => ({ paintedZones: [...s.paintedZones, zone] })),
  removePaintedZone: (id) =>
    set((s) => ({ paintedZones: s.paintedZones.filter((z) => z.id !== id) })),
  clearPaintedZones: () => set({ paintedZones: [], scenario: null }),

  // Tree actions
  setTreeSpecies: (list) => set({ treeSpecies: list }),
  setActiveTreeSpecies: (id) => set({ activeTreeSpecies: id }),
  setTreeMode: (v) => set({ treeMode: v }),
  addTreePlacement: (tp) =>
    set((s) => ({ treePlacements: [...s.treePlacements, tp] })),
  removeLastTree: () =>
    set((s) => ({ treePlacements: s.treePlacements.slice(0, -1) })),
  clearTreePlacements: () => set({ treePlacements: [], scenario: null }),
}))
