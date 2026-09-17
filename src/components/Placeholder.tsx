type PlaceholderProps = {
  label: string
  hint?: string
  className?: string
  aspect?: 'video' | 'square' | 'wide' | 'tall'
}

const aspectClass = {
  video: 'aspect-video',
  square: 'aspect-square',
  wide: 'aspect-[21/9]',
  tall: 'aspect-[3/4]',
}

export function Placeholder({
  label,
  hint,
  className = '',
  aspect = 'video',
}: PlaceholderProps) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center gap-2 border border-dashed border-line bg-sand/60 text-center text-ink-muted',
        aspectClass[aspect],
        className,
      ].join(' ')}
    >
      <p className="px-4 text-sm font-medium tracking-wide uppercase">{label}</p>
      {hint ? <p className="max-w-sm px-4 text-sm normal-case tracking-normal">{hint}</p> : null}
    </div>
  )
}
