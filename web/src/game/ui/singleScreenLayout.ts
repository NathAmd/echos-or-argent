export type SingleScreenProfile = 'phone-portrait' | 'phone-landscape' | 'desktop'

export type SingleScreenLayout = {
  profile: SingleScreenProfile
  nicknameKeyboardColumns: 5 | 10
  autoFocusTextInput: boolean
  compactHeight: boolean
}

export function resolveSingleScreenLayout(width: number, height: number, coarsePointer: boolean): SingleScreenLayout {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const compactHeight = safeHeight <= 540
  const phoneSized = coarsePointer && (safeWidth <= 820 || compactHeight)
  const profile: SingleScreenProfile = phoneSized
    ? safeWidth > safeHeight ? 'phone-landscape' : 'phone-portrait'
    : 'desktop'
  return {
    profile,
    nicknameKeyboardColumns: safeWidth <= 700 ? 5 : 10,
    autoFocusTextInput: !coarsePointer,
    compactHeight,
  }
}

type BrowserSingleScreenLayoutSource = Readonly<{
  innerWidth: number
  innerHeight: number
  visualViewport?: Readonly<{ height: number }> | null
  matchMedia: (query: string) => Pick<MediaQueryList, 'matches'>
}>

type BrowserSingleScreenLayoutTarget = Pick<HTMLElement, 'dataset' | 'classList' | 'style'>

/** Projette le viewport navigateur sur les attributs CSS canoniques de l'app. */
export function syncBrowserSingleScreenLayout(
  source: BrowserSingleScreenLayoutSource,
  target: BrowserSingleScreenLayoutTarget,
): SingleScreenLayout {
  const layout = resolveSingleScreenLayout(
    source.innerWidth,
    source.innerHeight,
    source.matchMedia('(pointer: coarse)').matches,
  )
  target.dataset.displayProfile = layout.profile
  target.classList.toggle('compact-height', layout.compactHeight)
  target.style.setProperty('--visual-viewport-height', `${source.visualViewport?.height ?? source.innerHeight}px`)
  return layout
}
