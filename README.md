# UrbanShade

**Identify urban heat stress hotspots. Simulate cooling interventions. Act.**

UrbanShade is a web-based thermal comfort analysis tool for urban designers and climate adaptation planners. Draw any area in Europe, run a UTCI simulation, and instantly see where heat stress is worst — then let the tool automatically find the best cooling strategy for those critical zones.

---

## What it does

**Baseline analysis**
Draw a polygon anywhere in Europe. UrbanShade fetches local weather data, OSM buildings, and existing surface materials, then runs a full UTCI (Universal Thermal Climate Index) simulation via the Infrared SDK. The result is a thermal comfort heatmap showing temperature stress across every square metre of your area.

**Hotspot detection**
Rather than reporting a single average that dilutes the problem, UrbanShade identifies the *hottest 25% of cells* — the streets, plazas, and open spaces where people actually suffer. All improvement metrics are reported for those critical zones, making the impact of interventions visible and honest.

**Manual scenario mode**
Paint surface material changes (asphalt → vegetation, concrete → soil, etc.) directly on the map and place individual trees from a catalogue of 12 European species. Run a new UTCI simulation to see the delta — both overall and in the hotspot zones. 3D axonometric view shows tree canopies and material zones in context.

**Auto-simulate mode**
One click finds the best feasible cooling intervention: up to 50 Tipuana tipu trees placed in the hottest zones first, plus conversion of the largest asphalt/concrete features to vegetation where the SDK supports it. Reports hotspot improvement (e.g. −3.8 °C in critical areas) alongside overall mean and cost.

**PDF report**
Exports a one-page report with map screenshots (3D view + UTCI heatmap), hotspot stats, intervention details, and cost breakdown.

---

## Key metrics

| Metric | What it means |
|---|---|
| **Hotspot mean UTCI** | Average felt temperature in the top 25% hottest cells |
| **Hotspot delta** | Improvement in those cells after intervention |
| **Overall mean UTCI** | Whole-area average (context only — not the headline) |
| **Comfort threshold** | < 26 °C UTCI = no thermal stress (ISO 7933) |

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, MapLibre GL, Zustand, Vite |
| Backend | FastAPI, Pydantic, Shapely |
| Simulation | [Infrared SDK](https://infrared.city) (UTCI model) |
| Geocoding | Nominatim (OpenStreetMap) |
| OSM data | Overpass API (existing trees) |
| PDF export | jsPDF + jspdf-autotable |

---

## Project structure

```
UrbanShade/
├── backend/
│   ├── app/
│   │   ├── main.py              FastAPI app entry point
│   │   ├── schemas.py           Pydantic request/response models
│   │   ├── routers/
│   │   │   └── sims.py          API endpoints (/baseline, /scenario, /best-scenario)
│   │   └── services/
│   │       ├── infrared.py      Infrared SDK wrapper (baseline + scenario runs)
│   │       └── auto_sim.py      Auto-simulate engine (hotspot placement + best scenario)
│   └── .env                     INFRARED_API_KEY (not committed)
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── AreaPicker.jsx   Draw polygon + Nominatim address search
│       │   ├── SplitViewer.jsx  Left (3D axo) + right (UTCI heatmap) split view
│       │   ├── Sidebar.jsx      Stats panel with hotspot analysis
│       │   ├── TreePanel.jsx    Manual tree species picker
│       │   └── AutoSimPanel.jsx Auto-simulate controls + result card
│       ├── utils/
│       │   └── hotspot.js       Hotspot cell analysis + raster overlay builders
│       ├── store.js             Zustand state management
│       └── api.js               Backend fetch wrappers
└── datasets/
    └── tree_species.csv         12 European tree species with costs and dimensions
```

---

## Setup

### Prerequisites
- Python 3.11+
- Node.js 18+
- An Infrared SDK API key → [infrared.city](https://infrared.city)

### Backend

```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt

# Create .env
echo INFRARED_API_KEY=your_key_here > .env

uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## How to use

1. **Search** for a city or address in the search bar
2. **Draw** a polygon around the area you want to analyse (500m × 500m works well)
3. **Analyse heat** — wait ~30s for the baseline UTCI simulation
4. **Explore** the heatmap: red = heat stress, blue = comfortable
5. **Manual mode**: paint material zones or place trees, then run a scenario to see the delta
6. **Auto-simulate**: switch to the Auto-Simulate tab and click *Find best cooling intervention*
7. **Download PDF** to export the result with map screenshots

---

## Tree species catalogue

12 European species common to Mediterranean cities, with realistic planting costs and canopy dimensions:

| Species | Canopy radius | Cost |
|---|---|---|
| Tipuana tipu (Tipu Tree) | 10 m | €1,300 |
| Platanus × hispanica (Plane Tree) | 9 m | €1,400 |
| Celtis australis (Nettle Tree) | 7 m | €880 |
| Ficus microcarpa (Indian Laurel) | 7 m | €900 |
| Jacaranda mimosifolia | 6 m | €950 |
| Quercus ilex (Holm Oak) | 6.5 m | €1,050 |
| Fraxinus ornus (Manna Ash) | 5 m | €700 |
| Melia azedarach (Persian Lilac) | 5.5 m | €680 |
| Pinus pinea (Stone Pine) | 5.5 m | €750 |
| Cercis siliquastrum (Judas Tree) | 4 m | €480 |
| Olea europaea (Olive Tree) | 4 m | €520 |
| Lagerstroemia indica (Crape Myrtle) | 3 m | €360 |

---

## Simulation methodology

- **UTCI model**: Infrared SDK computes Universal Thermal Climate Index using weather files (EPW), building geometry from OpenStreetMap, and ground material layers
- **Time window**: July, 9am–6pm (peak pedestrian heat stress period)
- **Ground materials**: SDK keys `concrete`, `asphalt`, `soil`, `vegetation`, `water`
- **Tree canopy**: Each placed tree becomes a circular vegetation patch injected into the ground materials layer before simulation
- **Hotspot analysis**: Top 25% of cells by baseline UTCI — same cells tracked across all scenarios so comparisons are fair
- **Auto-sim placement**: Trees sorted by local UTCI value (hottest zones first) using the baseline grid

---

## Developed at

IAAC — Institute for Advanced Architecture of Catalonia  
Master in Advanced Architecture · Term 3 · AI Methods Hackathon  
Barcelona, 2026
