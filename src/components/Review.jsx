import { useEffect, useState } from 'react'
import { FRAMES, TEXT_FONTS, exportStrip, renderStrip } from '../lib/photo'
import StripEditor, { checkpoint, clampStickerSize } from './StripEditor'
import { Pill } from './ui'

const TOOLS = [
  { id: 'style', name: 'Style' },
  { id: 'photos', name: 'Photos' },
  { id: 'sticker', name: 'Stickers' },
  { id: 'draw', name: 'Draw' },
]
const STICKERS = ['💖', '✨', '🌸', '⭐', '🎀', '🦋', '😎', '🔥', '🌈', '💋', '👑', '🍓', '☁️', '🐻', '🎉', '💫', '🥰', '🌷']
const PEN_COLORS = ['#ffffff', '#1c1917', '#ec4899', '#0ea5e9', '#facc15', '#22c55e']
// `size` is a fraction of strip width for drawing; `outline` is a fraction of photo width for person tracing.
const PEN_SIZES = [
  { name: 'Thin', size: 0.008, outline: 0.007 },
  { name: 'Thick', size: 0.018, outline: 0.013 },
]
// `past` holds earlier versions of `stickers` for undo.
const EMPTY_EDITS = { stickers: [], strokes: [], past: [] }

let nextStickerId = 0

const canShare =
  typeof navigator !== 'undefined' &&
  !!navigator.canShare?.({ files: [new File([''], 'test.png', { type: 'image/png' })] })

