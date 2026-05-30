import { stdout } from 'node:process'

// ── ANSI primitives ───────────────────────────────────────────────────
const R    = '\x1b[0m'
const B    = '\x1b[1m'
const HIDE = '\x1b[?25l'
const SHOW = '\x1b[?25h'
const CLR  = '\x1b[2K\r'
const GLITCH_CHARS = '░▒▓█▄▀■□▸▹◆◇'

const c = (n: number) => `\x1b[38;5;${n}m`   // 256-color fg

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
const up    = (n: number) => `\x1b[${n}A`

// ── Color palettes — monochromatic shades per hue ─────────────────────
interface Palette {
  base:  string   // borders & structure
  text:  string   // quote body
  faint: string   // author / secondary
  glow:  string   // bold accent for pulse effects
  rain:  string   // matrix rain char colour
}

const PALETTES: Palette[] = [
  // Cyan
  { base: c(51),  text: c(159), faint: c(30),  glow: B + c(87),  rain: c(37)  },
  // Green
  { base: c(82),  text: c(155), faint: c(22),  glow: B + c(118), rain: c(34)  },
  // Magenta / Pink
  { base: c(207), text: c(219), faint: c(96),  glow: B + c(213), rain: c(128) },
  // Yellow / Gold
  { base: c(220), text: c(229), faint: c(136), glow: B + c(226), rain: c(178) },
  // Sky Blue
  { base: c(75),  text: c(153), faint: c(25),  glow: B + c(81),  rain: c(39)  },
  // Orange
  { base: c(214), text: c(223), faint: c(130), glow: B + c(208), rain: c(172) },
]

// ── Quotes ────────────────────────────────────────────────────────────
interface Quote { text: string; author: string }

const QUOTES: Quote[] = [
  { text: 'The best code is no code at all.', author: 'Jeff Atwood' },
  { text: 'Programs must be written for people to read, and only incidentally for machines to execute.', author: 'Abelson & Sussman' },
  { text: 'Make it work, make it right, make it fast.', author: 'Kent Beck' },
  { text: 'Simplicity is the soul of efficiency.', author: 'Austin Freeman' },
  { text: 'Any fool can write code that a computer can understand. Good programmers write code that humans can understand.', author: 'Martin Fowler' },
  { text: 'First, solve the problem. Then, write the code.', author: 'John Johnson' },
  { text: "Code is like humor. When you have to explain it, it's bad.", author: 'Cory House' },
  { text: 'Before software can be reusable it first has to be usable.', author: 'Ralph Johnson' },
  { text: 'Clean code always looks like it was written by someone who cares.', author: 'Robert C. Martin' },
  { text: 'The most dangerous phrase is "we\'ve always done it this way".', author: 'Grace Hopper' },
  { text: 'Architecture is the decisions you wish you could get right early in a project.', author: 'Martin Fowler' },
  { text: 'The best error message is the one that never shows up.', author: 'Thomas Fuchs' },
  { text: 'It works on my machine.', author: 'Every developer, always' },
  { text: 'git blame yourself.', author: 'The terminal' },
  { text: 'There are only two hard things in CS: cache invalidation, naming things, and off-by-one errors.', author: 'Unknown' },
  { text: "Debugging: being the detective in a crime movie where you're also the murderer.", author: 'Unknown' },
  { text: 'The code you wrote six months ago was written by an idiot.', author: 'Unknown' },
  { text: 'sudo make me a sandwich.', author: 'xkcd' },
  { text: "I don't always test my code, but when I do, I do it in production.", author: 'Unknown' },
  { text: 'A QA engineer walks into a bar. Orders 0 beers. Orders 999999 beers. Orders NULL beers. Walks in through the window.', author: 'Unknown' },
  { text: 'To understand recursion, you must first understand recursion.', author: 'Unknown' },
  { text: 'The code review is the product.', author: 'diffing' },
  { text: "Your abstractions are just someone else's bugs.", author: 'Unknown' },
  { text: "Every rewrite is a confession that you didn't understand the problem the first time.", author: 'Unknown' },
  { text: 'The best PR is no PR — ship it in the design.', author: 'Unknown' },
  { text: "You don't own your code. Your code owns you.", author: 'Unknown' },
  { text: 'A diff is a conversation. What story does yours tell?', author: 'Unknown' },
  { text: "The senior engineer's superpower: knowing which shortcuts will haunt you.", author: 'Unknown' },
  { text: 'Production is the only real test environment.', author: 'Site Reliability truth' },
  { text: 'Tech debt is just deferred thinking.', author: 'Unknown' },
  { text: 'Comments lie. Code never does.', author: 'Ron Jeffries' },
]

