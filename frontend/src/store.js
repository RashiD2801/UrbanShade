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

  // Auto-simulate state
  viewerMode: 'manual',          // 'manual' | 'auto'
  autoSimResults: null,          // response from /api/auto-simulate
  autoSimLoading: false,
  autoSimViewerOpen: false,      // true = scenario tab viewer is showing
  activeAutoSimTab: 'most_impactful',  // which scenario tab is active

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

  // Auto-simulate actions
  setViewerMode: (m) => set({ viewerMode: m, autoSimResults: null }),
  setAutoSimResults: (r) => set({ autoSimResults: r }),
  setAutoSimLoading: (v) => set({ autoSimLoading: v }),

  // Replace the entire treePlacements array (used by auto-sim tab viewer)
  setTreePlacements: (list) => set({ treePlacements: list }),

  // Open the tabbed 3-scenario viewer
  openAutoSimViewer: () => set({ autoSimViewerOpen: true, activeAutoSimTab: 'most_impactful' }),
  closeAutoSimViewer: () => set({
    autoSimViewerOpen: false,
    autoSimResults: null,
    treePlacements: [],
    scenario: null,
    viewerMode: 'manual',
  }),
  setActiveAutoSimTab: (tab) => set({ activeAutoSimTab: tab }),

  // Load an auto-sim scenario's interventions onto the map for 3D viewing.
  loadAutoSimScenario: (scenarioResult) => {
    const tps = (scenarioResult?.meta?.tree_placements ?? []).map((tp, i) => ({
      id: `auto_${i}`,
      source: 'auto',
      species_id: tp.species_id,
      lon: tp.lon,
      lat: tp.lat,
    }))
    // Strip meta/comfort fields before storing as scenario (keep grid/bounds/stats)
    const { meta: _m, comfort_threshold: _c, baseline_utci: _b, gap_c: _g, ...simCore } = scenarioResult
    set({
      treePlacements: tps,
      scenario: simCore,
      viewerMode: 'manual',
    })
  },

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
