import type { P2pSessionIntent } from '../multiplayer/p2pSessionIntentProtocol'
import { createGameMenuButton, createGameMenuNavigation } from './menuPresentation'
import { resolveMultiplayerRomLabels, type MultiplayerRomLabels } from './multiplayerRomLabels'

export type MultiplayerAccountPreview = Readonly<{
  id: string
  username: string
  role: 'user' | 'admin'
  entitlements: readonly string[]
}>

/** État de compte sans aucun secret de session. */
export type MultiplayerConnectionState =
  | Readonly<{ status: 'signed-out' }>
  | Readonly<{ status: 'authenticating', operation: 'login' | 'register' | 'restore' }>
  | Readonly<{ status: 'connecting', account: MultiplayerAccountPreview }>
  | Readonly<{ status: 'connected', userId: string, account: MultiplayerAccountPreview }>
  | Readonly<{ status: 'access-denied', account: MultiplayerAccountPreview, message: string }>
  | Readonly<{ status: 'error', message: string, account?: MultiplayerAccountPreview }>

export type MultiplayerFriendPreview = Readonly<{
  userId: string
  online: boolean
}>

export type MultiplayerSocialState = Readonly<{
  friends: readonly MultiplayerFriendPreview[]
  incoming: readonly string[]
  outgoing: readonly string[]
  refreshing?: boolean
}>

export type MultiplayerSessionInvitation =
  | Readonly<{
    invitationId: string
    fromUserId: string
    transport: 'peer'
  }>
  | Readonly<{
    invitationId: string
    fromUserId: string
    transport: 'server'
    intent: 'coop'
  }>

export type MultiplayerSessionIntentConsent = Readonly<{
  peerUserId: string
  intent: P2pSessionIntent
}>

export type MultiplayerSessionState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'searching', intent: P2pSessionIntent }>
  | Readonly<{ status: 'consent' } & MultiplayerSessionIntentConsent>
  | Readonly<{ status: 'inviting', peerUserId: string }>
  | Readonly<{ status: 'negotiating', peerUserId: string, role: 'host' | 'guest' }>
  | Readonly<{
    status: 'connected'
    peerUserId: string
    role: 'host' | 'guest'
    intent?: P2pSessionIntent
    gameplay?: 'trade-armed' | 'campaign-starting' | 'campaign-armed' | 'not-wired'
  }>
  | Readonly<{ status: 'error', message: string }>

/**
 * Présentation éphémère, résolue exclusivement sur le client depuis ses
 * ressources locales. Les callbacks de ce module ne reçoivent jamais cet
 * objet, ses libellés, ses détails ni son visuel.
 */
export type MultiplayerTradeOfferPreview = Readonly<{
  primaryLabel: string
  secondaryLabel?: string
  details?: readonly Readonly<{ label: string, value: string }>[]
  createVisual?: () => HTMLElement | undefined
}>

export type MultiplayerTradeState =
  | Readonly<{ status: 'closed' }>
  | Readonly<{
    status: 'negotiating' | 'committing' | 'committed' | 'error'
    /** Une décision durable est en cours : aucune sortie ni mutation n'est sûre. */
    locked?: boolean
    localOffer?: MultiplayerTradeOfferPreview
    remoteOffer?: MultiplayerTradeOfferPreview
    localAccepted: boolean
    remoteAccepted: boolean
    errorMessage?: string
  }>

export type MultiplayerActivityAvailability = Readonly<{
  random: boolean
  friends: boolean
  /** Faux quand le transport existe mais que le gameplay n'est pas encore jouable. */
  visible?: boolean
  reason?: string
}>

export type MultiplayerLeaderboardAvailability =
  | Readonly<{ status: 'available' }>
  | Readonly<{ status: 'unavailable', reason: string }>

export type MultiplayerHubState = Readonly<{
  leaderboard: MultiplayerLeaderboardAvailability
  activities: Readonly<Record<P2pSessionIntent, MultiplayerActivityAvailability>>
}>

export type MultiplayerSessionRequest = Readonly<{
  intent: P2pSessionIntent
  target: Readonly<{ kind: 'random' }> | Readonly<{ kind: 'friend', userId: string }>
}>

export type MultiplayerUiSnapshot = Readonly<{
  connection: MultiplayerConnectionState
  social: MultiplayerSocialState
  invitations: readonly MultiplayerSessionInvitation[]
  session: MultiplayerSessionState
  trade: MultiplayerTradeState
  /** Absent tant que le runtime ne possède aucune capacité de hub attestée. */
  hub?: MultiplayerHubState
}>

/**
 * Ports de commande uniquement. L'intégrateur reste propriétaire de toute
 * logique HTTP, WebRTC, validation métier, transaction et progression.
 */
export type MultiplayerUiPorts = Readonly<{
  login: (credentials: Readonly<{ username: string, password: string }>) => void
  register: (credentials: Readonly<{ username: string, password: string }>) => void
  retryConnection?: () => void
  logout: () => void
  refreshSocial: () => void
  sendFriendRequest: (userId: string) => void
  acceptFriendRequest: (userId: string) => void
  declineFriendRequest: (userId: string) => void
  cancelFriendRequest: (userId: string) => void
  removeFriend: (userId: string) => void
  inviteFriend: (userId: string) => void
  joinInvitation: (invitationId: string) => void
  declineInvitation: (invitationId: string) => void
  leaveSession: () => void
  openTrade: () => void
  chooseTradeOffer: () => void
  changeTradeOffer: () => void
  cancelTrade: () => void
  acceptTrade: () => void
  requestSession?: (request: MultiplayerSessionRequest) => void
  openLeaderboard?: () => void
  acceptSessionIntent?: (consent: MultiplayerSessionIntentConsent) => void
  declineSessionIntent?: (consent: MultiplayerSessionIntentConsent) => void
}>

export type MultiplayerUiShell = Readonly<{
  update: (snapshot: MultiplayerUiSnapshot) => void
  destroy: () => void
}>

export type MultiplayerUiPresentationEvent = Readonly<{
  kind:
    | 'connected'
    | 'request-received'
    | 'session-consent'
    | 'session-ready'
    | 'trade-accepted'
    | 'trade-committing'
    | 'trade-committed'
    | 'error'
}>

export type MultiplayerUiShellOptions = Readonly<{
  root: HTMLElement
  ports: MultiplayerUiPorts
  labels?: MultiplayerRomLabels
  /** Faux dans le jeu : la session se choisit exclusivement avant les sauvegardes. */
  accountManagement?: boolean
  /** Feedback local uniquement : aucun effet ne pilote le réseau ou la transaction. */
  present?: (event: MultiplayerUiPresentationEvent) => void
}>

type MultiplayerAction =
  | 'open-global-screen'
  | 'back-global-menu'
  | 'select-account-mode'
  | 'navigate-collection'
  | 'login'
  | 'register'
  | 'retry-connection'
  | 'logout'
  | 'toggle-password'
  | 'refresh-social'
  | 'send-friend-request'
  | 'accept-friend-request'
  | 'decline-friend-request'
  | 'cancel-friend-request'
  | 'remove-friend'
  | 'invite-friend'
  | 'join-invitation'
  | 'decline-invitation'
  | 'leave-session'
  | 'open-trade'
  | 'choose-trade-offer'
  | 'change-trade-offer'
  | 'cancel-trade'
  | 'accept-trade'
  | 'open-leaderboard'
  | 'select-session-intent'
  | 'request-random-session'
  | 'focus-friend-session'
  | 'request-friend-session'
  | 'accept-session-intent'
  | 'decline-session-intent'

type MultiplayerGlobalScreen = 'home' | 'play' | 'friends' | 'requests' | 'session' | 'trade' | 'account'
type MultiplayerAccountMode = 'login' | 'register'

