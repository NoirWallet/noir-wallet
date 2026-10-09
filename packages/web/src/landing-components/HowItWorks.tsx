import { useEffect, useRef, useState } from 'react'

const steps = [
  { number: '1', title: 'Onboard', description: 'Create or import your Zcash vault.' },
  { number: '2', title: 'Manage', description: 'Send, receive, and monitor ZEC.' },
  { number: '3', title: 'Earn', description: 'Deposit to Rhea for passive yield.' },
  { number: '4', title: 'Borrow', description: 'Unlock liquidity without selling.' },
  { number: '5', title: 'Swap', description: 'Atomic exchange between ZEC and EVM.' }
]

export function HowItWorks() {
  const sectionRef = useRef<HTMLElement>(null)
  const [lineProgress, setLineProgress] = useState(0)
  const [activeStep, setActiveStep] = useState(0)

  useEffect(() => {
    const onScroll = () => {
      const el = sectionRef.current
      if (!el) return

      const rect = el.getBoundingClientRect()
      const vh = window.innerHeight

      const sectionTop = rect.top
      const sectionHeight = rect.height
      const enterOffset = vh * 0.6

      const scrolled = enterOffset - sectionTop
      const totalRange = sectionHeight + enterOffset - vh * 0.3
      const progress = Math.max(0, Math.min(1, scrolled / totalRange))

      setLineProgress(progress)
      setActiveStep(Math.min(steps.length - 1, Math.floor(progress * steps.length)))
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <section
      ref={sectionRef}
      id="workflow"
      className="relative mx-auto max-w-[1440px] px-5 pt-[120px] md:px-[60px] md:pt-[220px] xl:px-[120px]"
    >
      <h2 className="font-serif text-[28px] font-medium tracking-[0.06em] text-white md:text-[40px]">
        How It Works?
      </h2>

      <div className="relative mt-10 flex md:mt-[77px]">
        {/* Timeline rail */}
        <div className="absolute left-[18px] top-0 h-full w-px md:left-[25px]">
          <div
            className="absolute inset-0"
            style={{
              background: `repeating-linear-gradient(
                to bottom,
                transparent,
                transparent 2px,
                rgba(255, 255, 255, 0.15) 2px,
                rgba(255, 255, 255, 0.15) 4px
              )`
            }}
          />
          <div
            className="absolute left-0 top-0 w-full origin-top"
            style={{
              height: `${lineProgress * 100}%`,
              background: 'linear-gradient(to bottom, #00F7A5, #00D18A)',
              boxShadow: '0 0 8px rgba(0, 247, 165, 0.5)',
              transition: 'height 0.15s linear'
            }}
          />
        </div>

        <div className="flex w-full flex-col gap-8 md:gap-[50px]">
          {steps.map((step, i) => {
            const isActive = i <= activeStep
            const isCurrent = i === activeStep

            return (
              <div
                key={step.number}
                className="flex items-center gap-4 md:gap-[29px]"
                style={{
                  opacity: isActive ? 1 : 0.4,
                  transform: isCurrent ? 'translateX(4px)' : 'translateX(0)',
                  transition: 'opacity 0.5s ease, transform 0.5s cubic-bezier(0.16,1,0.3,1)'
                }}
              >
                <div
                  className="relative z-10 flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full border bg-card md:h-[50px] md:w-[50px]"
                  style={{
                    borderColor: isActive ? '#00F7A5' : '#44444C',
                    boxShadow: isCurrent ? '0 0 16px rgba(0,247,165,0.35)' : 'none',
                    transition: 'border-color 0.5s ease, box-shadow 0.5s ease'
                  }}
                >
                  <span
                    className="text-base font-normal tracking-[0.08em] md:text-[22px]"
                    style={{
                      color: isActive ? '#00F7A5' : '#FFFFFF',
                      transition: 'color 0.5s ease'
                    }}
                  >
                    {step.number}
                  </span>
                </div>

                <div
                  className="flex min-h-[72px] flex-1 flex-col justify-center rounded-[14px] border px-4 py-3 md:h-[93px] md:px-6"
                  style={{
                    borderColor: isCurrent
                      ? '#FFFFFF'
                      : isActive
                        ? 'rgba(0,247,165,0.3)'
                        : 'rgba(255,255,255,0.2)',
                    backgroundColor: '#15151F',
                    boxShadow: isCurrent ? '0 0 20px rgba(0,247,165,0.1)' : 'none',
                    transition: 'border-color 0.5s ease, box-shadow 0.5s ease'
                  }}
                >
                  <h4
                    className="text-base tracking-[0.08em] md:text-[22px]"
                    style={{
                      fontWeight: isCurrent ? 500 : 400,
                      color: isCurrent ? '#00F7A5' : isActive ? '#FFFFFF' : 'rgba(255,255,255,0.5)',
                      transition: 'color 0.5s ease'
                    }}
                  >
                    {step.title}
                  </h4>
                  <p
                    className="mt-0.5 text-xs font-light tracking-[0.04em] md:mt-1 md:text-sm"
                    style={{
                      color: isActive ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)',
                      transition: 'color 0.5s ease'
                    }}
                  >
                    {step.description}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
