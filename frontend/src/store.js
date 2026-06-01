import { create } from 'zustand'

export const useStore = create((set, get) => ({
  phase: 'picker',       // 'picker' | 'viewer'
  polygon: null,         // GeoJSON Polygon

  baseline: null,        // full API response from /api/baseline
  scenario: null,        // full API response from /api/scenario

  paintedZones: [],      // [{id, material, polygon (GeoJSON Feature)}]
  activeMaterial: 'vegetation',

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
}))