const multiplayerSessionIntents = ['pvp', 'coop', 'trade'] as const satisfies readonly P2pSessionIntent[]
const multiplayerSessionIntentLabels: Readonly<Record<P2pSessionIntent, string>> = Object.freeze({
  pvp: 'PvP',
  coop: 'Coop',
  trade: 'Échange',
})
const multiplayerSessionProposalLabels: Readonly<Record<P2pSessionIntent, string>> = Object.freeze({
  pvp: 'un duel PvP',
  coop: 'une session Coop',
  trade: 'un échange',
})
const unavailableActivityReason = "Cette activité n'est pas encore raccordée."
const unavailableHubState: MultiplayerHubState = Object.freeze({
  leaderboard: Object.freeze({
    status: 'unavailable',
    reason: "Aucun résultat attesté n'est encore fourni par le serveur.",
  }),
  activities: Object.freeze({
    pvp: Object.freeze({ random: false, friends: false, reason: unavailableActivityReason }),
    coop: Object.freeze({ random: false, friends: false, reason: unavailableActivityReason }),
    trade: Object.freeze({ random: false, friends: false, reason: unavailableActivityReason }),
  }),
})

const createElement = <K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className = '',
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag)
  element.className = className
  return element
}

function createHeading(document: Document, label: string, level: 2 | 3): HTMLHeadingElement {
  const heading = createElement(document, level === 2 ? 'h2' : 'h3', `multiplayer-shell-heading multiplayer-shell-heading-${level}`)
  heading.textContent = label
  return heading
}

function createButton(
  document: Document,
  label: string,
  action: MultiplayerAction,
  options: { target?: string, intent?: P2pSessionIntent, disabled?: boolean, tone?: 'primary' | 'danger' } = {},
): HTMLButtonElement {
  const button = createElement(document, 'button', 'multiplayer-shell-button')
  button.type = 'button'
  button.textContent = label
  button.dataset.multiplayerAction = action
  if (options.target !== undefined) button.dataset.multiplayerTarget = options.target
  if (options.intent !== undefined) button.dataset.multiplayerIntent = options.intent
  if (options.tone) button.dataset.tone = options.tone
  button.disabled = options.disabled ?? false
  return button
}

function createInput(
  document: Document,
  kind: 'login-username' | 'login-password' | 'register-username' | 'register-password' | 'friend-id',
  placeholder: string,
  maximumLength: number,
): HTMLInputElement {
  const input = createElement(document, 'input', 'multiplayer-shell-input')
  input.type = kind.endsWith('-password') ? 'password' : 'text'
  input.dataset.multiplayerInput = kind
  input.placeholder = placeholder
  input.maxLength = maximumLength
  input.autocomplete = 'off'
  input.autocapitalize = 'none'
  input.spellcheck = false
  // La coque ne possède aucune saisie native : l'hôte ouvre le clavier
  // central du jeu pour ce champ, y compris juste après un nouveau rendu.
  input.readOnly = true
  input.inputMode = 'none'
  input.setAttribute('aria-haspopup', 'dialog')
  return input
}

function createEmptyState(document: Document, label: string): HTMLParagraphElement {
  const empty = createElement(document, 'p', 'multiplayer-shell-empty')
  empty.textContent = label
  return empty
}

function createStatus(document: Document, label: string, error = false): HTMLOutputElement {
  const status = createElement(document, 'output', 'multiplayer-shell-status')
  status.textContent = label
  status.dataset.state = error ? 'error' : 'info'
  status.setAttribute('role', error ? 'alert' : 'status')
  status.setAttribute('aria-live', error ? 'assertive' : 'polite')
  return status
}

function appendConnection(
  document: Document,
  root: HTMLElement,
  connection: MultiplayerConnectionState,
  tradeLocked: boolean,
  retryConnectionAvailable: boolean,
  accountMode: MultiplayerAccountMode,
  accountManagement: boolean,
): void {
  const section = createElement(document, 'section', 'multiplayer-shell-section multiplayer-shell-connection')
  section.dataset.multiplayerSection = 'connection'
  section.append(createHeading(document, 'Compte', 2))
  const account = 'account' in connection ? connection.account : undefined
  if (account) {
    const identity = createElement(document, 'p', 'multiplayer-shell-identity')
    const value = createElement(document, 'strong')
    value.textContent = account.username
    identity.append(value)
    const accountMeta = createElement(document, 'div', 'multiplayer-shell-account-meta')
    const role = createElement(document, 'span', 'multiplayer-shell-account-badge')
    role.dataset.accountRole = account.role
    role.textContent = account.role === 'admin' ? 'ADMIN' : 'EN LIGNE'
    accountMeta.append(role)
    if (connection.status === 'connecting') {
      section.append(createStatus(document, 'Connexion au multijoueur…'))
    } else if (connection.status === 'access-denied' || connection.status === 'error') {
      section.append(createStatus(document, connection.message, true))
    }
    const actions = createElement(document, 'div', 'multiplayer-shell-actions')
    if (connection.status === 'error' && retryConnectionAvailable) {
      actions.append(createButton(document, 'Réessayer', 'retry-connection', {
        disabled: tradeLocked,
        tone: 'primary',
      }))
    }
    if (accountManagement) {
      actions.append(createButton(document, 'Se déconnecter', 'logout', {
        disabled: tradeLocked,
        tone: 'danger',
      }))
    }
    section.append(identity, accountMeta)
    if (actions.children.length > 0) section.append(actions)
  } else {
    if (!accountManagement) {
      section.append(createStatus(
        document,
        connection.status === 'error' ? connection.message : 'Session absente. Reprenez depuis l’écran titre.',
        true,
      ))
      root.append(section)
      return
    }
    if (connection.status === 'error') section.append(createStatus(document, connection.message, true))
    else if (connection.status === 'authenticating') {
      const label = connection.operation === 'restore'
        ? 'Restauration du compte…'
        : connection.operation === 'register' ? 'Création du compte…' : 'Connexion au compte…'
      section.append(createStatus(document, label))
    }
    const disabled = connection.status === 'authenticating'
    const modeNavigation = createElement(document, 'nav', 'multiplayer-shell-account-modes')
    modeNavigation.setAttribute('aria-label', 'Compte multijoueur')
    for (const mode of ['login', 'register'] as const) {
      const modeButton = createButton(
        document,
        mode === 'login' ? 'Connexion' : 'Créer un compte',
        'select-account-mode',
        { target: mode },
      )
      modeButton.setAttribute('aria-pressed', String(accountMode === mode))
      modeNavigation.append(modeButton)
    }
    const forms = createElement(document, 'div', 'multiplayer-shell-account-forms')
    const appendForm = (mode: 'login' | 'register'): void => {
      const form = createElement(document, 'section', 'multiplayer-shell-account-form')
      form.dataset.multiplayerAccountForm = mode
      form.hidden = accountMode !== mode
      const username = createInput(document, `${mode}-username`, 'Identifiant', 32)
      username.setAttribute('aria-label', `Identifiant pour ${mode === 'login' ? 'la connexion' : "la création du compte"}`)
      username.autocomplete = 'username'
      const passwordRow = createElement(document, 'div', 'multiplayer-shell-password-row')
      const password = createInput(document, `${mode}-password`, 'Mot de passe', 128)
      password.setAttribute('aria-label', `Mot de passe pour ${mode === 'login' ? 'la connexion' : "la création du compte"}`)
      password.autocomplete = mode === 'login' ? 'current-password' : 'new-password'
      const reveal = createButton(document, 'Afficher', 'toggle-password', { target: `${mode}-password` })
      reveal.setAttribute('aria-pressed', 'false')
      passwordRow.append(password, reveal)
      form.append(
        username,
        passwordRow,
        createButton(document, mode === 'login' ? 'Se connecter' : 'Créer le compte', mode, {
          disabled,
          tone: 'primary',
        }),
      )
      forms.append(form)
    }
    appendForm('login')
    appendForm('register')
    section.append(modeNavigation, forms)
  }
  root.append(section)
}

function availabilityReason(
  available: boolean,
  configured: boolean,
  sessionBusy: boolean,
  fallback: string,
): string | undefined {
  if (!configured) return unavailableActivityReason
  if (sessionBusy) return 'Une autre session est déjà active.'
  return available ? undefined : fallback
}

