import { useEffect, useState } from 'react'

const socialLinks = [
  {
    href: __WALLET_REPOSITORY_URL__,
    label: 'GitHub',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.36-3.9-1.36-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18A10.96 10.96 0 0 1 12 6.11c.98 0 1.95.13 2.87.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.28 5.68.42.36.79 1.06.79 2.14v3.26c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
      </svg>
    )
  },
  {
    href: 'https://x.com/noir_wallet',
    label: 'X',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    )
  },
  {
    href: 'https://t.me/noirprivacy',
    label: 'Telegram',
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M22 2 11 13" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m22 2-7 20-4-9-9-4Z" />
      </svg>
    )
  }
]

export const externalLinks = socialLinks

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const updateScrolledState = () => setIsScrolled(window.scrollY > 20)

    updateScrolledState()
    window.addEventListener('scroll', updateScrolledState, { passive: true })
    return () => window.removeEventListener('scroll', updateScrolledState)
  }, [])

  return (
    <nav className="pointer-events-none sticky top-0 z-50 h-[72px] md:h-[99px]">
      <div
        className={`mx-auto max-w-[1440px] transition-[padding] duration-300 ease-out motion-reduce:transition-none ${
          isScrolled ? 'px-3 pt-2 md:px-5 md:pt-2.5' : 'px-4 pt-4 md:px-[28px] md:pt-[26px]'
        }`}
      >
        <div
          className={`pointer-events-auto relative flex items-center overflow-visible border px-4 transition-[height,background-color,border-color,box-shadow,border-radius] duration-300 ease-out motion-reduce:transition-none md:px-6 ${
            isScrolled
              ? 'h-[52px] rounded-[18px] border-white/15 bg-[#12121c]/85 shadow-[0_14px_45px_rgba(0,0,0,0.38),0_0_0_1px_rgba(0,209,138,0.05)] backdrop-blur-xl md:h-[62px]'
              : 'h-[56px] rounded-2xl border-transparent bg-bg md:h-[73px]'
          }`}
        >
          <div className="flex items-center gap-2 md:gap-3">
            <img
              src="/images/logo.png"
              alt="Noir Wallet"
              className="h-7 w-[30px] object-contain md:h-9 md:w-[38px]"
            />
            <span className="font-serif text-[20px] leading-none md:text-[26px]">
              <span className="font-light text-white">Noir </span>
              <span className="font-light text-primary">Wallet</span>
            </span>
          </div>

          <div className="hidden items-center gap-5 overflow-visible lg:absolute lg:left-1/2 lg:flex lg:-translate-x-1/2 xl:gap-[43px]">
            <a
              href="#features"
              className="text-[15px] font-medium tracking-[0.05em] text-white transition-opacity hover:opacity-80"
            >
              Features
            </a>
            <a
              href="#workflow"
              className="text-[15px] font-medium tracking-[0.05em] text-white transition-opacity hover:opacity-80"
            >
              Workflow
            </a>
            <a
              href="#roadmap"
              className="text-[15px] font-medium tracking-[0.05em] text-white transition-opacity hover:opacity-80"
            >
              Roadmap
            </a>
            <a
              href="https://docs.zknoir.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[15px] font-medium tracking-[0.05em] text-white transition-opacity hover:opacity-80"
            >
              Docs
            </a>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              {externalLinks.map(link => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={link.label}
                  title={link.label}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-card text-white transition-colors hover:bg-white/10"
                >
                  {link.icon}
                </a>
              ))}
            </div>
            <a
              href="https://chromewebstore.google.com/detail/noir-wallet/mfoghjbpfanobmnoemoepenjjcmfpmdn"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-[36px] items-center rounded-[14px] bg-primary px-4 text-xs font-normal tracking-wider text-black transition-opacity hover:opacity-80 md:h-[42px] md:px-6 md:text-sm"
            >
              Install Wallet
            </a>
          </div>
        </div>
      </div>
    </nav>
  )
}
