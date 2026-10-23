// Person outlines: MediaPipe finds the person in each photo, then we trace smooth lines around them
// at a distance. Everything runs in the browser; only the model and its runtime are downloaded (once).

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'

// Resolution of the distance field the outlines are traced on.
const GRID = 192
const FAR = 1e20

// Line placement, as fractions of photo width.
const GAP = 0.03
const MIN_SPACING = 0.032

let segmenterPromise
const fieldCache = new Map()

function getSegmenter() {
  segmenterPromise ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
    return ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    })
  })().catch((err) => {
    segmenterPromise = null
    throw err
  })
  return segmenterPromise
}

// Returns, for each grid cell, its distance (in cells) to the nearest person pixel. Cached per photo.
export function getPersonField(src, img) {
  if (!fieldCache.has(src)) {
    const promise = getSegmenter().then((segmenter) => {
      let grid
      segmenter.segment(img, (result) => {
        grid = sampleMask(result.confidenceMasks[0])
      })
      return distanceField(removeSpecks(grid))
    })
    promise.catch(() => fieldCache.delete(src))
    fieldCache.set(src, promise)
  }
  return fieldCache.get(src)
}

function sampleMask(mask) {
  const { width, height } = mask
  const confidence = mask.getAsFloat32Array()
  const grid = new Float64Array(GRID * GRID)
  for (let y = 0; y < GRID; y++) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / GRID))
    for (let x = 0; x < GRID; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / GRID))
      grid[y * GRID + x] = confidence[sy * width + sx] > 0.5 ? 0 : FAR
    }
  }
  return grid
}

// Clears small blobs the segmenter mistakes for people, so they don't get their own rings.
function removeSpecks(grid, minArea = GRID * GRID * 0.004) {
  const seen = new Uint8Array(grid.length)
  for (let start = 0; start < grid.length; start++) {
    if (grid[start] !== 0 || seen[start]) continue
    const blob = [start]
    seen[start] = 1
    for (let i = 0; i < blob.length; i++) {
      const cell = blob[i]
      const x = cell % GRID
      const neighbors = [x > 0 && cell - 1, x < GRID - 1 && cell + 1, cell - GRID, cell + GRID]
      for (const n of neighbors) {
        if (n !== false && n >= 0 && n < grid.length && grid[n] === 0 && !seen[n]) {
          seen[n] = 1
          blob.push(n)
        }
      }
    }
    if (blob.length < minArea) for (const cell of blob) grid[cell] = FAR
  }
  return grid
}

// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher), one axis at a time.
function distanceField(grid) {
  const line = new Float64Array(GRID)
  for (let x = 0; x < GRID; x++) {
    for (let y = 0; y < GRID; y++) line[y] = grid[y * GRID + x]
    const d = distance1d(line)
    for (let y = 0; y < GRID; y++) grid[y * GRID + x] = d[y]
  }
  for (let y = 0; y < GRID; y++) {
    const d = distance1d(grid.subarray(y * GRID, (y + 1) * GRID))
    for (let x = 0; x < GRID; x++) grid[y * GRID + x] = Math.sqrt(d[x])
  }
  return grid
}

function distance1d(f) {
  const n = f.length
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  let k = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s
    while ((s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])) <= z[k]) k--
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) ** 2 + f[v[k]]
  }
  return d
}

// Marching-squares segments per cell case. Corners: tl=8, tr=4, br=2, bl=1 (set when inside the line).
// Edges: T, R, B, L. Saddles (5, 10) are resolved separately using the cell center.
const SEGMENTS = {
  1: [['L', 'B']], 2: [['B', 'R']], 3: [['L', 'R']], 4: [['T', 'R']], 6: [['T', 'B']], 7: [['L', 'T']],
  8: [['L', 'T']], 9: [['T', 'B']], 11: [['T', 'R']], 12: [['L', 'R']], 13: [['B', 'R']], 14: [['L', 'B']],
}