function appendMultiplayerHub(
  document: Document,
  root: HTMLElement,
  hub: MultiplayerHubState,
  social: MultiplayerSocialState,
  session: MultiplayerSessionState,
  ports: Pick<MultiplayerUiPorts, 'requestSession' | 'openLeaderboard'>,
  selectedIntent: P2pSessionIntent | undefined,
): void {
  const section = createElement(document, 'section', 'multiplayer-shell-section multiplayer-shell-hub')
  section.dataset.multiplayerSection = 'hub'
  const heading = createHeading(document, 'Multijoueur', 2)
  heading.id = 'multiplayer-hub-title'
  const introduction = createElement(document, 'p', 'multiplayer-shell-hint')
  introduction.textContent = 'Choisissez une activité, puis un joueur aléatoire ou un ami en ligne.'
  introduction.classList.add('multiplayer-shell-sr-only')
  section.append(heading, introduction)

  const shortcuts = createElement(document, 'nav', 'multiplayer-shell-hub-shortcuts')
  shortcuts.setAttribute('aria-labelledby', heading.id)
  const leaderboardAvailable = hub.leaderboard.status === 'available' && ports.openLeaderboard !== undefined
  if (leaderboardAvailable) {
    const leaderboard = createButton(document, 'Classement', 'open-leaderboard')
    leaderboard.classList.add('multiplayer-shell-hub-shortcut')
    leaderboard.dataset.multiplayerHubShortcut = 'leaderboard'
    shortcuts.append(leaderboard)
  }

  const visibleIntents = multiplayerSessionIntents.filter((intent) => {
    const availability = hub.activities[intent]
    return ports.requestSession !== undefined
      && availability.visible !== false
      && (availability.random || availability.friends)
  })
  for (const intent of visibleIntents) {
    const shortcut = createButton(document, multiplayerSessionIntentLabels[intent], 'select-session-intent', { intent })
    const selected = selectedIntent === intent
    shortcut.classList.add('multiplayer-shell-hub-shortcut')
    shortcut.dataset.multiplayerHubShortcut = intent
    shortcut.setAttribute('aria-controls', `multiplayer-hub-choice-${intent}`)
    shortcut.setAttribute('aria-expanded', String(selected))
    shortcut.setAttribute('aria-pressed', String(selected))
    shortcuts.append(shortcut)
  }
  if (shortcuts.children.length > 0) section.append(shortcuts)
  else section.append(createEmptyState(document, 'Aucune activité disponible.'))

  const leaderboardStatus = createElement(document, 'p', 'multiplayer-shell-hub-availability')
  leaderboardStatus.classList.add('multiplayer-shell-sr-only')
  leaderboardStatus.id = 'multiplayer-hub-leaderboard-status'
  leaderboardStatus.dataset.multiplayerHubStatus = 'leaderboard'
  leaderboardStatus.textContent = leaderboardAvailable
    ? 'Les résultats attestés du classement sont disponibles.'
    : hub.leaderboard.status === 'unavailable'
      ? `Classement indisponible : ${hub.leaderboard.reason}`
      : "Classement indisponible : l'action n'est pas raccordée."
  section.append(leaderboardStatus)

  const sessionBusy = session.status !== 'idle' && session.status !== 'error'
  const hasOnlineFriend = social.friends.some(({ online }) => online)
  for (const intent of visibleIntents) {
    const availability = hub.activities[intent]
    const choice = createElement(document, 'section', 'multiplayer-shell-hub-choice')
    choice.id = `multiplayer-hub-choice-${intent}`
    choice.dataset.multiplayerIntentChoice = intent
    choice.hidden = selectedIntent !== intent
    choice.setAttribute('role', 'region')
    choice.setAttribute('aria-labelledby', `multiplayer-hub-choice-title-${intent}`)
    const title = createHeading(document, `${multiplayerSessionIntentLabels[intent]} · choisir un joueur`, 3)
    title.id = `multiplayer-hub-choice-title-${intent}`
    const actions = createElement(document, 'div', 'multiplayer-shell-actions multiplayer-shell-hub-choice-actions')
    const randomReason = availabilityReason(
      availability.random,
      ports.requestSession !== undefined,
      sessionBusy,
      availability.reason ?? 'Le matchmaking aléatoire est indisponible.',
    )
    const friendReason = availabilityReason(
      availability.friends && hasOnlineFriend,
      ports.requestSession !== undefined,
      sessionBusy,
      !hasOnlineFriend ? "Aucun ami n'est actuellement en ligne." : availability.reason ?? 'Cette activité avec un ami est indisponible.',
    )
    const random = createButton(document, 'Joueur aléatoire', 'request-random-session', {
      intent,
      disabled: randomReason !== undefined,
      tone: 'primary',
    })
    random.setAttribute('aria-label', `${multiplayerSessionIntentLabels[intent]} avec un joueur aléatoire`)
    const friend = createButton(document, 'Choisir un ami', 'focus-friend-session', {
      intent,
      disabled: friendReason !== undefined,
    })
    friend.setAttribute('aria-label', `Choisir un ami pour ${multiplayerSessionIntentLabels[intent]}`)
    const status = createElement(document, 'p', 'multiplayer-shell-hub-availability')
    status.classList.add('multiplayer-shell-sr-only')
    status.id = `multiplayer-hub-choice-status-${intent}`
    status.dataset.multiplayerHubStatus = intent
    status.textContent = randomReason || friendReason
      ? [`Aléatoire : ${randomReason ?? 'disponible'}`, `Ami : ${friendReason ?? 'disponible'}`].join(' · ')
      : 'Joueur aléatoire et amis en ligne disponibles.'
    if (randomReason) random.setAttribute('aria-describedby', status.id)
    if (friendReason) friend.setAttribute('aria-describedby', status.id)
    actions.append(random, friend)
    choice.append(title, actions, status)
    section.append(choice)
  }
  root.append(section)
}

function appendFriendList(
  document: Document,
  root: HTMLElement,
  social: MultiplayerSocialState,
  session: MultiplayerSessionState,
  hub: MultiplayerHubState,
  requestSessionAvailable: boolean,
): void {
  const section = createElement(document, 'section', 'multiplayer-shell-section multiplayer-shell-social')
  section.dataset.multiplayerSection = 'social'
  const header = createElement(document, 'div', 'multiplayer-shell-section-header')
  header.append(
    createHeading(document, 'Amis', 2),
    createButton(document, social.refreshing ? 'Actualisation…' : 'Actualiser', 'refresh-social', {
      disabled: social.refreshing,
    }),
  )
  section.append(header)

  const add = createElement(document, 'div', 'multiplayer-shell-inline-form')
  const friendInput = createInput(document, 'friend-id', "Identifiant de l'ami", 64)
  friendInput.setAttribute('aria-label', "Identifiant de l'ami")
  add.append(friendInput, createButton(document, 'Ajouter', 'send-friend-request', { tone: 'primary' }))
  section.append(add)

  const list = createPaginatedList(document, 'friends', social.friends, 'Aucun ami.', (friend) => {
    const item = createElement(document, 'li', 'multiplayer-shell-list-item')
    const identity = createElement(document, 'span', 'multiplayer-shell-friend')
    const presence = createElement(document, 'span', 'multiplayer-shell-presence')
    presence.dataset.online = String(friend.online)
    presence.setAttribute('aria-label', friend.online ? 'En ligne' : 'Hors ligne')
    const name = createElement(document, 'strong')
    name.textContent = friend.userId
    const state = createElement(document, 'span', 'multiplayer-shell-secondary')
    state.textContent = friend.online ? 'En ligne' : 'Hors ligne'
    identity.append(presence, name, state)
    const actions = createElement(document, 'div', 'multiplayer-shell-actions multiplayer-shell-friend-actions')
    actions.setAttribute('role', 'group')
    actions.setAttribute('aria-label', `Activités avec ${friend.userId}`)
    const sessionBusy = session.status !== 'idle' && session.status !== 'error'
    for (const intent of multiplayerSessionIntents) {
      const availability = hub.activities[intent]
      if (!requestSessionAvailable || availability.visible === false || !availability.friends) continue
      const disabledReason = !requestSessionAvailable
        ? unavailableActivityReason
        : !availability.friends
          ? availability.reason ?? 'Cette activité avec un ami est indisponible.'
          : !friend.online
            ? `${friend.userId} est hors ligne.`
            : sessionBusy ? 'Une autre session est déjà active.' : undefined
      const activity = createButton(document, multiplayerSessionIntentLabels[intent], 'request-friend-session', {
        target: friend.userId,
        intent,
        disabled: disabledReason !== undefined,
        ...(intent === 'trade' ? { tone: 'primary' as const } : {}),
      })
      activity.setAttribute('aria-label', disabledReason
        ? `${multiplayerSessionIntentLabels[intent]} avec ${friend.userId} indisponible : ${disabledReason}`
        : `${multiplayerSessionIntentLabels[intent]} avec ${friend.userId}`)
      if (disabledReason) activity.title = disabledReason
      actions.append(activity)
    }
    if (!requestSessionAvailable) {
      const legacySession = createButton(document, 'Session', 'invite-friend', {
        target: friend.userId,
        disabled: !friend.online || sessionBusy,
      })
      legacySession.setAttribute('aria-label', `Ouvrir une session multijoueur avec ${friend.userId}`)
      actions.append(legacySession)
    }
    const remove = createButton(document, '×', 'remove-friend', { target: friend.userId, tone: 'danger' })
    remove.setAttribute('aria-label', `Retirer ${friend.userId} de la liste d'amis`)
    remove.title = 'Retirer'
    actions.append(remove)
    item.append(identity, actions)
    return item
  })
  section.append(list)
  root.append(section)
}

