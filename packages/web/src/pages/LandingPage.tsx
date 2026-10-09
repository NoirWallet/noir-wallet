import { Navbar } from '../landing-components/Navbar'
import { Hero } from '../landing-components/Hero'
import { Features } from '../landing-components/Features'
import { HowItWorks } from '../landing-components/HowItWorks'
import { FutureVision } from '../landing-components/FutureVision'
import { CTA } from '../landing-components/CTA'
import { Footer } from '../landing-components/Footer'
import { ScrollIndicator } from '../landing-components/ScrollIndicator'

export function LandingPage() {
  return (
    <div className="min-h-screen bg-bg">
      <ScrollIndicator />
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <FutureVision />
      <CTA />
      <Footer />
    </div>
  )
}