// Traces the line where the distance field equals `level`, joined into smooth polylines.
function traceContours(field, level) {
  const at = (x, y) => field[y * GRID + x] - level
  const nodes = new Map()

  function edgePoint(edge, x, y) {
    const [key, ax, ay, bx, by] = {
      T: [`h${x},${y}`, x, y, x + 1, y],
      B: [`h${x},${y + 1}`, x, y + 1, x + 1, y + 1],
      L: [`v${x},${y}`, x, y, x, y + 1],
      R: [`v${x + 1},${y}`, x + 1, y, x + 1, y + 1],
    }[edge]
    if (!nodes.has(key)) {
      const a = at(ax, ay)
      const t = a / (a - at(bx, by))
      nodes.set(key, { pt: [ax + (bx - ax) * t, ay + (by - ay) * t], links: [] })
    }
    return key
  }

  for (let y = 0; y < GRID - 1; y++) {
    for (let x = 0; x < GRID - 1; x++) {
      const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1)
      const index = (tl < 0) * 8 + (tr < 0) * 4 + (br < 0) * 2 + (bl < 0)
      let segments = SEGMENTS[index]
      if (index === 5 || index === 10) {
        const centerInside = tl + tr + br + bl < 0
        segments = (index === 5) === centerInside ? [['L', 'T'], ['B', 'R']] : [['L', 'B'], ['T', 'R']]
      }
      for (const [e1, e2] of segments ?? []) {
        const k1 = edgePoint(e1, x, y)
        const k2 = edgePoint(e2, x, y)
        nodes.get(k1).links.push(k2)
        nodes.get(k2).links.push(k1)
      }
    }
  }

  const visited = new Set()
  const contours = []
  function walk(start) {
    const keys = [start]
    visited.add(start)
    let current = start
    for (let next; (next = nodes.get(current).links.find((k) => !visited.has(k))); current = next) {
      visited.add(next)
      keys.push(next)
    }
    const closed = keys.length > 2 && nodes.get(current).links.includes(start)
    contours.push({ points: keys.map((k) => nodes.get(k).pt), closed })
  }
  // Open lines (cut off by the photo edge) first, then closed loops.
  for (const [key, node] of nodes) if (node.links.length === 1 && !visited.has(key)) walk(key)
  for (const key of nodes.keys()) if (!visited.has(key)) walk(key)

  // Drop tiny specks from segmentation noise
  return contours.filter((c) => c.points.length > 12).map((c) => ({ ...c, points: smooth(c.points, c.closed) }))
}

// Chaikin corner cutting: rounds off the grid's stair steps.
function smooth(points, closed, iterations = 3) {
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  for (let it = 0; it < iterations; it++) {
    const n = points.length
    const out = closed ? [] : [points[0]]
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = points[i]
      const b = points[(i + 1) % n]
      out.push(lerp(a, b, 0.25), lerp(a, b, 0.75))
    }
    if (!closed) out.push(points[n - 1])
    points = out
  }
  return points
}

// Draws a solid line around the person with a gap, and a dashed line further out.
export function drawOutline(ctx, field, x, y, w, h, { color, thickness }) {
  const cell = w / GRID
  const gap = GAP * GRID
  const spacing = Math.max(MIN_SPACING * GRID, (thickness * 2.6) / cell)
  const lines = [
    { level: gap, width: thickness, dash: [] },
    { level: gap + spacing, width: thickness * 0.75, dash: [thickness * 2.4, thickness * 2] },
  ]

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const line of lines) {
    ctx.lineWidth = line.width
    ctx.setLineDash(line.dash)
    for (const { points, closed } of traceContours(field, line.level)) {
      ctx.beginPath()
      points.forEach(([gx, gy], i) => {
        const px = x + (gx + 0.5) * cell
        const py = y + ((gy + 0.5) * h) / GRID
        if (i) ctx.lineTo(px, py)
        else ctx.moveTo(px, py)
      })
      if (closed) ctx.closePath()
      ctx.stroke()
    }
  }

  ctx.restore()
}
