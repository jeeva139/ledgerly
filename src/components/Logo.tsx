/** The Ledgerly mark: an L-shaped ledger spine with three rising bars. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" role="img" aria-label="Ledgerly">
      <rect x="8" y="8" width="240" height="240" rx="58" fill="#6558D3" />
      <path d="M78 62a12 12 0 0 1 24 0v94h84a12 12 0 0 1 0 24H90a12 12 0 0 1-12-12V62z" fill="#FFFFFF" />
      <rect x="122" y="124" width="16" height="20" rx="4" fill="#D6D1F8" />
      <rect x="148" y="104" width="16" height="40" rx="4" fill="#D6D1F8" />
      <rect x="174" y="80" width="16" height="64" rx="4" fill="#FFFFFF" />
    </svg>
  )
}