// ── Box builder ───────────────────────────────────────────────────────
interface Box {
  textLines:  string[]
  authorStr:  string
  innerWidth: number
  pal:        Palette
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const word of words) {
    if (!cur) { cur = word; continue }
    if (cur.length + 1 + word.length <= width) cur += ' ' + word
    else { lines.push(cur); cur = word }
  }
  if (cur) lines.push(cur)
  return lines
}

function makeBox(quote: Quote, pal: Palette): Box {
  const termWidth = stdout.columns ?? 80
  const maxContent = Math.min(64, termWidth - 8)
  const fullText = `"${quote.text}"`
  const authorStr = `— ${quote.author}`
  const textLines = wrapText(fullText, maxContent)
  const innerWidth = Math.max(
    ...textLines.map(l => l.length),
    authorStr.length,
    28,
  ) + 4
  return { textLines, authorStr, innerWidth, pal }
}

// ── Box line renderers ────────────────────────────────────────────────
function topBorder(b: Box, borderCol = b.pal.base): string {
  return `${borderCol}╭${'─'.repeat(b.innerWidth)}╮${R}`
}
function bottomBorder(b: Box, borderCol = b.pal.base): string {
  return `${borderCol}╰${'─'.repeat(b.innerWidth)}╯${R}`
}
function contentRow(b: Box, text: string, borderCol = b.pal.base, textCol = b.pal.text): string {
  const fill = ' '.repeat(b.innerWidth - 4 - text.length)
  return `${borderCol}│${R}  ${textCol}${text}${R}${fill}  ${borderCol}│${R}`
}
function authorRow(b: Box, borderCol = b.pal.base): string {
  const leading = ' '.repeat(b.innerWidth - 4 - b.authorStr.length)
  return `${borderCol}│${R}  ${b.pal.faint}${leading}${b.authorStr}${R}  ${borderCol}│${R}`
}
function allLines(b: Box, borderCol = b.pal.base): string[] {
  return [
    topBorder(b, borderCol),
    ...b.textLines.map(l => contentRow(b, l, borderCol)),
    authorRow(b, borderCol),
    bottomBorder(b, borderCol),
  ]
}
function printBox(b: Box): void {
  for (const line of allLines(b)) stdout.write(line + '\n')
}

// ── Animations ────────────────────────────────────────────────────────
type Anim = (b: Box) => Promise<void>

// 1. Typewriter — quote types out char-by-char in the text colour
const animTypewriter: Anim = async (b) => {
  stdout.write(topBorder(b) + '\n')
  for (const line of b.textLines) {
    stdout.write(`${b.pal.base}│${R}  `)
    for (const ch of line) {
      stdout.write(`${b.pal.text}${ch}${R}`)
      await sleep(25)
    }
    stdout.write(' '.repeat(b.innerWidth - 4 - line.length) + `  ${b.pal.base}│${R}\n`)
  }
  stdout.write(authorRow(b) + '\n')
  stdout.write(bottomBorder(b) + '\n')
}

// 2. Wave reveal — each line appears in two stages (first half → full)
const animWaveReveal: Anim = async (b) => {
  stdout.write(topBorder(b) + '\n')
  for (const line of b.textLines) {
    const half = Math.ceil(line.length / 2)
    stdout.write(contentRow(b, line.slice(0, half).padEnd(line.length), b.pal.base, b.pal.faint) + '\n')
    await sleep(130)
    stdout.write(up(1) + CLR + contentRow(b, line) + '\n')
    await sleep(60)
  }
  stdout.write(authorRow(b) + '\n')
  stdout.write(bottomBorder(b) + '\n')
}

