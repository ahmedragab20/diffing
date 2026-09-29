/** Session credentials must stay on the local API, including during redirects. */
export function fetchSessionApi(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error(`Refusing non-loopback diffing API URL: ${url.origin}`)
  }
  return fetch(input, { ...init, redirect: 'error' })
}

export function sessionApiOrigin(host: string, port: number): string {
  const localHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  return `http://${localHost === '::1' ? '[::1]' : localHost}:${port}`
}
