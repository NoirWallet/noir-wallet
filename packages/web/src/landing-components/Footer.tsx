import { externalLinks } from './Navbar'

export function Footer() {
  const currentYear = new Date().getFullYear()
  return (
    <footer className="px-5 pb-8 pt-[100px] text-center md:pb-[42px] md:pt-[180px]">
      <p className="text-sm font-medium text-footer md:text-base">
        © {currentYear} Noir Privacy Terminal. All rights reserved.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2 sm:hidden">
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
    </footer>
  )
}
