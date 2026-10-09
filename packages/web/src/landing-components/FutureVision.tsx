import { useRef, useEffect, useState } from 'react'

const visionCards = [
  {
    title: 'Universal Connectivity',
    description: (
      <>
        Native support for <span className="text-white">EVM</span>,{' '}
        <span className="text-white">Solana</span>, and <span className="text-white">Bitcoin</span>.
      </>
    ),
    imageSrc: '/images/vision-card-1.png'
  },
  {
    title: 'Shielded Cross-Chain Swaps',
    description: 'Private swaps across chains with shielded liquidity.',
    imageSrc: '/images/vision-card-2.png'
  },
  {
    title: 'Encrypted Yield Protocols',
    description: 'Lend, borrow, and earn privately across major chains.',
    imageSrc: '/images/vision-card-3.png'
  }
]

export function FutureVision() {
  const containerRef = useRef<HTMLElement>(null)
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    const onScroll = () => {
      const el = containerRef.current
      if (!el) return

      const rect = el.getBoundingClientRect()
      const scrolled = -rect.top
      const cardHeight = 320
      const idx = Math.max(0, Math.min(visionCards.length - 1, Math.floor(scrolled / cardHeight)))
      setActiveIdx(idx)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const totalScrollHeight = visionCards.length * 320

  return (
    <section
      id="roadmap"
      ref={containerRef}
      className="relative mx-auto max-w-[1440px] px-5 pt-[120px] md:px-8 md:pt-[220px] lg:px-[60px] xl:px-[120px]"
      style={{ minHeight: totalScrollHeight + 100 }}
    >
      {/* Desktop: side-by-side */}
      <div className="hidden md:grid md:grid-cols-[1fr_420px] md:gap-10">
        <div className="sticky top-[120px] self-start" style={{ height: 'fit-content' }}>
          <span className="text-base font-normal tracking-[0.04em] text-primary-light">
            Future Vision
          </span>

          <h2 className="mt-3 font-serif text-[40px] font-medium leading-[1.2] tracking-[0.06em] text-white">
            Zcash as the First
            <br />
            Privacy DeFi at Its Core
          </h2>

          <p className="mt-5 max-w-[500px] text-base font-normal tracking-[0.04em] text-white/60">
            Zcash at the core — private asset management and lending across every chain.
          </p>

          <div className="mt-12 flex items-center gap-3">
            {visionCards.map((_, i) => (
              <div
                key={i}
                className="h-2 rounded-full transition-all duration-500"
                style={{
                  width: i === activeIdx ? 32 : 8,
                  backgroundColor: i === activeIdx ? '#00F7A5' : 'rgba(255,255,255,0.2)'
                }}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          {visionCards.map((card, i) => (
            <VisionCard key={i} card={card} isActive={i === activeIdx} />
          ))}
        </div>
      </div>

      {/* Mobile: stacked */}
      <div className="md:hidden">
        <span className="text-sm font-normal tracking-[0.04em] text-primary-light">
          Future Vision
        </span>

        <h2 className="mt-2 font-serif text-[28px] font-medium leading-[1.2] tracking-[0.06em] text-white">
          Zcash as the First Privacy DeFi at Its Core
        </h2>

        <p className="mt-3 text-sm font-normal tracking-[0.04em] text-white/60">
          Zcash at the core — private asset management and lending across every chain.
        </p>

        <div className="mt-3 flex items-center gap-2">
          {visionCards.map((_, i) => (
            <div
              key={i}
              className="h-1.5 rounded-full transition-all duration-500"
              style={{
                width: i === activeIdx ? 24 : 6,
                backgroundColor: i === activeIdx ? '#00F7A5' : 'rgba(255,255,255,0.2)'
              }}
            />
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-4">
          {visionCards.map((card, i) => (
            <VisionCard key={i} card={card} isActive={i === activeIdx} mobile />
          ))}
        </div>
      </div>
    </section>
  )
}

function VisionCard({
  card,
  isActive,
  mobile
}: {
  card: (typeof visionCards)[number]
  isActive: boolean
  mobile?: boolean
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-border bg-[#151520] transition-all duration-700 ${
        mobile ? 'h-[250px]' : 'h-[270px]'
      }`}
      style={{
        transform: `scale(${isActive ? 1 : 0.97})`,
        borderColor: isActive ? 'rgba(0,247,165,0.35)' : undefined,
        boxShadow: isActive ? '0 0 40px rgba(0,247,165,0.1)' : 'none'
      }}
    >
      <img
        src={card.imageSrc}
        alt={card.title}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-linear-to-b from-[#151520]/70 via-[#151520]/40 to-transparent" />
      <div className={`absolute inset-x-0 top-0 ${mobile ? 'p-5' : 'p-[30px]'}`}>
        <h4
          className={`font-semibold tracking-[0.04em] text-white ${mobile ? 'text-lg' : 'text-[22px]'}`}
        >
          {card.title}
        </h4>
        <p
          className={`mt-1.5 font-normal tracking-[0.04em] text-white/60 ${mobile ? 'text-xs' : 'mt-2 text-sm'}`}
        >
          {card.description}
        </p>
      </div>
    </div>
  )
}
