export function Pill({ active, className = '', ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition active:scale-95 disabled:opacity-40 ${
        active ? 'bg-sky-500 text-white' : 'bg-stone-100 text-stone-600'
      } ${className}`}
    />
  )
}
