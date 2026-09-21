/**
 * Propriétaire unique des primitives réseau navigateur. Les adaptateurs de
 * domaine injectent ces ports sans instancier directement fetch/WebSocket.
 */
export type BrowserOnlineWebSocket = Readonly<{
  readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
  addEventListener: WebSocket['addEventListener']
  removeEventListener: WebSocket['removeEventListener']
}>

export const browserOnlineFetch = (input: string, init?: RequestInit): Promise<Response> => (
  fetch(input, init)
)

export const createBrowserOnlineWebSocket = (
  url: string,
  protocol: string,
): BrowserOnlineWebSocket => new WebSocket(url, protocol)
