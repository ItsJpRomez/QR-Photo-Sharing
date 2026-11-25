import { cx } from '@/features/ui/cx'

// Small pictures of a party, standing in for guests' photos.
const SCENES: { bg: string; art: React.ReactNode }[] = [
  {
    bg: '#2b1b3d',
    art: (
      <>
        <path d="M0 22Q25 46 50 26T100 20" fill="none" stroke="#8d829f" strokeWidth="1.5" />
        {[10, 27, 45, 64, 84].map((x, i) => (
          <circle key={x} cx={x} cy={[31, 37, 31, 24, 23][i]} r="5" fill="#ffd84d" />
        ))}
        <path d="M0 100V74l14-10 16 8 18-14 20 12 14-8 18 10v28z" fill="#5b4a78" />
      </>
    ),
  },
  {
    bg: '#f2b5a7',
    art: (
      <>
        <rect x="22" y="58" width="56" height="26" rx="3" fill="#fff" />
        <rect x="32" y="36" width="36" height="24" rx="3" fill="#fbe3dc" />
        <path d="M22 66q7 8 14 0t14 0 14 0 14 0v-8H22z" fill="#c4446a" />
        <path d="M50 22v14" stroke="#2b1b3d" strokeWidth="3" />
        <circle cx="50" cy="20" r="5" fill="#ffd84d" />
      </>
    ),
  },
  {
    bg: '#2c6e63',
    art: (
      <>
        <path d="M24 24h20l-4 30h-12zM34 54v22M26 78h16" fill="#ffe9a8" stroke="#ffe9a8" strokeWidth="3" />
        <path d="M58 20h20l-4 30H62zM68 50v26M60 78h16" fill="#fff" stroke="#fff" strokeWidth="3" />
        <path d="M50 14v8M42 18l4 5M58 18l-4 5" stroke="#ffd84d" strokeWidth="3" strokeLinecap="round" />
      </>
    ),
  },
  {
    bg: '#ffd84d',
    art: (
      <>
        <path d="M50 0v22" stroke="#2b1b3d" strokeWidth="2" />
        <circle cx="50" cy="48" r="27" fill="#cfd8e6" />
        <path d="M24 40h52M23 48h54M24 56h52M29 32h42M29 64h42M50 21v54M41 22q-10 26 0 52M59 22q10 26 0 52M33 28q-12 20 0 40M67 28q12 20 0 40" stroke="#7d8ba3" strokeWidth="1.4" fill="none" />
        <path d="M36 36h7v6h-7zM56 50h7v5h-7zM46 62h6v5h-6z" fill="#fff" />
      </>
    ),
  },
  {
    bg: '#5b8fd6',
    art: (
      <>
        <ellipse cx="34" cy="38" rx="15" ry="19" fill="#c4446a" />
        <ellipse cx="62" cy="30" rx="15" ry="19" fill="#ffd84d" />
        <path d="M34 57q4 20-2 43M62 49q-6 26 2 51" stroke="#fff" strokeWidth="2" fill="none" />
      </>
    ),
  },
  {
    bg: '#8f3f71',
    art: (
      <>
        <path d="M50 62v38M44 66l-10 34M56 66l10 34" stroke="#9ad1a5" strokeWidth="4" />
        {[
          [36, 44, '#fff'],
          [64, 44, '#ffd84d'],
          [50, 30, '#f2b5a7'],
          [50, 54, '#fff'],
        ].map(([cx, cy, fill]) => (
          <circle key={`${cx}${cy}`} cx={cx} cy={cy} r="14" fill={fill as string} stroke="#8f3f71" strokeWidth="2" />
        ))}
      </>
    ),
  },
]

/** The gallery filling up, one flash at a time. */
export function Scenes() {
  return (
    <div aria-hidden className="grid grid-cols-3 gap-[3px]">
      {SCENES.map((s, i) => (
        <div key={s.bg} className={cx('relative aspect-square overflow-hidden', 'scene')} style={{ animationDelay: `${i * 260}ms`, background: s.bg }}>
          <svg viewBox="0 0 100 100" className="size-full">
            {s.art}
          </svg>
          <span className="camera-flash absolute inset-0" style={{ animationDelay: `${i * 260}ms` }} />
        </div>
      ))}
    </div>
  )
}