const multiplayerCollectionPageSize = 3

function createPaginatedList<Item>(
  document: Document,
  collection: string,
  items: readonly Item[],
  emptyLabel: string,
  createItem: (item: Item) => HTMLElement,
): HTMLElement {
  const root = createElement(document, 'div', 'multiplayer-shell-paged-list')
  root.dataset.multiplayerCollection = collection
  const pageCount = Math.max(1, Math.ceil(items.length / multiplayerCollectionPageSize))
  root.dataset.multiplayerPageCount = String(pageCount)
  root.dataset.multiplayerCurrentPage = '0'
  for (let page = 0; page < pageCount; page += 1) {
    const list = createElement(document, 'ul', 'multiplayer-shell-list')
    list.dataset.multiplayerList = collection
    list.dataset.multiplayerCollectionPage = String(page)
    list.hidden = page !== 0
    const pageItems = items.slice(
      page * multiplayerCollectionPageSize,
      (page + 1) * multiplayerCollectionPageSize,
    )
    if (pageItems.length === 0) list.append(createEmptyState(document, emptyLabel))
    else pageItems.forEach((item) => list.append(createItem(item)))
    root.append(list)
  }
  if (pageCount > 1) {
    const navigation = createElement(document, 'nav', 'multiplayer-shell-pagination')
    navigation.setAttribute('aria-label', `Pages ${collection}`)
    const previous = createButton(document, '‹', 'navigate-collection', { target: `${collection}:previous`, disabled: true })
    previous.setAttribute('aria-label', 'Page précédente')
    const counter = createElement(document, 'span', 'multiplayer-shell-page-counter')
    counter.dataset.multiplayerPageCounter = collection
    counter.textContent = `1/${pageCount}`
    const next = createButton(document, '›', 'navigate-collection', { target: `${collection}:next` })
    next.setAttribute('aria-label', 'Page suivante')
    navigation.append(previous, counter, next)
    root.append(navigation)
  }
  return root
}

function appendFriendRequests(
  document: Document,
  root: HTMLElement,
  title: string,
  kind: 'incoming' | 'outgoing',
  userIds: readonly string[],
): void {
  if (userIds.length === 0) return
  const group = createElement(document, 'section', 'multiplayer-shell-request-group')
  group.append(createHeading(document, title, 3))
  const list = createPaginatedList(document, kind, userIds, 'Aucune.', (userId) => {
    const item = createElement(document, 'li', 'multiplayer-shell-list-item')
    const name = createElement(document, 'strong')
    name.textContent = userId
    const actions = createElement(document, 'div', 'multiplayer-shell-actions')
    if (kind === 'incoming') {
      actions.append(
        createButton(document, 'Accepter', 'accept-friend-request', { target: userId, tone: 'primary' }),
        createButton(document, 'Refuser', 'decline-friend-request', { target: userId }),
      )
    } else {
      actions.append(createButton(document, 'Annuler', 'cancel-friend-request', { target: userId }))
    }
    item.append(name, actions)
    return item
  })
  group.append(list)
  root.append(group)
}

function sessionStatusText(session: MultiplayerSessionState): { label: string, error?: boolean } {
  switch (session.status) {
    case 'idle': return { label: 'Libre' }
    case 'searching': return { label: `Recherche · ${multiplayerSessionIntentLabels[session.intent]}…` }
    case 'consent': return { label: `${session.peerUserId} propose ${multiplayerSessionProposalLabels[session.intent]}.` }
    case 'inviting': return { label: `Invitation · ${session.peerUserId}` }
    case 'negotiating': return { label: `Connexion · ${session.peerUserId}…` }
    case 'connected': {
      const prefix = session.peerUserId
      if (session.intent === 'trade' && session.gameplay === 'trade-armed') return { label: `${prefix} · échange prêt` }
      if (session.intent === 'coop' && session.gameplay === 'campaign-starting') {
        return { label: `${prefix} · connexion Coop…` }
      }
      if (session.intent === 'coop' && session.gameplay === 'campaign-armed') return { label: `${prefix} · Coop prête` }
      if (session.intent && session.gameplay === 'not-wired') {
        return { label: `${prefix} · ${multiplayerSessionIntentLabels[session.intent]} indisponible` }
      }
      if (session.intent) {
        return { label: `${prefix} · ${multiplayerSessionIntentLabels[session.intent]}` }
      }
      return { label: prefix }
    }
    case 'error': return { label: session.message, error: true }
  }
}

function appendSession(
  document: Document,
  root: HTMLElement,
  session: MultiplayerSessionState,
  trade: MultiplayerTradeState,
  ports: Pick<MultiplayerUiPorts, 'acceptSessionIntent' | 'declineSessionIntent'>,
): void {
  const section = createElement(document, 'section', 'multiplayer-shell-section multiplayer-shell-session')
  section.dataset.multiplayerSection = 'session'
  section.append(createHeading(document, 'Session multijoueur', 2))
  const status = sessionStatusText(session)
  section.append(createStatus(document, status.label, status.error))

  if (session.status === 'idle' || session.status === 'error') {
    // Les actions globales Amis et Demandes portent déjà les deux parcours.
  } else if (session.status === 'searching') {
    section.append(createButton(document, 'Annuler la recherche', 'leave-session', { tone: 'danger' }))
  } else if (session.status === 'consent') {
    const actions = createElement(document, 'div', 'multiplayer-shell-actions')
    const decline = createButton(document, 'Refuser', 'decline-session-intent', {
      target: session.peerUserId,
      intent: session.intent,
      disabled: ports.declineSessionIntent === undefined,
      tone: 'danger',
    })
    decline.setAttribute('aria-label', `Refuser ${multiplayerSessionProposalLabels[session.intent]} de ${session.peerUserId}`)
    const accept = createButton(document, 'Accepter', 'accept-session-intent', {
      target: session.peerUserId,
      intent: session.intent,
      disabled: ports.acceptSessionIntent === undefined,
      tone: 'primary',
    })
    accept.setAttribute('aria-label', `Accepter ${multiplayerSessionProposalLabels[session.intent]} de ${session.peerUserId}`)
    actions.append(decline, accept)
    section.append(actions)
    if (decline.disabled || accept.disabled) {
      const unavailable = createElement(document, 'p', 'multiplayer-shell-hint')
      unavailable.textContent = "La réponse à cette proposition n'est pas encore raccordée."
      section.append(unavailable)
    }
  } else if (session.status === 'connected') {
    const actions = createElement(document, 'div', 'multiplayer-shell-actions')
    const tradeArmed = session.intent === undefined && session.gameplay === undefined
      || session.intent === 'trade' && session.gameplay === 'trade-armed'
    if (tradeArmed) {
      const canOpenTrade = trade.status === 'closed' || trade.status === 'committed'
      const openTradeLabel = trade.status === 'closed'
        ? 'Proposer un échange'
        : trade.status === 'committed' ? 'Nouvel échange' : 'Échange ouvert'
      actions.append(createButton(document, openTradeLabel, 'open-trade', {
        disabled: !canOpenTrade,
        tone: 'primary',
      }))
    }
    actions.append(createButton(document, 'Quitter la session', 'leave-session', {
      disabled: trade.status !== 'closed' && trade.locked === true,
      tone: 'danger',
    }))
    section.append(actions)
  } else {
    section.append(createButton(document, 'Annuler', 'leave-session'))
  }

  root.append(section)
}

