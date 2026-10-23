import { useState } from 'react'
import Booth from './components/Booth'
import Review from './components/Review'

export default function App() {
  const [session, setSession] = useState(null) // { photos, takenAt }
  const [retakeIndex, setRetakeIndex] = useState(null)
  const retaking = retakeIndex !== null

  function replacePhoto([shot]) {
    setSession((s) => ({ ...s, photos: s.photos.map((p, i) => (i === retakeIndex ? shot : p)) }))
    setRetakeIndex(null)
  }

  return (
    <div className="flex min-h-dvh flex-col bg-white font-sans text-stone-800">
      <header className="pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] text-center sm:pb-4 sm:pt-6">
        <h1 className="font-sign text-2xl leading-tight sm:text-5xl">
          <span className="text-sky-500">K l o v e</span><span className="text-pink-500">S n a p</span>
        </h1>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {!session && <Booth onDone={(photos) => setSession({ photos, takenAt: new Date() })} />}
        {retaking && <Booth single onDone={replacePhoto} onCancel={() => setRetakeIndex(null)} />}
        {/* Review stays mounted (just hidden) while retaking one photo, so edits survive. */}
        {session && (
          <div className={`flex flex-1 flex-col ${retaking ? 'hidden' : ''}`}>
            <Review
              photos={session.photos}
              takenAt={session.takenAt}
              onRetake={() => setSession(null)}
              onRetakePhoto={setRetakeIndex}
            />
          </div>
        )}
      </main>
    </div>
  )
}
