/**
 * Lightweight secrets heuristics for review handoff safety.
 * Not a full secret scanner — catches common accidental leaks in comments /
 * general notes / patch snippets before sending to an agent.
 */

export interface SecretFinding {
  /** Short human-readable rule name */
  rule: string
  /** Matched snippet (redacted) */
  snippet: string
  /** Where the match was found */
  source: string
}

interface Rule {
  id: string
  re: RegExp
  redact: (match: RegExpExecArray) => string
}

const RULES: Rule[] = [
  {
    id: 'aws-access-key',
    re: /\b(AKIA[0-9A-Z]{16})\b/g,
    redact: (m) => `${m[0].slice(0, 4)}…${m[0].slice(-4)}`,
  },
  {
    id: 'github-token',
    re: /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
    redact: (m) => `${m[0].slice(0, 7)}…`,
  },
  {
    id: 'slack-token',
    re: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    redact: (m) => `${m[0].slice(0, 8)}…`,
  },
  {
    id: 'private-key',
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    redact: () => '-----BEGIN PRIVATE KEY-----',
  },
  {
    id: 'generic-api-key',
    re: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"]?([A-Za-z0-9_\-]{16,})['"]?/gi,
    redact: (m) => `…${(m[1] ?? '').slice(-4)}`,
  },
  {
    id: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    redact: (m) => `${m[0].slice(0, 12)}…`,
  },
  {
    id: 'connection-string',
    re: /\b(?:postgres|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s'"]+/gi,
    redact: (m) => {
      try {
        const u = new URL(m[0])
        if (u.password) u.password = '***'
        return u.toString()
      } catch {
        return m[0].replace(/:([^:@/]+)@/, ':***@')
      }
    },
  },
]

export function scanTextForSecrets(text: string, source: string): SecretFinding[] {
  if (!text) return []
  const findings: SecretFinding[] = []
  for (const rule of RULES) {
    rule.re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = rule.re.exec(text)) !== null) {
      findings.push({ rule: rule.id, snippet: rule.redact(match), source })
      if (match.index === rule.re.lastIndex) rule.re.lastIndex++
    }
  }
  return findings
}

export function scanReviewForSecrets(input: {
  generalComment?: string
  comments: { id: string; filePath: string; body: string; lineContent?: string }[]
}): SecretFinding[] {
  const out: SecretFinding[] = []
  if (input.generalComment) {
    out.push(...scanTextForSecrets(input.generalComment, 'overall comment'))
  }
  for (const c of input.comments) {
    out.push(...scanTextForSecrets(c.body, `comment ${c.id} (${c.filePath})`))
    if (c.lineContent) {
      out.push(...scanTextForSecrets(c.lineContent, `code at ${c.filePath}`))
    }
  }
  // Dedupe by rule+snippet+source
  const seen = new Set<string>()
  return out.filter((f) => {
    const k = `${f.rule}|${f.snippet}|${f.source}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