function appendRequests(
  document: Document,
  root: HTMLElement,
  social: MultiplayerSocialState,
  invitations: readonly MultiplayerSessionInvitation[],
  session: MultiplayerSessionState,
): void {
  const section = createElement(document, 'section', 'multiplayer-shell-section multiplayer-shell-requests')
  section.dataset.multiplayerSection = 'requests'
  section.append(createHeading(document, 'Demandes', 2))
  const requestCount = social.incoming.length + social.outgoing.length + invitations.length
  if (requestCount === 0) {
    section.append(createEmptyState(document, 'Aucune demande.'))
    root.append(section)
    return
  }
  appendFriendRequests(document, section, 'Amis reçus', 'incoming', social.incoming)
  appendFriendRequests(document, section, 'Amis envoyés', 'outgoing', social.outgoing)

  if (invitations.length > 0) {
    const invitationGroup = createElement(document, 'section', 'multiplayer-shell-request-group')
    invitationGroup.append(createHeading(document, 'Sessions', 3))
    const sessionBusy = session.status !== 'idle' && session.status !== 'error'
    const invitationList = createPaginatedList(document, 'invitations', invitations, 'Aucune.', (invitation) => {
      const item = createElement(document, 'li', 'multiplayer-shell-list-item')
      const name = createElement(document, 'strong')
      name.textContent = invitation.transport === 'server'
        ? `${invitation.fromUserId} · Coop`
        : invitation.fromUserId
      const actions = createElement(document, 'div', 'multiplayer-shell-actions')
      actions.append(
        createButton(document, 'Rejoindre', 'join-invitation', {
          target: invitation.invitationId,
          disabled: sessionBusy,
          tone: 'primary',
        }),
        createButton(document, 'Refuser', 'decline-invitation', { target: invitation.invitationId }),
      )
      item.append(name, actions)
      return item
    })
    invitationGroup.append(invitationList)
    section.append(invitationGroup)
  }
  root.append(section)
}

function appendTradeOffer(
  document: Document,
  root: HTMLElement,
  owner: 'local' | 'remote',
  offer: MultiplayerTradeOfferPreview | undefined,
  accepted: boolean,
  tradeStatus: Exclude<MultiplayerTradeState['status'], 'closed'>,
  tradeLocked: boolean,
): void {
  const article = createElement(document, 'article', 'multiplayer-shell-offer')
  article.dataset.offerOwner = owner
  article.dataset.accepted = String(accepted)
  const header = createElement(document, 'header', 'multiplayer-shell-offer-header')
  header.append(createHeading(document, owner === 'local' ? 'Vous' : 'Partenaire', 3))
  const acceptance = createElement(document, 'span', 'multiplayer-shell-acceptance')
  acceptance.textContent = accepted ? 'PRÊT' : '…'
  acceptance.dataset.accepted = String(accepted)
  header.append(acceptance)
  article.append(header)

  if (!offer) {
    article.append(createEmptyState(document, owner === 'local' ? 'Choisissez une créature.' : "L'autre joueur prépare son offre."))
  } else {
    const preview = createElement(document, 'div', 'multiplayer-shell-offer-preview')
    const visual = offer.createVisual?.()
    if (visual) {
      visual.classList.add('multiplayer-shell-offer-visual')
      visual.setAttribute('aria-hidden', 'true')
      preview.append(visual)
    }
    const copy = createElement(document, 'div', 'multiplayer-shell-offer-copy')
    const primary = createElement(document, 'strong', 'multiplayer-shell-offer-primary')
    primary.textContent = offer.primaryLabel
    copy.append(primary)
    if (offer.secondaryLabel) {
      const secondary = createElement(document, 'span', 'multiplayer-shell-secondary')
      secondary.textContent = offer.secondaryLabel
      copy.append(secondary)
    }
    if (offer.details && offer.details.length > 0) {
      const details = createElement(document, 'dl', 'multiplayer-shell-offer-details')
      for (const detail of offer.details) {
        const label = createElement(document, 'dt')
        label.textContent = detail.label
        const value = createElement(document, 'dd')
        value.textContent = detail.value
        details.append(label, value)
      }
      copy.append(details)
    }
    preview.append(copy)
    article.append(preview)
  }

  if (owner === 'local') {
    const mutable = !tradeLocked && (tradeStatus === 'negotiating' || tradeStatus === 'error')
    if (mutable) {
      article.append(createButton(
        document,
        offer ? 'Modifier' : 'Choisir',
        offer ? 'change-trade-offer' : 'choose-trade-offer',
      ))
    }
  }
  root.append(article)
}

function tradeStatusText(trade: Exclude<MultiplayerTradeState, { status: 'closed' }>): { label: string, error?: boolean } {
  if (trade.status === 'error') return { label: trade.errorMessage ?? "L'échange a échoué.", error: true }
  if (trade.status === 'committed') return { label: 'ÉCHANGE RÉUSSI' }
  if (trade.status === 'committing') return { label: 'ÉCHANGE EN COURS…' }
  if (trade.localAccepted && trade.remoteAccepted) return { label: 'CONFIRMATION…' }
  if (trade.localAccepted) return { label: 'ATTENTE DU PARTENAIRE…' }
  if (trade.remoteAccepted) return { label: 'À VOUS DE CONFIRMER' }
  if (!trade.localOffer || !trade.remoteOffer) return { label: 'CHOISISSEZ VOTRE POKÉMON' }
  return { label: "CONFIRMEZ L'ÉCHANGE" }
}

function appendTrade(document: Document, root: HTMLElement, trade: MultiplayerTradeState): void {
  if (trade.status === 'closed') return
  const section = createElement(document, 'section', 'multiplayer-shell-section multiplayer-shell-trade')
  section.dataset.multiplayerSection = 'trade'
  section.dataset.tradeState = trade.status
  section.append(createHeading(document, 'Échange entre joueurs', 2))
  const offers = createElement(document, 'div', 'multiplayer-shell-offers')
  const tradeLocked = trade.locked === true
  appendTradeOffer(document, offers, 'local', trade.localOffer, trade.localAccepted, trade.status, tradeLocked)
  appendTradeOffer(document, offers, 'remote', trade.remoteOffer, trade.remoteAccepted, trade.status, tradeLocked)
  section.append(offers)
  const status = tradeStatusText(trade)
  section.append(createStatus(document, status.label, status.error))

  const actions = createElement(document, 'div', 'multiplayer-shell-actions multiplayer-shell-trade-actions')
  const mutable = !tradeLocked && (trade.status === 'negotiating' || trade.status === 'error')
  const canAccept = !tradeLocked && trade.status === 'negotiating'
    && trade.localOffer !== undefined
    && trade.remoteOffer !== undefined
    && !trade.localAccepted
  if (trade.status === 'committed') {
    actions.append(createButton(document, 'Nouvel échange', 'open-trade', { tone: 'primary' }))
  } else if (mutable) {
    actions.append(
      createButton(document, 'Annuler', 'cancel-trade', { tone: 'danger' }),
      createButton(document, trade.localAccepted ? 'Accepté' : 'Accepter', 'accept-trade', {
        disabled: !canAccept,
        tone: 'primary',
      }),
    )
  }
  if (actions.children.length > 0) section.append(actions)
  root.append(section)
}