const RotateIcon = ({ size = 'h-4 w-4', className = '' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${size} ${className}`}>
    <path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4" />
  </svg>
)

export default function Review({ photos, takenAt, onRetake, onRetakePhoto }) {
  const [layout, setLayout] = useState('strip')
  const [frame, setFrame] = useState(FRAMES[0])
  const [caption, setCaption] = useState('')
  const [showDate, setShowDate] = useState(true)
  const [strip, setStrip] = useState(null)
  const [tool, setTool] = useState('style')
  // Stickers and drawings are kept per layout because each layout has a different shape.
  const [allEdits, setAllEdits] = useState({ strip: EMPTY_EDITS, grid: EMPTY_EDITS })
  const [selectedId, setSelectedId] = useState(null)
  const [pen, setPen] = useState({ color: PEN_COLORS[2], size: PEN_SIZES[0].size })
  const [trace, setTrace] = useState('off') // off | loading | on | error

  const edits = allEdits[layout]
  const selected = edits.stickers.find((s) => s.id === selectedId)
  const tracing = trace === 'loading' || trace === 'on'

  useEffect(() => {
    let current = true
    const outline = tracing ? { color: pen.color, thickness: PEN_SIZES.find((p) => p.size === pen.size).outline } : null
    renderStrip(photos, { layout, frame, caption, date: showDate ? takenAt : null, outline })
      .then((result) => {
        if (!current) return
        setStrip(result)
        setTrace((t) => (t === 'loading' ? 'on' : t))
      })
      .catch(() => current && setTrace('error'))
    return () => {
      current = false
    }
  }, [photos, takenAt, layout, frame, caption, showDate, tracing, pen.color, pen.size])

  function updateEdits(update) {
    setAllEdits((all) => ({ ...all, [layout]: update(all[layout]) }))
  }

  function addSticker(content) {
    const id = ++nextStickerId
    const sticker = { id, x: strip.width / 2, y: strip.height / 2, size: strip.width * 0.18, rotation: 0, ...content }
    updateEdits((ed) => ({ ...checkpoint(ed), stickers: [...ed.stickers, sticker] }))
    setSelectedId(id)
  }

  function addText() {
    addSticker({ text: 'Text', font: TEXT_FONTS[0].id, color: PEN_COLORS[2], size: strip.width * 0.12 })
  }

  // Pass `save: false` for changes that shouldn't each be their own undo step, like typing.
  function updateSelected(change, save = true) {
    updateEdits((ed) => ({
      ...(save ? checkpoint(ed) : ed),
      stickers: ed.stickers.map((s) => (s.id === selectedId ? { ...s, ...change(s) } : s)),
    }))
  }

  function deleteSelected() {
    updateEdits((ed) => ({ ...checkpoint(ed), stickers: ed.stickers.filter((s) => s.id !== selectedId) }))
    setSelectedId(null)
  }

  function undoSticker() {
    updateEdits((ed) => ({ ...ed, stickers: ed.past.at(-1), past: ed.past.slice(0, -1) }))
    setSelectedId(null)
  }

  function startOver() {
    const edited = caption.trim() || Object.values(allEdits).some((ed) => ed.stickers.length || ed.strokes.length)
    if (!edited || window.confirm('Start over? Your caption, stickers and drawings will be lost.')) onRetake()
  }

  async function exportFile() {
    const blob = await (await fetch(await exportStrip(strip, edits))).blob()
    return new File([blob], `klovesnap-${Date.now()}.png`, { type: 'image/png' })
  }

  async function save() {
    const file = await exportFile()
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function share() {
    const file = await exportFile()
    try {
      await navigator.share({ files: [file], title: 'KloveSnap' })
    } catch (err) {
      // Some browsers can't share files; fall back to downloading so the tap still does something.
      if (err.name !== 'AbortError') save()
    }
  }

  return (
    <div className="animate-rise flex flex-1 flex-col">
      <div className="grid min-h-0 flex-1 place-items-center rounded-[2rem] bg-gradient-to-br from-sky-50 to-pink-50 p-5">
        {strip ? (
          <StripEditor
            strip={strip}
            edits={edits}
            onChange={updateEdits}
            tool={tool}
            pen={pen}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        ) : (
          <p className="text-sm text-stone-400">Developing…</p>
        )}
      </div>

      <div className="mt-4 grid grid-cols-4 rounded-full bg-stone-100 p-1">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            className={`rounded-full py-2 text-sm font-medium transition ${
              tool === t.id ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="mt-3 min-h-[6.5rem]">
        {tool === 'style' && (
          <>
            <div className="flex items-center gap-2">
              <Pill active={layout === 'strip'} onClick={() => setLayout('strip')} className="shrink-0">Strip</Pill>
              <Pill active={layout === 'grid'} onClick={() => setLayout('grid')} className="shrink-0">Grid</Pill>
              <div className="no-scrollbar fade-x flex min-w-0 flex-1 gap-2.5 overflow-x-auto px-3 py-2">
                {FRAMES.map((f) => (
                  <button
                    key={f.id}
                    aria-label={`${f.name} frame`}
                    onClick={() => setFrame(f)}
                    className={`h-8 w-8 shrink-0 rounded-full ring-1 ring-stone-200 transition active:scale-90 ${
                      frame.id === f.id ? 'outline-2 outline-offset-2 outline-sky-500' : ''
                    }`}
                    style={{ backgroundColor: f.bg }}
                  />
                ))}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3 border-b border-stone-200 focus-within:border-sky-400">
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                maxLength={32}
                placeholder="Add a caption"
                className="min-w-0 flex-1 bg-transparent py-2.5 text-base outline-none placeholder:text-stone-400"
              />
              <Pill active={showDate} onClick={() => setShowDate(!showDate)} className="px-3 py-1 text-xs">
                Date
              </Pill>
            </div>
          </>
        )}

        {tool === 'photos' && (
          <>
            <div className="flex flex-wrap justify-center gap-2">
              {photos.map((src, i) => (
                <button
                  key={i}
                  onClick={() => onRetakePhoto(i)}
                  aria-label={`Retake photo ${i + 1}`}
                  className="relative h-14 w-14 overflow-hidden rounded-xl ring-1 ring-stone-200 transition active:scale-90"
                >
                  <img src={src} alt="" className="h-full w-full object-cover" />
                  <span className="absolute inset-0 grid place-items-center bg-black/20 text-white">
                    <RotateIcon size="h-5 w-5" />
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-xs text-stone-400">Tap a photo to retake just that one</p>
          </>
        )}

        {tool === 'sticker' && (
          <>
            <div className="no-scrollbar fade-x -mx-4 flex gap-1 overflow-x-auto px-4">
              <button
                onClick={addText}
                disabled={!strip}
                aria-label="Add text"
                className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl font-display text-2xl font-bold text-stone-700 transition active:scale-90 active:bg-stone-100"
              >
                Aa
              </button>
              {STICKERS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => addSticker({ emoji })}
                  disabled={!strip}
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-3xl transition active:scale-90 active:bg-stone-100"
                >
                  {emoji}
                </button>
              ))}
            </div>
            {selected ? (
              <div className="mt-3 flex items-center justify-center gap-1.5">
                <Pill onClick={() => updateSelected((s) => ({ size: clampStickerSize(strip, s.size / 1.2) }))} aria-label="Smaller" className="px-3.5">−</Pill>
                <Pill onClick={() => updateSelected((s) => ({ size: clampStickerSize(strip, s.size * 1.2) }))} aria-label="Bigger" className="px-3.5">+</Pill>
                <Pill onClick={() => updateSelected((s) => ({ rotation: s.rotation - 15 }))} aria-label="Rotate left" className="px-3">
                  <RotateIcon />
                </Pill>
                <Pill onClick={() => updateSelected((s) => ({ rotation: s.rotation + 15 }))} aria-label="Rotate right" className="px-3">
                  <RotateIcon className="-scale-x-100" />
                </Pill>
                <Pill onClick={deleteSelected} className="px-3.5 text-pink-600">Delete</Pill>
                <Pill onClick={undoSticker} disabled={!edits.past.length} className="px-3.5">Undo</Pill>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-3">
                <p className="flex-1 text-xs leading-snug text-stone-400">
                  Tap a sticker to add it, then drag it into place. Pinch and twist with two fingers to resize and rotate.
                </p>
                <Pill onClick={undoSticker} disabled={!edits.past.length} className="shrink-0">Undo</Pill>
              </div>
            )}
            {selected?.text !== undefined && (
              <>
                <div className="mt-3 flex items-center gap-2 border-b border-stone-200 focus-within:border-sky-400">
                  <input
                    value={selected.text}
                    onFocus={() => updateSelected(() => ({}))}
                    onChange={(e) => updateSelected(() => ({ text: e.target.value }), false)}
                    maxLength={24}
                    placeholder="Type something"
                    className="min-w-0 flex-1 bg-transparent py-2.5 text-base outline-none placeholder:text-stone-400"
                  />
                  {TEXT_FONTS.map((f) => (
                    <Pill
                      key={f.id}
                      active={selected.font === f.id}
                      onClick={() => updateSelected(() => ({ font: f.id }))}
                      className="shrink-0 px-3 py-1 text-xs"
                    >
                      {f.name}
                    </Pill>
                  ))}
                </div>
                <div className="mt-3 flex justify-center gap-2.5">
                  {PEN_COLORS.map((color) => (
                    <button
                      key={color}
                      aria-label={`Text color ${color}`}
                      onClick={() => updateSelected(() => ({ color }))}
                      className={`h-7 w-7 rounded-full ring-1 ring-stone-200 transition active:scale-90 ${
                        selected.color === color ? 'outline-2 outline-offset-2 outline-sky-500' : ''
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {tool === 'draw' && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex gap-2.5 py-1">
                {PEN_COLORS.map((color) => (
                  <button
                    key={color}
                    aria-label={`Pen color ${color}`}
                    onClick={() => setPen({ ...pen, color })}
                    className={`h-8 w-8 rounded-full ring-1 ring-stone-200 transition active:scale-90 ${
                      pen.color === color ? 'outline-2 outline-offset-2 outline-sky-500' : ''
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              {PEN_SIZES.map((p) => (
                <Pill key={p.name} active={pen.size === p.size} onClick={() => setPen({ ...pen, size: p.size })}>
                  {p.name}
                </Pill>
              ))}
              <Pill
                onClick={() => updateEdits((ed) => ({ ...ed, strokes: ed.strokes.slice(0, -1) }))}
                disabled={!edits.strokes.length}
                className="ml-auto"
              >
                Undo
              </Pill>
              <Pill onClick={() => updateEdits((ed) => ({ ...ed, strokes: [] }))} disabled={!edits.strokes.length}>
                Clear
              </Pill>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Pill
                active={tracing}
                disabled={trace === 'loading'}
                onClick={() => setTrace(tracing ? 'off' : 'loading')}
                className="shrink-0 gap-1.5"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
                  <circle cx="12" cy="7" r="3.5" strokeDasharray="2.5 2.5" />
                  <path d="M5 21v-1a7 7 0 0 1 14 0v1" strokeDasharray="2.5 2.5" />
                </svg>
                {trace === 'loading' ? 'Tracing…' : 'Trace person'}
              </Pill>
              <p className="text-xs leading-snug text-stone-400">
                {trace === 'error'
                  ? "Couldn't load the tracer. Check your internet and try again."
                  : 'Adds a solid and a dashed outline around everyone, in the pen color and size.'}
              </p>
            </div>
          </>
        )}
      </div>

      <div className="mt-auto flex gap-3 pt-5">
        <button
          onClick={startOver}
          className="rounded-full px-6 py-3.5 font-medium text-stone-600 ring-1 ring-stone-200 transition active:scale-[0.98] active:bg-stone-50"
        >
          Retake
        </button>
        <button
          onClick={save}
          disabled={!strip}
          className="flex-1 rounded-full bg-pink-500 py-3.5 font-semibold text-white shadow-lg shadow-pink-500/25 transition active:scale-[0.98] disabled:bg-stone-300 disabled:shadow-none"
        >
          Save
        </button>
        {canShare && (
          <button
            onClick={share}
            disabled={!strip}
            aria-label="Share"
            className="grid w-[3.25rem] shrink-0 place-items-center rounded-full bg-sky-500 text-white shadow-lg shadow-sky-500/25 transition active:scale-95 disabled:bg-stone-300 disabled:shadow-none"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" />
              <path d="M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
