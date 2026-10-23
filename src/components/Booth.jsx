import { useEffect, useRef, useState } from 'react'
import { FILTERS, captureFrame } from '../lib/photo'
import { beep, shutter } from '../lib/sound'
import { Pill } from './ui'

const SHOT_OPTIONS = [1, 2, 3, 4, 6]
const TIMER_OPTIONS = [3, 5, 10, 0] // 0 = no timer, tap for each photo
const ZOOM_STEPS = [1, 2, 3]
const MAX_ZOOM = 3
const SOUND_KEY = 'klovesnap-sound'

// Settings carry over to the next session (like retaking one photo) so new shots match the rest.
const remembered = { facing: 'user', filter: FILTERS[0], shotCount: 4, delay: 3, zoom: 1 }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const cycle = (options, value) => options[(options.indexOf(value) + 1) % options.length]
const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(1, z))
const touchDistance = ([a, b]) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)

function loadSoundSetting() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}

// `single` takes one photo to replace an existing one; `onCancel` backs out of that.
export default function Booth({ onDone, single = false, onCancel }) {
  const videoRef = useRef(null)
  const cancelledRef = useRef(false)
  const shotsRef = useRef([])
  const [facing, setFacing] = useState(remembered.facing)
  const [cameraState, setCameraState] = useState('loading') // loading | ready | error
  const [cameraError, setCameraError] = useState('')
  const [filter, setFilter] = useState(remembered.filter)
  const [shotCount, setShotCount] = useState(remembered.shotCount)
  const [delay, setDelay] = useState(remembered.delay)
  const [sound, setSound] = useState(loadSoundSetting)
  const [running, setRunning] = useState(false)
  const [countdown, setCountdown] = useState(null)
  const [flashKey, setFlashKey] = useState(0)
  const [taken, setTaken] = useState(0)
  const [zoom, setZoom] = useState(remembered.zoom)
  const zoomRef = useRef(remembered.zoom)
  const pinchRef = useRef(null)

  const count = single ? 1 : shotCount
  const manual = delay === 0

  useEffect(() => {
    Object.assign(remembered, { facing, filter, delay, zoom })
    if (!single) remembered.shotCount = shotCount
  }, [facing, filter, delay, zoom, shotCount, single])

  function toggleSound() {
    setSound(!sound)
    try {
      localStorage.setItem(SOUND_KEY, sound ? 'off' : 'on')
    } catch {
      // Private mode etc. — the setting just won't stick.
    }
  }

  function applyZoom(z) {
    zoomRef.current = clampZoom(z)
    setZoom(zoomRef.current)
  }

  function nextZoomStep() {
    applyZoom(ZOOM_STEPS.find((step) => step > zoom + 0.05) ?? 1)
  }

  function handleTouchStart(e) {
    if (e.touches.length === 2) pinchRef.current = { distance: touchDistance(e.touches), zoom }
  }

  function handleTouchMove(e) {
    if (e.touches.length === 2 && pinchRef.current) {
      applyZoom((pinchRef.current.zoom * touchDistance(e.touches)) / pinchRef.current.distance)
    }
  }

  function handleTouchEnd(e) {
    if (e.touches.length < 2) pinchRef.current = null
  }

  useEffect(() => {
    cancelledRef.current = false
    let active = true
    let stream
    setCameraState('loading')

    if (!navigator.mediaDevices) {
      setCameraError('Camera needs a modern browser over https.')
      setCameraState('error')
      return
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false })
      .then((s) => {
        stream = s
        if (!active) return s.getTracks().forEach((t) => t.stop())
        videoRef.current.srcObject = s
        setCameraState('ready')
      })
      .catch((err) => {
        if (!active) return
        setCameraError(err.name === 'NotAllowedError' ? 'Allow camera access in your browser settings, then reload.' : 'No camera found, or it is in use by another app.')
        setCameraState('error')
      })

    return () => {
      active = false
      cancelledRef.current = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [facing])

  function snap() {
    // Read zoom from a ref so pinching mid-session applies to the next shot.
    shotsRef.current.push(captureFrame(videoRef.current, filter.css, facing === 'user', zoomRef.current))
    setTaken(shotsRef.current.length)
    setFlashKey((k) => k + 1)
    if (sound) shutter()
  }

  async function finish() {
    await sleep(700)
    if (cancelledRef.current) return
    setRunning(false)
    onDone(shotsRef.current)
  }

  async function startSession() {
    setRunning(true)
    setTaken(0)
    shotsRef.current = []

    for (let i = 0; i < count; i++) {
      for (let c = delay; c > 0; c--) {
        setCountdown(c)
        if (sound) beep(c === 1)
        await sleep(1000)
        if (cancelledRef.current) return
      }
      setCountdown(null)
      snap()
      if (i < count - 1) {
        await sleep(700)
        if (cancelledRef.current) return
      }
    }
    finish()
  }

  // Without a timer, each tap of the shutter takes the next photo.
  function tapToSnap() {
    if (!running) {
      shotsRef.current = []
      setRunning(true)
    }
    snap()
    if (shotsRef.current.length === count) finish()
  }

  const iconButton = 'grid h-10 w-10 place-items-center rounded-full bg-black/30 text-white backdrop-blur active:scale-95'

  return (
    <div className="flex flex-1 flex-col">
      <div
        className="relative aspect-square w-full touch-none overflow-hidden rounded-[2rem] bg-stone-900 shadow-xl shadow-sky-900/10"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={(e) => applyZoom(zoom - e.deltaY * 0.002)}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
          style={{ filter: filter.css, transform: `scale(${facing === 'user' ? -zoom : zoom}, ${zoom})` }}
        />

        {cameraState === 'loading' && (
          <div className="absolute inset-0 grid place-items-center text-sm text-stone-400">Starting camera…</div>
        )}
        {cameraState === 'error' && (
          <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-stone-300">{cameraError}</div>
        )}

        {countdown !== null && (
          <div key={`${taken}-${countdown}`} className="animate-pop absolute inset-0 grid place-items-center">
            <span className="font-display text-8xl font-bold text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.45)]">{countdown}</span>
          </div>
        )}
        {flashKey > 0 && <div key={flashKey} className="animate-flash pointer-events-none absolute inset-0 bg-white" />}

        {cameraState === 'ready' && (
          <button
            onClick={nextZoomStep}
            aria-label="Zoom"
            className="absolute bottom-3 left-1/2 grid h-10 min-w-10 -translate-x-1/2 place-items-center rounded-full bg-black/30 px-2 text-xs font-semibold text-white backdrop-blur active:scale-95"
          >
            {Number(zoom.toFixed(1))}x
          </button>
        )}

        {running ? (
          <div className="absolute inset-x-0 top-4 flex justify-center gap-1.5">
            {Array.from({ length: count }, (_, i) => (
              <span key={i} className={`h-1.5 w-6 rounded-full ${i < taken ? 'bg-white' : 'bg-white/35'}`} />
            ))}
          </div>
        ) : (
          <>
            <button onClick={toggleSound} aria-label={sound ? 'Mute sounds' : 'Turn sounds on'} className={`absolute left-3 top-3 ${iconButton}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                {sound ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 5 6M21 9l-5 6" />}
              </svg>
            </button>
            <button
              onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
              aria-label="Switch camera"
              className={`absolute right-3 top-3 ${iconButton}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <path d="M20 7h-3l-2-3H9L7 7H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Z" />
                <path d="M9 13a3 3 0 0 1 5.2-2M15 13a3 3 0 0 1-5.2 2M14 9v2h-2M10 17v-2h2" />
              </svg>
            </button>
          </>
        )}
      </div>

      <div className="no-scrollbar fade-x -mx-4 mt-4 flex snap-x gap-2 overflow-x-auto px-4 py-1">
        {FILTERS.map((f) => (
          <Pill key={f.id} active={filter.id === f.id} disabled={running} onClick={() => setFilter(f)} className="shrink-0 snap-start">
            {f.name}
          </Pill>
        ))}
      </div>

      <div className="mt-auto grid grid-cols-[1fr_auto_1fr] items-center gap-3 pt-6">
        {single ? (
          <Pill onClick={onCancel} disabled={running} className="justify-self-start">
            Cancel
          </Pill>
        ) : (
          <Pill onClick={() => setShotCount(cycle(SHOT_OPTIONS, shotCount))} disabled={running} className="justify-self-start gap-1.5" aria-label="Number of photos">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <rect x="4" y="4" width="7" height="7" rx="1.5" />
              <rect x="13" y="4" width="7" height="7" rx="1.5" />
              <rect x="4" y="13" width="7" height="7" rx="1.5" />
              <rect x="13" y="13" width="7" height="7" rx="1.5" />
            </svg>
            {shotCount}
          </Pill>
        )}
        <button
          onClick={manual ? tapToSnap : startSession}
          disabled={(running && (!manual || taken >= count)) || cameraState !== 'ready'}
          aria-label={manual ? 'Take photo' : 'Start photobooth'}
          className="group grid h-20 w-20 place-items-center rounded-full bg-white ring-4 ring-pink-200 transition active:scale-95 disabled:ring-stone-200"
        >
          <span
            className={`h-16 w-16 rounded-full bg-pink-500 transition-all duration-300 ${
              running && !manual ? 'scale-50 rounded-xl' : 'group-disabled:bg-stone-300'
            }`}
          />
        </button>
        <Pill onClick={() => setDelay(cycle(TIMER_OPTIONS, delay))} disabled={running} className="justify-self-end gap-1.5" aria-label="Timer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2.5 2M10 2h4" />
          </svg>
          {manual ? 'Tap' : `${delay}s`}
        </Pill>
      </div>
      <p className="mt-3 text-center text-xs text-stone-400">
        {running && manual
          ? taken < count
            ? `Tap for photo ${taken + 1} of ${count}`
            : 'Smile!'
          : running
            ? 'Smile!'
            : cameraState !== 'ready'
              ? ' '
              : single
                ? 'Tap to retake this photo'
                : manual
                  ? 'Tap the button for each photo'
                  : 'Tap to start'}
      </p>
    </div>
  )
}