function globalScreenLabel(
  screen: Exclude<MultiplayerGlobalScreen, 'home'>,
  labels: MultiplayerRomLabels,
): string {
  switch (screen) {
    case 'play': return labels.play
    case 'friends': return labels.friends
    case 'requests': return labels.requests
    case 'session': return labels.session
    case 'trade': return labels.trade
    case 'account': return labels.account
  }
}

function createGlobalMenuButton(
  document: Document,
  screen: Exclude<MultiplayerGlobalScreen, 'home'>,
  index: number,
  labels: MultiplayerRomLabels,
  detail?: string,
): HTMLButtonElement {
  const button = createGameMenuButton({
    id: screen,
    index,
    label: globalScreenLabel(screen, labels),
    ownerDocument: document,
    detail,
    selected: index === 0,
  })
  button.dataset.multiplayerAction = 'open-global-screen'
  button.dataset.multiplayerTarget = screen
  button.dataset.multiplayerGlobalTarget = screen
  button.querySelector('small')?.classList.add('multiplayer-global-menu-value')
  return button
}

function createGlobalMenu(
  document: Document,
  snapshot: MultiplayerUiSnapshot,
  labels: MultiplayerRomLabels,
): HTMLElement {
  const requestCount = snapshot.social.incoming.length + snapshot.social.outgoing.length + snapshot.invitations.length
  const onlineFriends = snapshot.social.friends.filter(({ online }) => online).length
  const sessionDetail = snapshot.session.status === 'connected'
    ? snapshot.session.peerUserId
    : snapshot.session.status === 'idle' ? undefined : 'En cours'
  const entries: readonly (readonly [Exclude<MultiplayerGlobalScreen, 'home'>, string | undefined])[] = [
    ['play', undefined],
    ['friends', onlineFriends > 0 ? `${onlineFriends} en ligne` : `${snapshot.social.friends.length}`],
    ['requests', requestCount > 0 ? `${requestCount}` : undefined],
    ['session', sessionDetail],
    ...(snapshot.trade.status === 'closed' ? [] : [['trade', snapshot.trade.status === 'committed' ? 'Terminé' : 'En cours'] as const]),
    ['account', snapshot.connection.status === 'connected' ? snapshot.connection.account.username : undefined],
  ]
  const buttons = entries.map(([screen, detail], index) => createGlobalMenuButton(document, screen, index, labels, detail))
  const menu = createGameMenuNavigation(buttons, 'root', document)
  menu.dataset.multiplayerScreen = 'home'
  menu.setAttribute('aria-label', 'Menu multijoueur')
  return menu
}

function createGlobalPage(
  document: Document,
  screen: Exclude<MultiplayerGlobalScreen, 'home'>,
  labels: MultiplayerRomLabels,
): HTMLElement {
  const page = createElement(document, 'section', 'multiplayer-global-page')
  page.dataset.multiplayerScreen = screen
  const header = createElement(document, 'header', 'multiplayer-global-page-header')
  const title = createHeading(document, globalScreenLabel(screen, labels), 2)
  const back = createButton(document, labels.back, 'back-global-menu')
  back.classList.add('multiplayer-global-back')
  back.setAttribute('aria-label', labels.back)
  const key = createElement(document, 'kbd')
  key.dataset.inputKey = 'cancel'
  key.textContent = 'B'
  back.textContent = ''
  back.append(key)
  header.append(title, back)
  page.append(header)
  return page
}

type MultiplayerInputKind =
  | 'login-username'
  | 'login-password'
  | 'register-username'
  | 'register-password'
  | 'friend-id'

function readInput(root: HTMLElement, kind: MultiplayerInputKind): HTMLInputElement | undefined {
  return root.querySelector<HTMLInputElement>(`[data-multiplayer-input="${kind}"]`) ?? undefined
}

function trimmedInput(root: HTMLElement, kind: 'friend-id'): string | undefined {
  const input = readInput(root, kind)
  const value = input?.value.trim().toLowerCase()
  if (!input || !value) return undefined
  input.value = ''
  return value
}

function targetValue(element: HTMLElement): string | undefined {
  const target = element.dataset.multiplayerTarget
  return target && target.length > 0 ? target : undefined
}

function intentValue(element: HTMLElement): P2pSessionIntent | undefined {
  const intent = element.dataset.multiplayerIntent
  return multiplayerSessionIntents.find((candidate) => candidate === intent)
}

function snapshotPresentationKey(snapshot: MultiplayerUiSnapshot): string {
  return JSON.stringify(snapshot, (_key, value: unknown) => typeof value === 'function' ? undefined : value)
}

function tradeVisualFactories(snapshot: MultiplayerUiSnapshot): readonly [unknown, unknown] {
  if (snapshot.trade.status === 'closed') return [undefined, undefined]
  return [snapshot.trade.localOffer?.createVisual, snapshot.trade.remoteOffer?.createVisual]
}

/**
 * Monte l'interface dans un élément dédié. `update` reconstruit uniquement le
 * DOM de présentation; aucun snapshot n'est conservé dans le contrôleur.
 */
