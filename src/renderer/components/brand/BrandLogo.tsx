import { useId } from 'react'

interface BrandLogoProps {
  size?: number
  className?: string
}

export default function BrandLogo({ size = 24, className = '' }: BrandLogoProps) {
  const id = useId().replace(/:/g, '')
  const gradientId = `prismops-flow-${id}`
  const glowId = `prismops-glow-${id}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="PrismOps"
      className={className}
    >
      <defs>
        <linearGradient id={gradientId} x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4FD8FF" />
          <stop offset="0.52" stopColor="#8B7CFF" />
          <stop offset="1" stopColor="#FFD166" />
        </linearGradient>
        <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect x="3" y="3" width="42" height="42" rx="11" fill="#0A111D" />
      <rect x="3.5" y="3.5" width="41" height="41" rx="10.5" fill="none" stroke="#253448" />
      <path
        d="M16 13.5L32 13.5L22 24L32 34.5L16 34.5L26 24L16 13.5Z"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="4.2"
        strokeLinejoin="round"
        strokeLinecap="round"
        filter={`url(#${glowId})`}
      />
      <path
        d="M15 24H9.5M38.5 24H33M24 9.5V14.5M24 33.5V38.5"
        stroke="#6ECFFF"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.72"
      />
      <circle cx="9.5" cy="24" r="2.6" fill="#4FD8FF" />
      <circle cx="38.5" cy="24" r="2.6" fill="#FFD166" />
      <circle cx="24" cy="9.5" r="2.2" fill="#8B7CFF" />
      <circle cx="24" cy="38.5" r="2.2" fill="#8B7CFF" />
    </svg>
  )
}
