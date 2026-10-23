// Booth sounds, synthesized with Web Audio so there are no files to load.
// The first call must happen inside a tap, or browsers keep the audio locked.

let ctx

function audio() {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

// A short countdown tick; `last` plays a higher note for the final second.
export function beep(last = false) {
  const ac = audio()
  const t = ac.currentTime
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.frequency.value = last ? 1320 : 880
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
  osc.connect(gain).connect(ac.destination)
  osc.start(t)
  osc.stop(t + 0.16)
}

// A camera shutter: two quick bursts of filtered noise.
export function shutter() {
  const ac = audio()
  const length = Math.floor(ac.sampleRate * 0.06)
  const buffer = ac.createBuffer(1, length, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2

  for (const offset of [0, 0.07]) {
    const t = ac.currentTime + offset
    const source = ac.createBufferSource()
    const filter = ac.createBiquadFilter()
    const gain = ac.createGain()
    source.buffer = buffer
    filter.type = 'bandpass'
    filter.frequency.value = offset ? 2500 : 4000
    gain.gain.value = 0.6
    source.connect(filter).connect(gain).connect(ac.destination)
    source.start(t)
  }
}
