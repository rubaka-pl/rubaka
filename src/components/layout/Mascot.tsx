/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useState } from 'react'
import { useLocation } from 'react-router'
import { useSettings } from '@/features/settings/settings-store'
import { assetUrl } from '@/lib/supabase'
import { cn } from '@/lib/utils'

/**
 * Sidebar mascot (desktop only): an original dancing chibi drawn in SVG with a
 * transparent background, or one of the owner's own GIFs / animated WebPs
 * from Settings → Appearance — a different random one after every navigation.
 * Click her for a spin. Still for reduced motion.
 */
export function Mascot({ className }: { className?: string }) {
  const s = useSettings()
  const location = useLocation()
  const [spin, setSpin] = useState(0)
  if (s.mascot === 'off') return null
  // location.key is a fresh random id on every navigation: hash it to pick one.
  const paths = s.mascotPaths
  const pick = paths.length ? paths[hash(location.key + spin) % paths.length] : null
  const custom = s.mascot === 'custom' && pick ? assetUrl(pick) : null
  return (
    <button
      type="button"
      onClick={() => setSpin((n) => n + 1)}
      aria-label="Mascot — click to spin"
      title="♪"
      className={cn('group mx-auto block w-full max-w-[170px] cursor-pointer select-none px-3 focus-visible:outline-offset-2', className)}
    >
      <div key={spin} className={cn(spin > 0 && 'rbk-spin')}>
        {custom ? <img src={custom} alt="" className="mx-auto max-h-[190px] w-auto object-contain drop-shadow-[0_8px_14px_rgb(0_0_0/0.45)]" draggable={false} /> : <Dancer />}
      </div>
    </button>
  )
}

function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

const OUT = '#2a1f4a'
const SKIN = '#ffe6d8'

