/** Encode literal paths using Git's byte-oriented C quoting. */
export function quoteGitPath(path: string): string {
  if (!/[\s"\\\x00-\x1f\x7f-\uffff]/.test(path)) return path
  return '"' + [...Buffer.from(path, 'utf8')].map((byte) => {
    if (byte === 34) return '\\"'
    if (byte === 92) return '\\\\'
    return byte >= 32 && byte < 127 ? String.fromCharCode(byte) : `\\${byte.toString(8).padStart(3, '0')}`
  }).join('') + '"'
}

/** Decode Git `core.quotePath` C-quoted pathnames from diff headers. */
export function decodeGitPath(raw: string): string {
  const input = raw
  if (!(input.startsWith('"') && input.endsWith('"'))) return input
  const bytes: number[] = []
  const pushText = (value: string) => bytes.push(...Buffer.from(value, 'utf8'))

  for (let i = 1; i < input.length - 1; i++) {
    const char = input[i]
    if (char !== '\\') {
      const codePoint = input.codePointAt(i)!
      pushText(String.fromCodePoint(codePoint))
      if (codePoint > 0xffff) i++
      continue
    }

    const escaped = input[++i]
    if (escaped == null) break
    const simple: Record<string, number> = {
      a: 0x07,
      b: 0x08,
      t: 0x09,
      n: 0x0a,
      v: 0x0b,
      f: 0x0c,
      r: 0x0d,
      '"': 0x22,
      '\\': 0x5c,
    }
    if (escaped in simple) {
      bytes.push(simple[escaped])
      continue
    }
    if (/[0-7]/.test(escaped)) {
      let octal = escaped
      while (octal.length < 3 && i + 1 < input.length - 1 && /[0-7]/.test(input[i + 1])) {
        octal += input[++i]
      }
      bytes.push(Number.parseInt(octal, 8))
      continue
    }
    pushText(escaped)
  }
  return Buffer.from(bytes).toString('utf8')
}

function stripSidePrefix(path: string, prefix: 'a/' | 'b/'): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

function consumeGitToken(
  input: string,
  start: number,
): { token: string; next: number } | null {
  if (input[start] !== '"') {
    const end = input.indexOf(' ', start)
    return {
      token: input.slice(start, end < 0 ? input.length : end),
      next: end < 0 ? input.length : end,
    }
  }
  let escaped = false
  for (let i = start + 1; i < input.length; i++) {
    const char = input[i]
    if (!escaped && char === '"') {
      return { token: input.slice(start, i + 1), next: i + 1 }
    }
    if (!escaped && char === '\\') escaped = true
    else escaped = false
  }
  return null
}

/** Parse `diff --git` header paths, including quoted paths and spaces in names. */
export function parseGitDiffHeaderPaths(line: string): [string, string] | null {
  if (!line.startsWith('diff --git ')) return null
  const rest = line.slice('diff --git '.length)
  if (rest.startsWith('"')) {
    const first = consumeGitToken(rest, 0)
    if (!first) return null
    let cursor = first.next
    while (cursor < rest.length && /\s/.test(rest[cursor])) cursor++
    const second = rest[cursor] === '"' ? consumeGitToken(rest, cursor) : { token: rest.slice(cursor), next: rest.length }
    if (!second) return null
    return [
      stripSidePrefix(decodeGitPath(first.token), 'a/'),
      stripSidePrefix(decodeGitPath(second.token), 'b/'),
    ]
  }

  // A rename can quote just the destination. Spaces alone are legal unquoted
  // bytes, including a literal " b/" within a filename.
  const quotedSeparator = rest.lastIndexOf(' "b/')
  if (quotedSeparator >= 0) {
    const second = consumeGitToken(rest, quotedSeparator + 1)
    if (!second || second.next !== rest.length) return null
    return [stripSidePrefix(rest.slice(0, quotedSeparator), 'a/'), stripSidePrefix(decodeGitPath(second.token), 'b/')]
  }
  const midpoint = (rest.length - 1) / 2
  if (Number.isInteger(midpoint) && rest[midpoint] === ' ' && rest.slice(2, midpoint) === rest.slice(midpoint + 3)) {
    return [rest.slice(2, midpoint), rest.slice(midpoint + 3)]
  }
  const separator = rest.lastIndexOf(' b/')
  if (separator < 0) return null
  return [
    stripSidePrefix(rest.slice(0, separator), 'a/'),
    stripSidePrefix(rest.slice(separator + 1), 'b/'),
  ]
}
