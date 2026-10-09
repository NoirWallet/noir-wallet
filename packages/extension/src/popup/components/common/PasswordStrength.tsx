import { useMemo } from 'react'
import { WALLET_CONFIG } from '@/config/wallet'

interface PasswordStrengthProps {
  password: string
}

type Strength = 'Too Weak' | 'Weak' | 'Medium' | 'Strong'

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const { strength, score } = useMemo(() => {
    let score = 0

    const minLen = WALLET_CONFIG.SECURITY.MIN_PASSWORD_LENGTH
    if (password.length >= minLen) score++
    if (password.length >= minLen + 4) score++
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
    if (/\d/.test(password)) score++
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score++

    let strength: Strength
    if (score <= 1) strength = 'Too Weak'
    else if (score === 2) strength = 'Weak'
    else if (score === 3) strength = 'Medium'
    else strength = 'Strong'

    return { strength, score }
  }, [password])

  const strengthColors = {
    'Too Weak': 'bg-danger',
    Weak: 'bg-orange-500',
    Medium: 'bg-yellow-500',
    Strong: 'bg-success'
  }

  const maxBars = 4
  const filledBars = Math.min(score, maxBars)

  if (!password) return null

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {Array.from({ length: maxBars }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
              i < filledBars ? strengthColors[strength] : 'bg-white/20'
            }`}
          />
        ))}
      </div>
      <p className="text-xs text-default-500">{strength}</p>
    </div>
  )
}
