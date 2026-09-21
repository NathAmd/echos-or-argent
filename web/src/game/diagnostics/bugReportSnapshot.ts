/** Convertit les états runtime riches en valeur JSON transportable. */
export function copyBugDiagnosticValue(value: unknown): unknown {
  const visited = new WeakSet<object>()
  const encoded = JSON.stringify(value, (_key, candidate: unknown) => {
    if (typeof candidate === 'bigint') return candidate.toString()
    if (candidate instanceof Map) return [...candidate.entries()]
    if (candidate instanceof Set) return [...candidate]
    if (candidate instanceof Uint8Array) return [...candidate]
    if (!candidate || typeof candidate !== 'object') return candidate
    if (visited.has(candidate)) return '[Circular]'
    visited.add(candidate)
    return candidate
  })
  return encoded === undefined ? undefined : JSON.parse(encoded) as unknown
}

export function collectBugReportEnvironment(): Record<string, unknown> {
  const navigatorWithHints = navigator as Navigator & {
    deviceMemory?: number
    connection?: { effectiveType?: string, downlink?: number, rtt?: number, saveData?: boolean }
  }
  let storageKeyCount: number | undefined
  try {
    storageKeyCount = window.localStorage.length
  } catch {
    storageKeyCount = undefined
  }
  return {
    url: `${window.location.origin}${window.location.pathname}${window.location.search}`,
    mode: import.meta.env.MODE,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    languages: [...navigator.languages],
    online: navigator.onLine,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGiB: navigatorWithHints.deviceMemory,
    connection: navigatorWithHints.connection && {
      effectiveType: navigatorWithHints.connection.effectiveType,
      downlink: navigatorWithHints.connection.downlink,
      rtt: navigatorWithHints.connection.rtt,
      saveData: navigatorWithHints.connection.saveData,
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      visualWidth: window.visualViewport?.width,
      visualHeight: window.visualViewport?.height,
      visualScale: window.visualViewport?.scale,
      devicePixelRatio: window.devicePixelRatio,
      displayProfile: document.documentElement.dataset.displayProfile,
      coarsePointer: window.matchMedia('(pointer: coarse)').matches,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    },
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      availableWidth: window.screen.availWidth,
      availableHeight: window.screen.availHeight,
      orientation: window.screen.orientation?.type,
    },
    document: {
      visibility: document.visibilityState,
      fullscreen: Boolean(document.fullscreenElement),
      focused: document.hasFocus(),
    },
    gamepadsConnected: navigator.getGamepads?.().filter(Boolean).length ?? 0,
    localStorageKeyCount: storageKeyCount,
  }
}

export function collectVisibleBugReportElements(root: HTMLElement): Array<Record<string, unknown>> {
  return [...root.querySelectorAll<HTMLElement>('[id]')].flatMap((element) => {
    if (element.dataset.bugReportExclude !== undefined) return []
    const computed = window.getComputedStyle(element)
    const bounds = element.getBoundingClientRect()
    if (element.hidden || computed.display === 'none' || computed.visibility === 'hidden' || bounds.width < 1 || bounds.height < 1) return []
    return [{
      id: element.id,
      className: element.className,
      text: element instanceof HTMLCanvasElement ? undefined : element.textContent?.trim().slice(0, 300),
      bounds: {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      },
      opacity: computed.opacity,
      zIndex: computed.zIndex,
    }]
  })
}
