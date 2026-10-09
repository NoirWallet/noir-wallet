import { useEffect, useState } from 'react'

const sections = [
  { id: 'hero', label: 'Hero' },
  { id: 'features', label: 'Features' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'roadmap', label: 'Roadmap' },
  { id: 'cta', label: 'CTA' }
]

export function ScrollIndicator() {
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    const onScroll = () => {
      const vh = window.innerHeight
      const midY = vh * 0.4

      let best = 0
      let bestDist = Infinity

      sections.forEach((s, i) => {
        const el = document.getElementById(s.id)
        if (!el) return
        const rect = el.getBoundingClientRect()
        const dist = Math.abs(rect.top - midY)
        if (dist < bestDist) {
          bestDist = dist
          best = i
        }
      })

      setActiveIdx(best)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const handleClick = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="fixed right-8 top-1/2 z-50 hidden -translate-y-1/2 md:flex">
      <div className="flex flex-col items-center gap-3.5 rounded-[54px] border border-border bg-card px-3.5 py-4">
        {sections.map((s, i) => (
          <button
            key={s.id}
            onClick={() => handleClick(s.id)}
            className="block cursor-pointer rounded-full transition-all duration-300"
            style={{
              width: 6,
              height: i === activeIdx ? 32 : 6,
              backgroundColor: i === activeIdx ? '#FFFFFF' : 'rgba(255,255,255,0.5)'
            }}
            aria-label={s.label}
          />
        ))}
      </div>
    </div>
  )
}
