import { useRef } from 'react'
import { stickerFont } from '../lib/photo'

const UNDO_LIMIT = 30

// Saves the current stickers so the next change can be undone.
export const checkpoint = (ed) => ({ ...ed, past: [...ed.past.slice(1 - UNDO_LIMIT), ed.stickers] })

export const clampStickerSize = (strip, size) => Math.min(strip.width * 0.5, Math.max(strip.width * 0.06, size))

let measureCtx
function stickerWidth(sticker) {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  measureCtx.font = stickerFont(sticker)
  return measureCtx.measureText(sticker.emoji ?? sticker.text).width
}

function pathFor(points) {
  const [first, ...rest] = points
  // A single tap still leaves a dot
  const tail = rest.length ? rest : [first]
  return `M ${first[0]} ${first[1]} ` + tail.map(([x, y]) => `L ${x} ${y}`).join(' ')
}

const distance = ([ax, ay], [bx, by]) => Math.hypot(bx - ax, by - ay)
const angle = ([ax, ay], [bx, by]) => (Math.atan2(by - ay, bx - ax) * 180) / Math.PI

// Shows the rendered strip with an SVG layer on top for drawing and placing stickers.
// All coordinates are in strip pixels, so they export 1:1 onto the final image.
export default function StripEditor({ strip, edits, onChange, tool, pen, selectedId, onSelect }) {
  const svgRef = useRef(null)
  const dragRef = useRef(null) // { type: 'draw' } | { type: 'move', id, dx, dy, moved } | { type: 'twist', id, size, rotation, distance, angle }
  const pointersRef = useRef(new Map())

  function toStrip(e) {
    const rect = svgRef.current.getBoundingClientRect()
    return [((e.clientX - rect.left) * strip.width) / rect.width, ((e.clientY - rect.top) * strip.height) / rect.height]
  }

  function track(e) {
    svgRef.current.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, toStrip(e))
  }

  // A second finger while moving a sticker switches to pinch-to-resize and twist-to-rotate.
  function startTwist(e) {
    track(e)
    const sticker = edits.stickers.find((s) => s.id === dragRef.current.id)
    const [a, b] = pointersRef.current.values()
    if (!dragRef.current.moved) onChange(checkpoint)
    dragRef.current = { type: 'twist', id: sticker.id, size: sticker.size, rotation: sticker.rotation, distance: distance(a, b), angle: angle(a, b) }
  }

  function handlePointerDown(e) {
    if (tool === 'draw') {
      track(e)
      dragRef.current = { type: 'draw' }
      const stroke = { color: pen.color, width: pen.size * strip.width, points: [toStrip(e)] }
      onChange((ed) => ({ ...ed, strokes: [...ed.strokes, stroke] }))
    } else if (tool === 'sticker') {
      if (dragRef.current?.type === 'move') startTwist(e)
      else onSelect(null)
    }
  }

  function handleStickerDown(e, sticker) {
    if (tool !== 'sticker') return
    e.stopPropagation()
    if (dragRef.current?.type === 'move') return startTwist(e)
    track(e)
    const [x, y] = toStrip(e)
    dragRef.current = { type: 'move', id: sticker.id, dx: sticker.x - x, dy: sticker.y - y, moved: false }
    onSelect(sticker.id)
  }

  function handlePointerMove(e) {
    const drag = dragRef.current
    if (!drag || !pointersRef.current.has(e.pointerId)) return
    const [x, y] = toStrip(e)
    pointersRef.current.set(e.pointerId, [x, y])

    if (drag.type === 'draw') {
      onChange((ed) => {
        const strokes = ed.strokes.slice()
        const last = strokes[strokes.length - 1]
        strokes[strokes.length - 1] = { ...last, points: [...last.points, [x, y]] }
        return { ...ed, strokes }
      })
    } else if (drag.type === 'move') {
      // Checkpoint on the first real move, so a tap that only selects doesn't add an empty undo step.
      if (!drag.moved) onChange(checkpoint)
      drag.moved = true
      onChange((ed) => ({
        ...ed,
        stickers: ed.stickers.map((s) => (s.id === drag.id ? { ...s, x: x + drag.dx, y: y + drag.dy } : s)),
      }))
    } else {
      const [a, b] = pointersRef.current.values()
      const size = clampStickerSize(strip, (drag.size * distance(a, b)) / drag.distance)
      const rotation = drag.rotation + angle(a, b) - drag.angle
      onChange((ed) => ({ ...ed, stickers: ed.stickers.map((s) => (s.id === drag.id ? { ...s, size, rotation } : s)) }))
    }
  }

  function handlePointerUp(e) {
    pointersRef.current.delete(e.pointerId)
    // Lifting either finger ends the gesture; the remaining one must be lifted before a new drag starts.
    dragRef.current = null
  }

  return (
    <div className="relative max-w-full">
      <img
        src={strip.url}
        alt="Your photo strip"
        draggable={false}
        className="block max-h-[48dvh] w-auto max-w-full select-none rounded-sm shadow-xl shadow-stone-900/15"
      />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${strip.width} ${strip.height}`}
        className={`absolute inset-0 h-full w-full select-none ${tool === 'sticker' || tool === 'draw' ? 'touch-none' : 'pointer-events-none'} ${
          tool === 'draw' ? 'cursor-crosshair' : ''
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {edits.strokes.map((s, i) => (
          <path key={i} d={pathFor(s.points)} stroke={s.color} strokeWidth={s.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {edits.stickers.map((s) => {
          const width = Math.max(stickerWidth(s), s.size * 0.6) + s.size * 0.25
          const height = s.size * 1.25
          return (
            <g
              key={s.id}
              transform={`rotate(${s.rotation} ${s.x} ${s.y})`}
              onPointerDown={(e) => handleStickerDown(e, s)}
              className={tool === 'sticker' ? 'cursor-move' : ''}
            >
              {/* Invisible hit area so empty or thin text is still easy to grab */}
              <rect x={s.x - width / 2} y={s.y - height / 2} width={width} height={height} fill="transparent" />
              {tool === 'sticker' && selectedId === s.id && (
                <rect
                  x={s.x - width / 2}
                  y={s.y - height / 2}
                  width={width}
                  height={height}
                  rx={s.size * 0.2}
                  fill="none"
                  stroke="#0ea5e9"
                  strokeWidth={strip.width * 0.005}
                  strokeDasharray={`${strip.width * 0.015} ${strip.width * 0.01}`}
                />
              )}
              <text x={s.x} y={s.y} fill={s.color} textAnchor="middle" dominantBaseline="central" style={{ font: stickerFont(s) }}>
                {s.emoji ?? s.text}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