function Dancer() {
  return (
    <svg viewBox="0 0 120 170" className="rbk-dancer mx-auto h-auto w-full max-w-[150px] overflow-visible" aria-hidden>
      <defs>
        <linearGradient id="rbk-hair" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b9a2ff" />
          <stop offset="1" stopColor="#7556f0" />
        </linearGradient>
        <linearGradient id="rbk-eye" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c1d63" />
          <stop offset="1" stopColor="#9b7bff" />
        </linearGradient>
      </defs>

      {/* music notes */}
      <g fill="#b9a2ff" fontSize="13" fontWeight="700">
        <text className="rbk-note" x="10" y="60">♪</text>
        <text className="rbk-note rbk-d1" x="100" y="48">♫</text>
        <text className="rbk-note rbk-d2" x="98" y="96" fill="#ff7fae">♪</text>
      </g>

      <ellipse className="rbk-shadow" cx="60" cy="161" rx="22" ry="3.5" fill="#000" opacity=".35" />

      <g className="rbk-sway">
        <g className="rbk-bounce">
          {/* legs */}
          <g className="rbk-leg-l">
            <rect x="48.5" y="128" width="7" height="25" rx="3" fill={SKIN} stroke={OUT} strokeWidth="1.2" />
            <rect x="48.5" y="140" width="7" height="13" rx="2" fill="#fff" stroke={OUT} strokeWidth="1.2" />
            <ellipse cx="51.5" cy="155" rx="6" ry="3.2" fill={OUT} />
          </g>
          <g className="rbk-leg-r">
            <rect x="64.5" y="128" width="7" height="25" rx="3" fill={SKIN} stroke={OUT} strokeWidth="1.2" />
            <rect x="64.5" y="140" width="7" height="13" rx="2" fill="#fff" stroke={OUT} strokeWidth="1.2" />
            <ellipse cx="68.5" cy="155" rx="6" ry="3.2" fill={OUT} />
          </g>

          {/* skirt */}
          <g className="rbk-skirt">
            <path d="M44 112 L76 112 L85 133 Q60 138 35 133 Z" fill="#3b3f93" stroke={OUT} strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M52 113 L47 134 M60 113 L60 136 M68 113 L73 134" stroke="#262a6e" strokeWidth="1.1" />
          </g>

          {/* arms (behind torso edge) */}
          <g className="rbk-arm-l">
            <path d="M48 98 L37 114" stroke={OUT} strokeWidth="9" strokeLinecap="round" />
            <path d="M48 98 L37 114" stroke="#fff" strokeWidth="6.6" strokeLinecap="round" />
            <circle cx="36" cy="116.5" r="3.4" fill={SKIN} stroke={OUT} strokeWidth="1.2" />
          </g>
          <g className="rbk-arm-r">
            <path d="M72 98 L83 114" stroke={OUT} strokeWidth="9" strokeLinecap="round" />
            <path d="M72 98 L83 114" stroke="#fff" strokeWidth="6.6" strokeLinecap="round" />
            <circle cx="84" cy="116.5" r="3.4" fill={SKIN} stroke={OUT} strokeWidth="1.2" />
          </g>

          {/* neck + torso (sailor uniform) */}
          <rect x="56.5" y="80" width="7" height="14" fill={SKIN} stroke={OUT} strokeWidth="1.1" />
          <path d="M46 97 Q60 90 74 97 L76 115 L44 115 Z" fill="#fff" stroke={OUT} strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M47 95.5 L60 106 L73 95.5 L75 101 L60 112 L45 101 Z" fill="#3b3f93" stroke={OUT} strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M60 106 L52 102 L53 111 Z M60 106 L68 102 L67 111 Z" fill="#ff5d8f" stroke={OUT} strokeWidth=".9" strokeLinejoin="round" />
          <circle cx="60" cy="106.5" r="2" fill="#ff5d8f" stroke={OUT} strokeWidth=".9" />

          {/* head */}
          <g className="rbk-head">
            {/* twin tails */}
            <g className="rbk-tail-l">
              <path d="M37 40 C20 46 14 70 19 92 C22 101 27 105 25 114 C34 106 37 92 33 79 C30 66 34 54 42 46 Z" fill="url(#rbk-hair)" stroke={OUT} strokeWidth="1.3" strokeLinejoin="round" />
            </g>
            <g className="rbk-tail-r">
              <path d="M83 40 C100 46 106 70 101 92 C98 101 93 105 95 114 C86 106 83 92 87 79 C90 66 86 54 78 46 Z" fill="url(#rbk-hair)" stroke={OUT} strokeWidth="1.3" strokeLinejoin="round" />
            </g>
            {/* back hair */}
            <path d="M60 25 C31 25 29 50 31 70 C32 81 36 88 40 91 L80 91 C84 88 88 81 89 70 C91 50 89 25 60 25 Z" fill="url(#rbk-hair)" stroke={OUT} strokeWidth="1.3" />
            {/* face */}
            <ellipse cx="60" cy="60" rx="24.5" ry="22.5" fill={SKIN} stroke={OUT} strokeWidth="1.3" />
            {/* eyes */}
            <g className="rbk-eyes">
              <path d="M45.2 58.6 Q51 54.8 56.6 58.4" fill="none" stroke={OUT} strokeWidth="2.4" strokeLinecap="round" />
              <ellipse cx="51" cy="64.5" rx="4.6" ry="6" fill="url(#rbk-eye)" stroke={OUT} strokeWidth="1.1" />
              <circle cx="49.4" cy="62" r="1.7" fill="#fff" />
              <circle cx="52.6" cy="67.4" r=".8" fill="#fff" />
              <path d="M63.4 58.4 Q69 54.8 74.8 58.6" fill="none" stroke={OUT} strokeWidth="2.4" strokeLinecap="round" />
              <ellipse cx="69" cy="64.5" rx="4.6" ry="6" fill="url(#rbk-eye)" stroke={OUT} strokeWidth="1.1" />
              <circle cx="67.4" cy="62" r="1.7" fill="#fff" />
              <circle cx="70.6" cy="67.4" r=".8" fill="#fff" />
            </g>
            <ellipse cx="44.5" cy="71.5" rx="4" ry="2" fill="#ff8fb0" opacity=".55" />
            <ellipse cx="75.5" cy="71.5" rx="4" ry="2" fill="#ff8fb0" opacity=".55" />
            <path d="M56.6 72.4 Q60 77.6 63.4 72.4 Z" fill="#d9536f" stroke={OUT} strokeWidth=".9" strokeLinejoin="round" />
            {/* bangs + side locks */}
            <path d="M35.5 60 C34 39 46 30 60 30 C74 30 86 39 84.5 60 L80 50 L76.5 59 L71.5 45.5 L66.5 56 L60 43.5 L53.5 56 L48.5 45.5 L43.5 59 L40 50 Z" fill="url(#rbk-hair)" stroke={OUT} strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M36.5 55 C34.5 67 36.5 77 41 84 L42.5 66 Z M83.5 55 C85.5 67 83.5 77 79 84 L77.5 66 Z" fill="url(#rbk-hair)" stroke={OUT} strokeWidth="1.1" strokeLinejoin="round" />
            {/* hair ties + star clip */}
            <circle cx="37" cy="42" r="3.4" fill="#ff5d8f" stroke={OUT} strokeWidth="1" />
            <circle cx="83" cy="42" r="3.4" fill="#ff5d8f" stroke={OUT} strokeWidth="1" />
            <path d="M74 34 l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="#ffd34d" stroke={OUT} strokeWidth=".8" strokeLinejoin="round" />
          </g>
        </g>
      </g>

      <style>{`
        .rbk-dancer * { transform-box: view-box; }
        .rbk-sway { transform-origin: 60px 158px; animation: rbk-sway 1s ease-in-out infinite alternate; }
        .rbk-bounce { animation: rbk-bounce .5s ease-in-out infinite; }
        .rbk-head { transform-origin: 60px 86px; animation: rbk-head 1s ease-in-out infinite alternate-reverse; }
        .rbk-tail-l { transform-origin: 37px 42px; animation: rbk-tail 1s ease-in-out infinite alternate; }
        .rbk-tail-r { transform-origin: 83px 42px; animation: rbk-tail 1s ease-in-out infinite alternate-reverse; }
        .rbk-arm-l { transform-origin: 48px 98px; animation: rbk-arm-l 1s ease-in-out infinite; }
        .rbk-arm-r { transform-origin: 72px 98px; animation: rbk-arm-r 1s ease-in-out infinite; animation-delay: -.5s; }
        .rbk-leg-l { transform-origin: 52px 128px; animation: rbk-leg 1s ease-in-out infinite; }
        .rbk-leg-r { transform-origin: 68px 128px; animation: rbk-leg-r 1s ease-in-out infinite; animation-delay: -.5s; }
        .rbk-skirt { transform-origin: 60px 112px; animation: rbk-skirt .5s ease-in-out infinite; }
        .rbk-eyes { transform-origin: 60px 64px; animation: rbk-blink 4s infinite; }
        .rbk-shadow { transform-origin: 60px 161px; animation: rbk-shadow .5s ease-in-out infinite; }
        .rbk-note { opacity: 0; animation: rbk-note 2.4s ease-out infinite; }
        .rbk-d1 { animation-delay: -.8s; } .rbk-d2 { animation-delay: -1.6s; }
        @keyframes rbk-sway { from { transform: rotate(-5deg); } to { transform: rotate(5deg); } }
        @keyframes rbk-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
        @keyframes rbk-head { from { transform: rotate(-7deg); } to { transform: rotate(7deg); } }
        @keyframes rbk-tail { from { transform: rotate(-9deg); } to { transform: rotate(9deg); } }
        @keyframes rbk-arm-l { 0%, 100% { transform: rotate(15deg); } 50% { transform: rotate(-150deg); } }
        @keyframes rbk-arm-r { 0%, 100% { transform: rotate(-15deg); } 50% { transform: rotate(150deg); } }
        @keyframes rbk-leg { 0%, 50%, 100% { transform: rotate(0); } 25% { transform: translateY(-3px) rotate(14deg); } }
        @keyframes rbk-leg-r { 0%, 50%, 100% { transform: rotate(0); } 25% { transform: translateY(-3px) rotate(-14deg); } }
        @keyframes rbk-skirt { 0%, 100% { transform: scaleX(1); } 50% { transform: scaleX(1.06); } }
        @keyframes rbk-blink { 0%, 93%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
        @keyframes rbk-shadow { 0%, 100% { transform: scaleX(1); opacity: .35; } 50% { transform: scaleX(.8); opacity: .22; } }
        @keyframes rbk-note { 0% { opacity: 0; transform: translateY(6px); } 20% { opacity: 1; } 100% { opacity: 0; transform: translateY(-26px) rotate(12deg); } }
        @media (prefers-reduced-motion: reduce) { .rbk-dancer * { animation: none !important; } .rbk-note { opacity: .8; } }
      `}</style>
    </svg>
  )
}