export function createMultiplayerUiShell(options: MultiplayerUiShellOptions): MultiplayerUiShell {
  const { root, ports, present } = options
  const labels = options.labels ?? resolveMultiplayerRomLabels(undefined)
  const accountManagement = options.accountManagement !== false
  const document = root.ownerDocument
  let destroyed = false
  let selectedIntent: P2pSessionIntent | undefined
  let accountMode: MultiplayerAccountMode = 'login'
  let currentScreen: MultiplayerGlobalScreen = 'home'
  let previousConnectionStatus: MultiplayerConnectionState['status'] | undefined
  let previousTradeStatus: MultiplayerTradeState['status'] | undefined
  let previousSessionStatus: MultiplayerSessionState['status'] | undefined
  let previousIncomingCount: number | undefined
  let previousRemoteAccepted: boolean | undefined
  let previousPresentationKey: string | undefined
  let previousTradeVisualFactories: readonly [unknown, unknown] = [undefined, undefined]

  const controlIsVisible = (control: HTMLElement): boolean => {
    const candidate = control as HTMLElement & { disabled?: boolean }
    if (candidate.hidden || candidate.disabled) return false
    for (let ancestor = control.parentElement; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
      if (ancestor.hidden) return false
    }
    return true
  }

  const focusFirstControl = (screen: MultiplayerGlobalScreen): void => {
    const page = root.querySelector<HTMLElement>(`[data-multiplayer-screen="${screen}"]`)
    const control = [...(page?.querySelectorAll<HTMLElement>('button, input') ?? [])].find(controlIsVisible)
    control?.focus({ preventScroll: true })
  }

  const setCurrentScreen = (screen: MultiplayerGlobalScreen, focus = true): void => {
    currentScreen = screen
    root.dataset.multiplayerCurrentScreen = screen
    if (screen === 'home') root.classList.add('game-menu', 'ui-menu', 'ui-menu-root')
    else root.classList.remove('game-menu', 'ui-menu', 'ui-menu-root')
    for (const page of root.querySelectorAll<HTMLElement>('[data-multiplayer-screen]')) {
      page.hidden = page.dataset.multiplayerScreen !== screen
    }
    if (focus) focusFirstControl(screen)
  }

  const syncCollectionPage = (paged: HTMLElement, requestedPage: number, focus: boolean): void => {
    const collection = paged.dataset.multiplayerCollection
    if (!collection) return
    const pageCount = Number.parseInt(paged.dataset.multiplayerPageCount ?? '1', 10)
    const next = Math.max(0, Math.min(pageCount - 1, requestedPage))
    paged.dataset.multiplayerCurrentPage = String(next)
    for (const page of paged.querySelectorAll<HTMLElement>('[data-multiplayer-collection-page]')) {
      page.hidden = Number.parseInt(page.dataset.multiplayerCollectionPage ?? '-1', 10) !== next
    }
    const counter = paged.querySelector<HTMLElement>(`[data-multiplayer-page-counter="${collection}"]`)
    if (counter) counter.textContent = `${next + 1}/${pageCount}`
    for (const button of paged.querySelectorAll<HTMLButtonElement>('[data-multiplayer-action="navigate-collection"]')) {
      const buttonTarget = targetValue(button)
      button.disabled = buttonTarget?.endsWith(':previous') === true ? next === 0 : next === pageCount - 1
    }
    if (focus) {
      const page = paged.querySelector<HTMLElement>(`[data-multiplayer-collection-page="${next}"]`)
      ;[...(page?.querySelectorAll<HTMLElement>('button, input') ?? [])].find(controlIsVisible)?.focus({ preventScroll: true })
    }
  }

  const navigateCollection = (target: string): void => {
    const separator = target.lastIndexOf(':')
    if (separator <= 0) return
    const collection = target.slice(0, separator)
    const direction = target.slice(separator + 1)
    if (direction !== 'previous' && direction !== 'next') return
    const paged = root.querySelector<HTMLElement>(`[data-multiplayer-collection="${collection}"]`)
    if (!paged) return
    const current = Number.parseInt(paged.dataset.multiplayerCurrentPage ?? '0', 10)
    syncCollectionPage(paged, current + (direction === 'previous' ? -1 : 1), true)
  }

  const submitCredentials = (mode: 'login' | 'register'): void => {
    const username = readInput(root, `${mode}-username`)
    const password = readInput(root, `${mode}-password`)
    const control = root.querySelector<HTMLButtonElement>(`[data-multiplayer-action="${mode}"]`)
    if (!username || !password || control?.disabled || !username.value.trim() || !password.value) return
    const credentials = Object.freeze({ username: username.value.trim(), password: password.value })
    username.value = ''
    password.value = ''
    ports[mode](credentials)
  }

  const selectSessionIntent = (intent: P2pSessionIntent): void => {
    selectedIntent = intent
    for (const shortcut of root.querySelectorAll<HTMLButtonElement>('[data-multiplayer-action="select-session-intent"]')) {
      const selected = intentValue(shortcut) === intent
      shortcut.setAttribute('aria-expanded', String(selected))
      shortcut.setAttribute('aria-pressed', String(selected))
    }
    for (const choice of root.querySelectorAll<HTMLElement>('[data-multiplayer-intent-choice]')) {
      choice.hidden = choice.dataset.multiplayerIntentChoice !== intent
    }
  }

  const focusFriendActivity = (intent: P2pSessionIntent): void => {
    setCurrentScreen('friends', false)
    const button = [...root.querySelectorAll<HTMLButtonElement>('[data-multiplayer-action="request-friend-session"]')]
      .find((candidate) => intentValue(candidate) === intent && !candidate.disabled)
    if (!button) return
    button.focus({ preventScroll: true })
  }

  const handleAction = (event: Event): void => {
    const origin = event.target as { closest?: (selector: string) => Element | null } | null
    const actionElement = origin?.closest?.('[data-multiplayer-action]') as HTMLElement | null | undefined
    if (!actionElement || !root.contains(actionElement) || (actionElement as HTMLButtonElement).disabled) return
    const action = actionElement.dataset.multiplayerAction as MultiplayerAction | undefined
    const target = targetValue(actionElement)
    switch (action) {
      case 'open-global-screen': {
        if (target === 'play' || target === 'friends' || target === 'requests'
          || target === 'session' || target === 'trade' || target === 'account') {
          setCurrentScreen(target)
        }
        return
      }
      case 'back-global-menu': setCurrentScreen('home'); return
      case 'select-account-mode': {
        if (target !== 'login' && target !== 'register') return
        accountMode = target
        for (const form of root.querySelectorAll<HTMLElement>('[data-multiplayer-account-form]')) {
          form.hidden = form.dataset.multiplayerAccountForm !== accountMode
        }
        for (const button of root.querySelectorAll<HTMLButtonElement>('[data-multiplayer-action="select-account-mode"]')) {
          button.setAttribute('aria-pressed', String(targetValue(button) === accountMode))
        }
        readInput(root, `${accountMode}-username`)?.focus({ preventScroll: true })
        return
      }
      case 'navigate-collection': if (target) navigateCollection(target); return
      case 'login': submitCredentials('login'); return
      case 'register': submitCredentials('register'); return
      case 'retry-connection': ports.retryConnection?.(); return
      case 'logout': ports.logout(); return
      case 'toggle-password': {
        if (!target) return
        const input = readInput(root, target as MultiplayerInputKind)
        if (!input || !target.endsWith('-password')) return
        const revealed = input.type === 'password'
        input.type = revealed ? 'text' : 'password'
        actionElement.textContent = revealed ? 'Masquer' : 'Afficher'
        actionElement.setAttribute('aria-pressed', String(revealed))
        return
      }
      case 'refresh-social': ports.refreshSocial(); return
      case 'send-friend-request': {
        const userId = trimmedInput(root, 'friend-id')
        if (userId) ports.sendFriendRequest(userId)
        return
      }
      case 'accept-friend-request': if (target) ports.acceptFriendRequest(target); return
      case 'decline-friend-request': if (target) ports.declineFriendRequest(target); return
      case 'cancel-friend-request': if (target) ports.cancelFriendRequest(target); return
      case 'remove-friend': if (target) ports.removeFriend(target); return
      case 'invite-friend': if (target) ports.inviteFriend(target); return
      case 'join-invitation': if (target) ports.joinInvitation(target); return
      case 'decline-invitation': if (target) ports.declineInvitation(target); return
      case 'leave-session': ports.leaveSession(); return
      case 'open-trade': ports.openTrade(); return
      case 'choose-trade-offer': ports.chooseTradeOffer(); return
      case 'change-trade-offer': ports.changeTradeOffer(); return
      case 'cancel-trade': ports.cancelTrade(); return
      case 'accept-trade': ports.acceptTrade(); return
      case 'open-leaderboard': ports.openLeaderboard?.(); return
      case 'select-session-intent': {
        const intent = intentValue(actionElement)
        if (intent) selectSessionIntent(intent)
        return
      }
      case 'request-random-session': {
        const intent = intentValue(actionElement)
        if (intent) ports.requestSession?.({ intent, target: { kind: 'random' } })
        return
      }
      case 'focus-friend-session': {
        const intent = intentValue(actionElement)
        if (intent) focusFriendActivity(intent)
        return
      }
      case 'request-friend-session': {
        const intent = intentValue(actionElement)
        if (intent && target) ports.requestSession?.({ intent, target: { kind: 'friend', userId: target } })
        return
      }
      case 'accept-session-intent': {
        const intent = intentValue(actionElement)
        if (intent && target) ports.acceptSessionIntent?.({ peerUserId: target, intent })
        return
      }
      case 'decline-session-intent': {
        const intent = intentValue(actionElement)
        if (intent && target) ports.declineSessionIntent?.({ peerUserId: target, intent })
        return
      }
      case undefined: return
    }
  }

  const handleKeyDown = (event: KeyboardEvent): void => {
    const origin = event.target as HTMLElement | null
    if (event.key !== 'Enter' || !root.contains(origin)) return
    const kind = origin?.dataset.multiplayerInput
    if (kind !== 'login-username' && kind !== 'login-password'
      && kind !== 'register-username' && kind !== 'register-password') return
    event.preventDefault()
    submitCredentials(kind.startsWith('login-') ? 'login' : 'register')
  }

  root.classList.add('multiplayer-shell')
  root.addEventListener('click', handleAction)
  root.addEventListener('keydown', handleKeyDown)

  return Object.freeze({
    update(snapshot) {
      if (destroyed) throw new Error("L'interface multijoueur a été détruite.")
      const presentationKey = snapshotPresentationKey(snapshot)
      const visualFactories = tradeVisualFactories(snapshot)
      if (presentationKey === previousPresentationKey
        && visualFactories[0] === previousTradeVisualFactories[0]
        && visualFactories[1] === previousTradeVisualFactories[1]) return
      const inputValues = new Map<MultiplayerInputKind, string>()
      for (const input of root.querySelectorAll<HTMLInputElement>('[data-multiplayer-input]')) {
        const kind = input.dataset.multiplayerInput as MultiplayerInputKind | undefined
        if (kind) inputValues.set(kind, input.value)
      }
      const collectionPages = new Map<string, number>()
      for (const collection of root.querySelectorAll<HTMLElement>('[data-multiplayer-collection]')) {
        const id = collection.dataset.multiplayerCollection
        if (id) collectionPages.set(id, Number.parseInt(collection.dataset.multiplayerCurrentPage ?? '0', 10))
      }
      const active = root.contains(document.activeElement)
        ? document.activeElement as HTMLElement
        : undefined
      const activeIdentity = active ? {
        action: active.dataset.multiplayerAction,
        input: active.dataset.multiplayerInput,
        target: active.dataset.multiplayerTarget,
        intent: active.dataset.multiplayerIntent,
      } : undefined

      const connected = snapshot.connection.status === 'connected'
      root.dataset.multiplayerConnectionState = snapshot.connection.status
      root.dataset.multiplayerSessionState = snapshot.session.status
      root.dataset.multiplayerTradeState = snapshot.trade.status
      if (!connected) currentScreen = 'home'
      else if (previousConnectionStatus !== 'connected') currentScreen = 'home'
      else if (snapshot.trade.status !== 'closed' && previousTradeStatus === 'closed') currentScreen = 'trade'
      else if (snapshot.trade.status === 'closed' && currentScreen === 'trade') {
        currentScreen = snapshot.session.status === 'idle' ? 'home' : 'session'
      }
      else if (snapshot.session.status === 'consent' && previousSessionStatus !== 'consent') currentScreen = 'session'

      const surface = createElement(document, 'div', 'multiplayer-shell-surface')
      if (connected) {
        const hub = snapshot.hub ?? unavailableHubState
        surface.append(createGlobalMenu(document, snapshot, labels))

        const play = createGlobalPage(document, 'play', labels)
        appendMultiplayerHub(document, play, hub, snapshot.social, snapshot.session, ports, selectedIntent)
        surface.append(play)

        const friends = createGlobalPage(document, 'friends', labels)
        appendFriendList(document, friends, snapshot.social, snapshot.session, hub, ports.requestSession !== undefined)
        surface.append(friends)

        const requests = createGlobalPage(document, 'requests', labels)
        appendRequests(document, requests, snapshot.social, snapshot.invitations, snapshot.session)
        surface.append(requests)

        const session = createGlobalPage(document, 'session', labels)
        appendSession(document, session, snapshot.session, snapshot.trade, ports)
        surface.append(session)

        const trade = createGlobalPage(document, 'trade', labels)
        appendTrade(document, trade, snapshot.trade)
        surface.append(trade)

        const account = createGlobalPage(document, 'account', labels)
        appendConnection(
          document,
          account,
          snapshot.connection,
          snapshot.trade.status !== 'closed' && snapshot.trade.locked === true,
          ports.retryConnection !== undefined,
          accountMode,
          accountManagement,
        )
        surface.append(account)
      } else {
        surface.dataset.multiplayerScreen = 'auth'
        appendConnection(
          document,
          surface,
          snapshot.connection,
          snapshot.trade.status !== 'closed' && snapshot.trade.locked === true,
          ports.retryConnection !== undefined,
          accountMode,
          accountManagement,
        )
      }
      root.replaceChildren(surface)
      root.hidden = false
      if (connected) setCurrentScreen(currentScreen, false)
      else {
        root.dataset.multiplayerCurrentScreen = 'auth'
        root.classList.remove('game-menu', 'ui-menu', 'ui-menu-root')
      }

      for (const [kind, value] of inputValues) {
        const input = readInput(root, kind)
        if (input) input.value = value
      }
      for (const [collection, page] of collectionPages) {
        const paged = root.querySelector<HTMLElement>(`[data-multiplayer-collection="${collection}"]`)
        if (paged) syncCollectionPage(paged, page, false)
      }
      if (activeIdentity) {
        const controls = root.querySelectorAll<HTMLElement>('button, input')
        const replacement = [...controls].find((control) => (
          control.dataset.multiplayerAction === activeIdentity.action
          && control.dataset.multiplayerInput === activeIdentity.input
          && control.dataset.multiplayerTarget === activeIdentity.target
          && control.dataset.multiplayerIntent === activeIdentity.intent
          && controlIsVisible(control)
        ))
        replacement?.focus({ preventScroll: true })
      }
      if (previousConnectionStatus !== undefined) {
        const incomingCount = snapshot.social.incoming.length + snapshot.invitations.length
        if (snapshot.connection.status === 'connected' && previousConnectionStatus !== 'connected') {
          present?.({ kind: 'connected' })
        } else if (previousIncomingCount !== undefined && incomingCount > previousIncomingCount) {
          present?.({ kind: 'request-received' })
        }
        if (snapshot.session.status === 'consent' && previousSessionStatus !== 'consent') {
          present?.({ kind: 'session-consent' })
        } else if (snapshot.session.status === 'connected' && previousSessionStatus !== 'connected') {
          present?.({ kind: 'session-ready' })
        }
        const remoteAccepted = snapshot.trade.status === 'closed' ? false : snapshot.trade.remoteAccepted
        if (remoteAccepted && previousRemoteAccepted === false && snapshot.trade.status === 'negotiating') {
          present?.({ kind: 'trade-accepted' })
        }
        if (snapshot.trade.status === 'committing' && previousTradeStatus !== 'committing') {
          present?.({ kind: 'trade-committing' })
        } else if (snapshot.trade.status === 'committed' && previousTradeStatus !== 'committed') {
          present?.({ kind: 'trade-committed' })
        } else if ((snapshot.trade.status === 'error' && previousTradeStatus !== 'error')
          || (snapshot.session.status === 'error' && previousSessionStatus !== 'error')
          || (snapshot.connection.status === 'error' && previousConnectionStatus !== 'error')) {
          present?.({ kind: 'error' })
        }
      }
      previousIncomingCount = snapshot.social.incoming.length + snapshot.invitations.length
      previousRemoteAccepted = snapshot.trade.status === 'closed' ? false : snapshot.trade.remoteAccepted
      previousConnectionStatus = snapshot.connection.status
      previousTradeStatus = snapshot.trade.status
      previousSessionStatus = snapshot.session.status
      previousPresentationKey = presentationKey
      previousTradeVisualFactories = visualFactories
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      root.removeEventListener('click', handleAction)
      root.removeEventListener('keydown', handleKeyDown)
      selectedIntent = undefined
      previousConnectionStatus = undefined
      previousTradeStatus = undefined
      previousSessionStatus = undefined
      previousIncomingCount = undefined
      previousRemoteAccepted = undefined
      previousPresentationKey = undefined
      previousTradeVisualFactories = [undefined, undefined]
      delete root.dataset.multiplayerCurrentScreen
      root.classList.remove('game-menu', 'ui-menu', 'ui-menu-root')
      delete root.dataset.multiplayerConnectionState
      delete root.dataset.multiplayerSessionState
      delete root.dataset.multiplayerTradeState
      root.replaceChildren()
      root.classList.remove('multiplayer-shell')
      root.hidden = true
    },
  })
}
