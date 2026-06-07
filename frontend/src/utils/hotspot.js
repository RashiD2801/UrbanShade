/**
 * Hotspot analysis utilities.
 *
 * A "hotspot" is any UTCI grid cell in the top 25% (above the 75th percentile)
 * of the baseline grid.  We keep the same cells fixed across all scenarios so
 * that improvement is measured in the same physical locations.
 */

const HOTSPOT_PERCENTILE = 75   // top 25% of cells by baseline UTCI

/**
 * Compute hotspot statistics for a baseline grid, and optionally compare
 * against a scenario grid using the same hotspot cells.
 *
 * @param {number[][]} baselineGrid  2-D grid from /api/baseline
 * @param {number[][]} scenarioGrid  2-D grid from /api/scenario  (optional)
 * @returns {{
 *   threshold:     number,   UTCI value above which a cell is a hotspot
 *   baselineMean:  number,   mean UTCI of hotspot cells in baseline
 *   scenarioMean:  number|null,
 *   delta:         number|null,   positive = cooler (improvement)
 *   hotspotFraction: number,  fraction of total cells that are hotspots
 *   cells:         {r, c}[], row/col indices of hotspot cells
 * }}
 */
export function computeHotspotStats(baselineGrid, scenarioGrid = null) {
  if (!baselineGrid?.length) return null

  const rows = baselineGrid.length
  const cols = baselineGrid[0]?.length ?? 0
  if (!rows || !cols) return null

  // Collect all valid baseline values
  const allCells = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = baselineGrid[r][c]
      if (v != null && isFinite(v)) allCells.push({ v, r, c })
    }
  }
  if (!allCells.length) return null

  // 75th-percentile threshold
  const sorted = [...allCells].sort((a, b) => a.v - b.v)
  const threshIdx = Math.floor(sorted.length * HOTSPOT_PERCENTILE / 100)
  const threshold = sorted[threshIdx].v

  const hotspotCells = allCells.filter((c) => c.v >= threshold)
  const baselineMean = hotspotCells.reduce((s, c) => s + c.v, 0) / hotspotCells.length

  let scenarioMean = null
  let delta = null
  if (scenarioGrid) {
    const scVals = hotspotCells
      .map(({ r, c }) => scenarioGrid[r]?.[c])
      .filter((v) => v != null && isFinite(v))
    if (scVals.length > 0) {
      scenarioMean = scVals.reduce((s, v) => s + v, 0) / scVals.length
      delta = baselineMean - scenarioMean   // positive = improvement
    }
  }

  return {
    threshold:       +threshold.toFixed(1),
    baselineMean:    +baselineMean.toFixed(1),
    scenarioMean:    scenarioMean != null ? +scenarioMean.toFixed(1) : null,
    delta:           delta        != null ? +delta.toFixed(1)        : null,
    hotspotFraction: +(hotspotCells.length / allCells.length).toFixed(2),
    cells:           hotspotCells,
    rows,
    cols,
  }
}

/**
 * Build a PNG data-URL that highlights hotspot cells with a semi-transparent
 * orange-red colour.  The image dimensions match the grid (cols × rows) so it
 * can be used directly as a MapLibre raster source over the analysis bounds.
 *
 * @param {{r,c}[]} cells   hotspot cell indices
 * @param {number}  rows
 * @param {number}  cols
 * @param {number}  [alpha=110]   0-255
 */
export function buildHotspotOverlayUrl(cells, rows, cols, alpha = 110) {
  if (!cells?.length || !rows || !cols) return null
  const canvas = document.createElement('canvas')
  canvas.width  = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(cols, rows)

  for (const { r, c } of cells) {
    const i = (r * cols + c) * 4
    img.data[i]     = 239  // R  (orange-red)
    img.data[i + 1] = 68   // G
    img.data[i + 2] = 68   // B
    img.data[i + 3] = alpha
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * Build a PNG that shows per-cell improvement intensity.
 * Cells that cooled the most glow bright green; cells with no change are neutral.
 *
 * @param {{r,c}[]} hotspotCells
 * @param {number[][]} baselineGrid
 * @param {number[][]} scenarioGrid
 * @param {number} rows
 * @param {number} cols
 */
export function buildImprovementOverlayUrl(hotspotCells, baselineGrid, scenarioGrid, rows, cols) {
  if (!hotspotCells?.length || !scenarioGrid) return null
  const canvas = document.createElement('canvas')
  canvas.width  = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(cols, rows)

  // Find max delta for normalisation
  let maxDelta = 0
  for (const { r, c } of hotspotCells) {
    const bv = baselineGrid[r]?.[c]
    const sv = scenarioGrid[r]?.[c]
    if (bv != null && sv != null) maxDelta = Math.max(maxDelta, bv - sv)
  }
  if (maxDelta <= 0) return null

  for (const { r, c } of hotspotCells) {
    const bv = baselineGrid[r]?.[c]
    const sv = scenarioGrid[r]?.[c]
    if (bv == null || sv == null) continue
    const improvement = Math.max(0, bv - sv)
    const t = improvement / maxDelta   // 0 = no improvement, 1 = max improvement
    const i = (r * cols + c) * 4
    // Gradient: red (no improvement) → yellow → green (max improvement)
    img.data[i]     = Math.round(220 * (1 - t))   // R
    img.data[i + 1] = Math.round(180 * t + 60)    // G
    img.data[i + 2] = Math.round(20 * (1 - t))    // B
    img.data[i + 3] = 150
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}