// 3. Slide — box slides in from the left across 5 frames
const animSlide: Anim = async (b) => {
  const lines = allLines(b)
  for (let i = 0; i < lines.length; i++) stdout.write('\n')
  stdout.write(up(lines.length))
  for (let step = 0; step < 5; step++) {
    const pad = ' '.repeat(Math.floor(12 * (1 - step / 4)))
    for (const line of lines) stdout.write(CLR + pad + line + '\n')
    if (step < 4) { stdout.write(up(lines.length)); await sleep(80) }
  }
}

// 4. Pulse border — border cycles dim → base → glow → base
const animPulseBorder: Anim = async (b) => {
  const stages = [
    allLines(b, b.pal.faint),
    allLines(b, b.pal.base),
    allLines(b, b.pal.glow),
    allLines(b, b.pal.base),
  ]
  for (let s = 0; s < stages.length; s++) {
    if (s > 0) stdout.write(up(stages[0].length))
    for (const line of stages[s]) stdout.write((s > 0 ? CLR : '') + line + '\n')
    if (s < stages.length - 1) await sleep(180)
  }
}

// 5. Glitch — noise chars in base colour fade to clean text
const animGlitch: Anim = async (b) => {
  const noiseRates = [0.25, 0.12, 0.04, 0]
  const totalLines = b.textLines.length + 3
  for (let f = 0; f < noiseRates.length; f++) {
    if (f > 0) stdout.write(up(totalLines))
    const rate = noiseRates[f]
    const clr = f > 0 ? CLR : ''
    stdout.write(clr + topBorder(b) + '\n')
    for (const line of b.textLines) {
      if (rate === 0) {
        stdout.write(clr + contentRow(b, line) + '\n')
      } else {
        let inner = ''
        for (const ch of line) {
          if (Math.random() < rate) {
            inner += `${b.pal.base}${GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]}${b.pal.text}`
          } else {
            inner += ch
          }
        }
        const fill = ' '.repeat(b.innerWidth - 4 - line.length)
        stdout.write(clr + `${b.pal.base}│${R}  ${b.pal.text}${inner}${R}${fill}  ${b.pal.base}│${R}\n`)
      }
    }
    stdout.write(clr + authorRow(b) + '\n')
    stdout.write(clr + bottomBorder(b) + '\n')
    if (f < noiseRates.length - 1) await sleep(120)
  }
}

// 6. Matrix rain — rain uses palette's rain colour, then box appears
const animMatrixRain: Anim = async (b) => {
  const width = b.innerWidth + 2
  const RAIN = 5
  for (let r = 0; r < RAIN; r++) {
    let line = b.pal.rain
    for (let col = 0; col < width; col++) line += Math.random() > 0.5 ? '1' : '0'
    stdout.write(line + R + '\n')
    await sleep(70)
  }
  stdout.write(up(RAIN))
  for (let r = 0; r < RAIN; r++) stdout.write(CLR + '\n')
  stdout.write(up(RAIN))
  printBox(b)
}

const ANIMS: Anim[] = [
  animTypewriter,
  animWaveReveal,
  animSlide,
  animPulseBorder,
  animGlitch,
  animMatrixRain,
]

// ── Entry point ───────────────────────────────────────────────────────
export function playStartupDisplay(): void {
  if (!stdout.isTTY) return
  void (async () => {
    try {
      const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)]
      const pal   = PALETTES[Math.floor(Math.random() * PALETTES.length)]
      const b     = makeBox(quote, pal)
      const anim  = ANIMS[Math.floor(Math.random() * ANIMS.length)]
      stdout.write('\n' + HIDE)
      await anim(b)
      stdout.write(SHOW)
    } catch {
      try { stdout.write(SHOW) } catch { /* */ }
    }
  })()
}
