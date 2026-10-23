import { drawOutline, getPersonField } from './outline'

export const FILTERS = [
  { id: 'none', name: 'Normal', css: 'none' },
  { id: 'bw', name: 'B&W', css: 'grayscale(1) contrast(1.1)' },
  { id: 'vintage', name: 'Vintage', css: 'sepia(0.6) contrast(1.05) brightness(1.05)' },
  { id: 'warm', name: 'Warm', css: 'saturate(1.3) hue-rotate(-10deg) brightness(1.05)' },
  { id: 'cool', name: 'Cool', css: 'saturate(1.1) hue-rotate(15deg) brightness(1.02)' },
  { id: 'vivid', name: 'Vivid', css: 'saturate(1.6) contrast(1.15)' },
  { id: 'fade', name: 'Fade', css: 'contrast(0.85) brightness(1.1) saturate(0.8)' },
]

export const FRAMES = [
  { id: 'white', name: 'White', bg: '#ffffff', text: '#1c1917' },
  { id: 'black', name: 'Black', bg: '#1c1917', text: '#fafaf9' },
  { id: 'sky', name: 'Sky', bg: '#bae6fd', text: '#0c4a6e' },
  { id: 'blush', name: 'Blush', bg: '#fbcfe8', text: '#831843' },
  { id: 'cream', name: 'Cream', bg: '#fef3c7', text: '#78350f' },
  { id: 'mint', name: 'Mint', bg: '#bbf7d0', text: '#14532d' },
  { id: 'lavender', name: 'Lavender', bg: '#ddd6fe', text: '#4c1d95' },
]

export const TEXT_FONTS = [
  { id: 'serif', name: 'Serif', css: (size) => `700 ${size}px Fraunces, Georgia, serif` },
  { id: 'script', name: 'Script', css: (size) => `400 ${size}px "Great Vibes", cursive` },
  { id: 'sans', name: 'Sans', css: (size) => `600 ${size}px Inter, system-ui, sans-serif` },
]

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

// The CSS/canvas font for a sticker, shared by the editor preview and the export so they match.
export function stickerFont(sticker) {
  if (sticker.emoji) return `${sticker.size}px ${EMOJI_FONT}`
  return TEXT_FONTS.find((f) => f.id === sticker.font).css(sticker.size)
}

const PHOTO_RATIO = 1

// Grabs the current video frame, center-cropped to PHOTO_RATIO and zoomed; mirror matches the selfie preview.
export function captureFrame(video, filterCss, mirror, zoom = 1) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  let sw = vw
  let sh = vh
  if (vw / vh > PHOTO_RATIO) sw = vh * PHOTO_RATIO
  else sh = vw / PHOTO_RATIO
  sw /= zoom
  sh /= zoom

  const canvas = document.createElement('canvas')
  canvas.width = 900
  canvas.height = 900
  const ctx = canvas.getContext('2d')
  ctx.filter = filterCss
  if (mirror) {
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.92)
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// Composes the captured photos into a single strip/grid image. Returns its PNG data URL and pixel size.
// `date` (a Date, or null to hide it) is printed under the caption.
// `outline` ({ color, thickness } with thickness as a fraction of photo width) traces the person in each photo.
export async function renderStrip(photos, { layout, frame, caption, date, outline }) {
  const images = await Promise.all(photos.map(loadImage))
  const fields = outline ? await Promise.all(photos.map((src, i) => getPersonField(src, images[i]))) : []
  await document.fonts.load('700 48px Fraunces').catch(() => {})

  const cols = layout === 'grid' && images.length > 1 ? 2 : 1
  const rows = Math.ceil(images.length / cols)
  const pad = layout === 'grid' ? 40 : 32
  const gap = 20
  const width = layout === 'grid' ? 1240 : 640
  const photoW = (width - pad * 2 - gap * (cols - 1)) / cols
  const photoH = Math.round(photoW / PHOTO_RATIO)
  const footer = 150
  const height = pad + rows * photoH + (rows - 1) * gap + footer

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = frame.bg
  ctx.fillRect(0, 0, width, height)

  images.forEach((img, i) => {
    const x = pad + (i % cols) * (photoW + gap)
    const y = pad + Math.floor(i / cols) * (photoH + gap)
    ctx.drawImage(img, x, y, photoW, photoH)
    if (outline) {
      drawOutline(ctx, fields[i], x, y, Math.round(photoW), photoH, { color: outline.color, thickness: outline.thickness * photoW })
    }
  })

  const footerTop = height - footer
  ctx.fillStyle = frame.text
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const title = caption.trim() || 'KloveSnap'
  ctx.font = '700 44px Fraunces, Georgia, serif'
  ctx.fillText(title, width / 2, footerTop + (date ? 62 : footer / 2), width - pad * 2)

  if (date) {
    ctx.globalAlpha = 0.7
    ctx.font = '500 22px Inter, system-ui, sans-serif'
    ctx.fillText(date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }), width / 2, footerTop + 108)
    ctx.globalAlpha = 1
  }

  return { url: canvas.toDataURL('image/png'), width, height }
}

// Flattens the strip with the user's drawings and stickers into a single PNG data URL.
export async function exportStrip(strip, { strokes, stickers }) {
  const base = await loadImage(strip.url)
  await Promise.all(stickers.filter((s) => s.text).map((s) => document.fonts.load(stickerFont(s)).catch(() => {})))
  const canvas = document.createElement('canvas')
  canvas.width = strip.width
  canvas.height = strip.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(base, 0, 0)

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of strokes) {
    const [first, ...rest] = stroke.points
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.width
    ctx.beginPath()
    ctx.moveTo(...first)
    // A single tap still leaves a dot
    if (!rest.length) ctx.lineTo(first[0] + 0.01, first[1])
    rest.forEach((point) => ctx.lineTo(...point))
    ctx.stroke()
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const sticker of stickers) {
    ctx.save()
    ctx.translate(sticker.x, sticker.y)
    ctx.rotate((sticker.rotation * Math.PI) / 180)
    ctx.font = stickerFont(sticker)
    ctx.fillStyle = sticker.color ?? '#000'
    ctx.fillText(sticker.emoji ?? sticker.text, 0, 0)
    ctx.restore()
  }

  return canvas.toDataURL('image/png')
}
