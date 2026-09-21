import type { InGameHudElements } from './game/ui/inGameHud'
import type { PokegearFlyTransitionElements } from './game/pokegear/pokegearFlyTransition'

export type AppShell = {
  picker: HTMLInputElement
  chooseRom: HTMLButtonElement
  runtimePanel: HTMLElement
  status: HTMLSpanElement
  saveStatus: HTMLElement
  details: HTMLDivElement
  inventorySection: HTMLElement
  inventorySummary: HTMLParagraphElement
  inventoryNote: HTMLParagraphElement
  filter: HTMLInputElement
  fileListBody: HTMLTableSectionElement
  archiveInspector: HTMLElement
  archiveTitle: HTMLHeadingElement
  archiveSummary: HTMLParagraphElement
  archiveListBody: HTMLTableSectionElement
  archiveNote: HTMLParagraphElement
  closeArchive: HTMLButtonElement
  graphicPreview: HTMLElement
  graphicCanvas: HTMLCanvasElement
  graphicCaption: HTMLParagraphElement
  resourceCatalog: HTMLElement
  catalogGrid: HTMLElement
  gameMenu: HTMLElement
  pcBox: HTMLElement
  safariCustomizer: HTMLElement
  safariDecorator: HTMLElement
  photoAlbum: HTMLElement
  inGameHud: InGameHudElements
  runtimePosition: HTMLSpanElement
  botToggle?: HTMLButtonElement
  botStatus?: HTMLSpanElement
  realtimeTestPanel?: HTMLElement
  screenCanvas: HTMLCanvasElement
  runtimeCanvas: HTMLCanvasElement
  gameMenuButton: HTMLButtonElement
  gameMenuButtonKey: HTMLElement
  fullscreenButton: HTMLButtonElement
  bugReportModal: HTMLElement
  bugReportDescription: HTMLElement
  bugReportPreview: HTMLImageElement
  bugReportStatus: HTMLElement
  bugReportCancel: HTMLButtonElement
  bugReportEdit: HTMLButtonElement
  bugReportDownload: HTMLButtonElement
  fieldFade: HTMLDivElement
  pokegearFlyTransition: PokegearFlyTransitionElements
  fieldDialogue: HTMLElement
  fieldDialogueSpeaker: HTMLElement
  fieldDialogueText: HTMLParagraphElement
  fieldChoice: HTMLElement
  fieldNumber: HTMLFormElement
  fieldNumberInput: HTMLInputElement
  fieldNickname: HTMLFormElement
  fieldNicknameInput: HTMLInputElement
  fieldEasyChat: HTMLElement
  fieldEasyChatCategories: HTMLElement
  fieldEasyChatWords: HTMLElement
  fieldPokeathlon: HTMLElement
  fieldPokeathlonTitle: HTMLElement
  fieldPokeathlonContent: HTMLElement
  fieldFrontierRecords: HTMLElement
  fieldFrontierRecordsTitle: HTMLElement
  fieldFrontierRecordsView: HTMLElement
  fieldFrontierRecordsContent: HTMLElement
  fieldAlphPuzzle: HTMLElement
  fieldAlphPuzzleBoard: HTMLElement
  fieldAlphPuzzleHint: HTMLElement
  fieldAlphInscription: HTMLElement
  fieldAlphInscriptionVisual: HTMLElement
  fieldAlphInscriptionWord: HTMLElement
  modalConfirm: HTMLElement
  modalConfirmText: HTMLParagraphElement
  battleScreen: HTMLElement
  battleBackground: HTMLElement
  battleEffects: HTMLCanvasElement
  battleOpponentTrainer: HTMLElement
  battleOpponentSprite: HTMLElement
  battlePlayerSprite: HTMLElement
  battleOpponentParty: HTMLElement
  battlePlayerParty: HTMLElement
  battleOpponentName: HTMLElement
  battlePlayerName: HTMLElement
  battleOpponentLevel: HTMLElement
  battlePlayerLevel: HTMLElement
  battleOpponentHp: HTMLProgressElement
  battlePlayerHp: HTMLProgressElement
  battlePlayerHpText: HTMLElement
  battlePlayerExp: HTMLProgressElement
  battleMessage: HTMLElement
  battleCommands: HTMLElement
  battleMoves: HTMLElement
  battleEvolution: HTMLElement
  battleEvolutionKicker: HTMLElement
  battleEvolutionFrom: HTMLElement
  battleEvolutionTo: HTMLElement
  battleEvolutionTitle: HTMLElement
  battleEvolutionText: HTMLElement
}

const shellMarkup = `
  <main class="game-shell">
    <input id="rom-picker" type="file" accept=".nds,application/octet-stream" hidden>
    <div class="runtime-welcome">
      <h1>Échos d’Or &amp; d’Argent <small>Alpha</small></h1>
      <p>Projet fan non officiel autour de HGSS. Version alpha en développement.</p>
      <button id="choose-rom" class="rom-loader" type="button">Charger la ROM</button>
      <p>Compatibilité actuelle : HeartGold, édition française.</p>
      <p>Aucun jeu fourni. Utilisez uniquement un fichier que vous êtes autorisé à utiliser.</p>
      <p>La ROM et vos sauvegardes restent dans ce navigateur. Exportez régulièrement vos sauvegardes.</p>
    </div>
    <section class="runtime-panel" aria-label="Ecran du jeu" tabindex="-1">
      <a class="runtime-notice-link" href="${import.meta.env.BASE_URL}NOTICE.txt" target="_blank" rel="noopener noreferrer">Alpha · Mentions et confidentialité</a>
      <button id="fullscreen-button" class="fullscreen-button" type="button" title="Passer en plein écran" aria-label="Passer en plein écran" data-bug-report-exclude>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v3H7v4H4V4Zm9 0h7v7h-3V7h-4V4ZM4 13h3v4h4v3H4v-7Zm13 0h3v7h-7v-3h4v-4Z"/></svg>
      </button>
      <button id="game-menu-button" class="game-menu-trigger" type="button" aria-label="Ouvrir le menu du jeu" aria-controls="game-menu" aria-expanded="false" data-bug-report-exclude><kbd id="game-menu-button-key">M</kbd></button>
      <canvas id="runtime-canvas" aria-label="Ecran du jeu"></canvas>
      <canvas id="screen-canvas" aria-label="Ecran 2D du jeu" hidden></canvas>
      <div id="field-fade" class="field-fade" aria-hidden="true"></div>
      <section id="pokegear-fly-transition" class="pokegear-fly-transition" aria-hidden="true" hidden>
        <div id="pokegear-fly-scene" class="pokegear-fly-scene" aria-hidden="true"></div>
        <div class="pokegear-fly-speed-lines" aria-hidden="true"></div>
        <div id="pokegear-fly-carrier" class="pokegear-fly-carrier" aria-hidden="true">
          <span id="pokegear-fly-carrier-asset" class="pokegear-fly-carrier-asset"></span>
          <span class="pokegear-fly-rider"></span>
        </div>
        <div id="pokegear-fly-veil" class="pokegear-fly-veil" aria-hidden="true"></div>
      </section>
      <aside id="in-game-hud" class="in-game-hud" hidden>
        <span class="in-game-hud-location">
          <strong id="in-game-hud-location"></strong>
          <small id="in-game-hud-region"></small>
        </span>
        <span class="in-game-hud-clock" aria-hidden="true">
          <i class="in-game-hud-phase-icon"></i>
          <span><time id="in-game-hud-clock"></time><small id="in-game-hud-phase"></small></span>
        </span>
        <strong id="in-game-hud-money" class="in-game-hud-money"></strong>
      </aside>
      <section id="field-dialogue" class="field-dialogue" role="status" aria-live="polite" hidden>
        <strong id="field-dialogue-speaker" class="field-dialogue-speaker" hidden></strong>
        <span id="field-dialogue-text"></span>
        <span class="field-dialogue-prompt" aria-hidden="true">▼</span>
        <span class="field-dialogue-control" aria-hidden="true"><kbd data-input-key="confirm">Entrée</kbd></span>
      </section>
      <nav id="field-choice" class="field-choice" aria-label="Choix" hidden></nav>
      <form id="field-nickname" class="field-nickname" hidden>
        <label for="field-nickname-input"></label>
        <input id="field-nickname-input" type="text" maxlength="10" autocomplete="off" spellcheck="false" aria-label="Surnom du Pokémon" readonly>
        <span class="field-nickname-count" aria-live="polite">0/10</span>
        <button type="submit" data-rom-label="confirm"></button>
        <button type="button" data-nickname-cancel data-rom-label="close"></button>
      </form>
      <form id="field-number" class="field-number" hidden>
        <input id="field-number-input" type="number" min="0" step="1" inputmode="numeric" aria-label="Montant" readonly>
        <button type="submit" title="Valider" aria-label="Valider">✓</button>
        <button type="button" data-number-cancel title="Annuler" aria-label="Annuler">✕</button>
      </form>
      <section id="field-easy-chat" class="field-easy-chat" role="dialog" aria-modal="true" aria-labelledby="field-easy-chat-title" hidden>
        <header><span id="field-easy-chat-title" data-rom-label="easy-chat-title"></span><strong></strong></header>
        <nav id="field-easy-chat-categories" aria-label="Catégories"></nav>
        <div id="field-easy-chat-words" class="field-easy-chat-words" role="listbox"></div>
        <button type="button" data-easy-chat-cancel data-rom-label="easy-chat-cancel"></button>
      </section>
      <section id="field-pokeathlon" class="field-pokeathlon" aria-modal="true" aria-labelledby="field-pokeathlon-title" role="dialog" hidden>
        <header><span data-rom-label="pokeathlon-title"></span><h2 id="field-pokeathlon-title"></h2></header>
        <div id="field-pokeathlon-content" class="field-pokeathlon-content"></div>
        <button type="button" data-pokeathlon-close data-rom-label="pokeathlon-close"></button>
      </section>
      <section id="field-frontier-records" class="field-frontier-records" aria-modal="true" aria-labelledby="field-frontier-records-title" role="dialog" hidden>
        <header><span data-rom-label="frontier-title"></span><h2 id="field-frontier-records-title"></h2></header>
        <div class="field-frontier-records-tabs"><strong id="field-frontier-records-view"></strong></div>
        <div id="field-frontier-records-content" class="field-frontier-records-content"></div>
        <button type="button" data-frontier-records-close data-rom-label="frontier-close"></button>
      </section>
      <section id="pc-box" class="pc-box-screen" aria-modal="true" role="dialog" hidden></section>
      <section id="safari-customizer" hidden></section>
      <section id="safari-decorator" hidden></section>
      <section id="field-photo-album" class="field-photo-album" hidden></section>
      <section id="field-alph-puzzle" class="field-alph-puzzle" aria-modal="true" aria-labelledby="field-alph-puzzle-title" role="dialog" hidden>
        <header><span id="field-alph-puzzle-title"></span><strong id="field-alph-puzzle-hint"></strong></header>
        <div id="field-alph-puzzle-board" class="field-alph-puzzle-board" role="grid" tabindex="0"></div>
        <button type="button" data-alph-puzzle-quit data-rom-label="alph-quit"></button>
      </section>
      <section id="field-alph-inscription" class="field-alph-inscription" aria-modal="true" aria-labelledby="field-alph-inscription-word" role="dialog" hidden>
        <div id="field-alph-inscription-visual" class="field-alph-inscription-visual" aria-hidden="true"></div>
        <strong id="field-alph-inscription-word"></strong>
      </section>
      <section id="modal-confirm" class="modal-confirm" role="dialog" aria-modal="true" aria-labelledby="modal-confirm-title" hidden>
        <span class="modal-confirm-kicker" aria-hidden="true"></span>
        <h2 id="modal-confirm-title" data-rom-label="confirm"></h2>
        <p id="modal-confirm-text"></p>
        <nav aria-label="Réponse">
          <button type="button" data-confirm-value="false" aria-current="true"></button>
          <button type="button" data-confirm-value="true"></button>
        </nav>
      </section>
      <section id="bug-report-modal" class="bug-report-modal" role="dialog" aria-modal="true" aria-labelledby="bug-report-title" hidden data-bug-report-exclude>
        <span class="bug-report-kicker">Diagnostic local</span>
        <h2 id="bug-report-title">Signaler un bug</h2>
        <p>Décris ce que tu faisais, le résultat observé et ce qui devait arriver.</p>
        <img id="bug-report-preview" alt="Aperçu de la capture jointe au rapport">
        <section class="bug-report-description-summary" aria-labelledby="bug-report-description-label">
          <strong id="bug-report-description-label">Description du problème</strong>
          <p id="bug-report-description" data-placeholder="Ex. Je sors de la maison de M. Pokémon, puis l’écran reste noir…">Aucune description.</p>
        </section>
        <small id="bug-report-status" role="status" aria-live="polite">La capture et l’état du jeu sont prêts.</small>
        <nav aria-label="Actions du rapport">
          <button id="bug-report-cancel" type="button">Annuler</button>
          <button id="bug-report-edit" type="button"><kbd class="bug-report-control-hint" data-input-key="secondary" aria-hidden="true">X</kbd> Modifier</button>
          <button id="bug-report-download" type="button">Enregistrer le rapport</button>
        </nav>
      </section>
      <section id="battle-screen" class="battle-screen" hidden aria-label="Combat Pokémon">
        <div class="battle-stage">
          <div id="battle-background" class="battle-background" aria-hidden="true"></div>
          <div class="battle-atmosphere" aria-hidden="true"></div>
          <div class="battle-depth-haze" aria-hidden="true"><i></i><i></i><i></i></div>
          <div class="battle-scene-light" aria-hidden="true"></div>
          <div class="battle-terrain" aria-hidden="true">
            <span class="battle-platform battle-platform-opponent"></span>
            <span class="battle-platform battle-platform-player"></span>
          </div>
          <canvas id="battle-effects" class="battle-effects" width="256" height="192" aria-hidden="true"></canvas>
          <div id="battle-opponent-trainer" class="battle-trainer battle-trainer-opponent" aria-hidden="true" hidden></div>
          <div class="battle-pokeball battle-pokeball-opponent" aria-hidden="true"></div>
          <div class="battle-pokeball battle-pokeball-player" aria-hidden="true"></div>
          <div id="battle-opponent-sprite" class="battle-pokemon-sprite battle-pokemon-sprite-opponent" aria-hidden="true"></div>
          <div id="battle-player-sprite" class="battle-pokemon-sprite battle-pokemon-sprite-player" aria-hidden="true"></div>
          <div class="battle-pokemon-sprite battle-pokemon-sprite-opponent battle-pokemon-sprite-secondary" data-double-sprite="opponent-1" aria-hidden="true" hidden></div>
          <div class="battle-pokemon-sprite battle-pokemon-sprite-player battle-pokemon-sprite-secondary" data-double-sprite="player-1" aria-hidden="true" hidden></div>
          <div id="battle-opponent-party" class="battle-party-gauge battle-party-gauge-opponent" aria-hidden="true" hidden></div>
          <div id="battle-player-party" class="battle-party-gauge battle-party-gauge-player" aria-hidden="true" hidden></div>
          <section class="battle-stat-gains" hidden></section>
          <section class="battle-hud battle-hud-opponent">
            <div><strong id="battle-opponent-name"></strong><span class="battle-condition" hidden></span><span id="battle-opponent-level"></span></div>
            <span class="battle-types" aria-label="Types"></span>
            <label>PV <progress id="battle-opponent-hp" max="1" value="1" aria-label="PV adversaire"></progress></label>
          </section>
          <section class="battle-hud battle-hud-player">
            <div><strong id="battle-player-name"></strong><span class="battle-condition" hidden></span><span id="battle-player-level"></span></div>
            <span class="battle-types" aria-label="Types"></span>
            <label>PV <progress id="battle-player-hp" max="1" value="1" aria-label="PV du Pokémon joueur"></progress></label>
            <span id="battle-player-hp-text" class="battle-hp-text"></span>
            <label class="battle-exp">EXP <progress id="battle-player-exp" max="1" value="0" aria-label="Expérience du Pokémon joueur"></progress></label>
          </section>
          <section class="battle-hud battle-hud-opponent battle-hud-secondary" data-double-hud="opponent-1" hidden>
            <div><strong></strong><em class="battle-condition" hidden></em><span></span></div><span class="battle-types" aria-label="Types"></span><label>PV <progress max="1" value="1" aria-label="PV adversaire secondaire"></progress></label>
          </section>
          <section class="battle-hud battle-hud-player battle-hud-secondary" data-double-hud="player-1" hidden>
            <div><strong></strong><em class="battle-condition" hidden></em><span></span></div><span class="battle-types" aria-label="Types"></span><label>PV <progress max="1" value="1" aria-label="PV allié secondaire"></progress></label><span class="battle-hp-text"></span><label class="battle-exp">EXP <progress max="1" value="0" aria-label="Expérience alliée"></progress></label>
          </section>
          <div class="battle-impact-flash" aria-hidden="true"></div>
          <div class="battle-scene-curtain" aria-hidden="true"></div>
        </div>
        <section id="battle-evolution" class="battle-evolution" role="dialog" aria-modal="true" aria-labelledby="battle-evolution-title" hidden>
          <div class="battle-evolution-rings" aria-hidden="true"><i></i><i></i><i></i></div>
          <div class="battle-evolution-particles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <div class="battle-evolution-flash" aria-hidden="true"></div>
          <span id="battle-evolution-kicker" class="battle-evolution-kicker"></span>
          <div class="battle-evolution-sprites" aria-hidden="true">
            <div id="battle-evolution-from" class="battle-evolution-sprite battle-evolution-from"></div>
            <div id="battle-evolution-to" class="battle-evolution-sprite battle-evolution-to"></div>
          </div>
          <h2 id="battle-evolution-title"></h2>
          <p id="battle-evolution-text"></p>
          <span class="battle-evolution-prompt" aria-hidden="true">▼</span>
        </section>
        <div class="battle-command-deck">
          <section id="battle-message" class="battle-message" role="status" aria-live="polite"></section>
          <nav id="battle-commands" class="battle-commands" aria-label="Commandes de combat"></nav>
          <nav id="battle-moves" class="battle-moves" aria-label="Capacités" hidden></nav>
        </div>
        <footer class="battle-controls-footer" aria-label="Commandes disponibles">
          <button class="ui-menu-hint" type="button" data-battle-control="confirm" data-input="confirm" data-key="Entrée"></button>
          <button class="ui-menu-hint" type="button" data-battle-control="cancel" data-input="cancel" data-key="Échap"></button>
        </footer>
      </section>
      <p id="save-status" class="save-persistence-alert" role="alert" aria-live="assertive" hidden></p>
      <span id="runtime-status" class="dev-only" role="status" aria-live="polite">Runtime en attente d'une ROM</span>
      <span id="runtime-position" class="dev-only">Position 0, 0</span>
      ${import.meta.env.DEV
        ? `<style>
        .bot-controls{position:absolute;z-index:5;top:max(14px,env(safe-area-inset-top));left:max(14px,env(safe-area-inset-left));display:grid;gap:6px;max-width:min(340px,calc(100vw - 28px));padding:9px 11px;border:1px solid rgba(255,255,255,.35);border-radius:7px;color:#f8f8f8;background:rgba(10,17,22,.78);box-shadow:0 3px 16px rgba(0,0,0,.36)}
        .bot-controls button{min-height:34px;border:1px solid rgba(255,255,255,.45);border-radius:4px;color:inherit;background:rgba(35,75,91,.88);font-size:14px;font-weight:700}.bot-controls button:focus-visible{background:rgba(48,105,126,.96);outline:2px solid #f8f8f8;outline-offset:2px}.bot-controls button:disabled{cursor:not-allowed;opacity:.58}.bot-controls span{font-size:12px;line-height:1.35}
        @media(max-width:620px){.bot-controls{top:max(72px,calc(env(safe-area-inset-top) + 72px))}}
        </style><section class="bot-controls" aria-label="Outils de test en temps réel" hidden>
        <button id="toggle-bot" type="button" disabled>Bot : démarrer</button>
        <span id="bot-status" aria-live="polite">Chargez une ROM pour activer le bot.</span>
        <section id="realtime-test-panel" data-debug-marker="pokemaster-debug-tape-v1" aria-label="Batterie pilotée par fichier texte" style="display:grid;gap:7px;padding-top:8px;border-top:1px solid rgba(255,255,255,.28)" hidden>
          <strong>Batterie temps réel (.txt)</strong>
          <label>Scénario <input type="file" accept=".txt,text/plain" data-realtime-test-file disabled></label>
          <nav aria-label="Exécution de la batterie" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px">
            <button type="button" data-realtime-test-run disabled>Lancer</button>
            <button type="button" data-realtime-test-stop disabled>Arrêter</button>
            <button type="button" data-realtime-test-report disabled>Rapport TXT</button>
          </nav>
          <nav aria-label="Commandes de combat de test" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px">
            <button type="button" data-realtime-debug-command="godmode" aria-pressed="false" disabled>Godmode</button>
            <button type="button" data-realtime-debug-command="instant-kill" disabled>Instant kill</button>
            <button type="button" data-realtime-debug-command="suicide" disabled>Suicide</button>
          </nav>
          <progress data-realtime-test-progress value="0" max="1" aria-label="Progression du scénario" style="width:100%"></progress>
          <output data-realtime-test-status aria-live="polite" style="max-height:5.4em;overflow:auto;font-size:12px;line-height:1.35">Chargez une ROM avant de lancer la batterie.</output>
        </section>
      </section>`
        : ''}
      <nav class="game-menu" id="game-menu" hidden aria-label="Menu de jeu"></nav>
      <div class="rom-details dev-only" id="rom-details" aria-live="polite">
        <span class="detail-label">Aucune ROM selectionnee</span>
        <span class="detail-value">Le lecteur verifiera l'en-tete NDS localement.</span>
      </div>
    </section>
    <section class="dev-panel" hidden>
      <section class="graphic-preview" id="graphic-preview" hidden aria-labelledby="graphic-title">
        <div><p class="eyebrow">Ressource decodee / Nitro 2D</p><h2 id="graphic-title">Apercu graphique local</h2><p id="graphic-caption"></p></div>
        <canvas id="graphic-canvas" aria-label="Ressource graphique decodee depuis la ROM locale"></canvas>
      </section>
      <section class="resource-catalog" id="resource-catalog" hidden aria-labelledby="resource-catalog-title">
        <div><p class="eyebrow">Catalogue local</p><h2 id="resource-catalog-title">Ressources de reconstruction</h2></div>
        <div class="catalog-grid" id="catalog-grid"></div>
      </section>
      <section class="inventory" id="inventory" hidden aria-labelledby="inventory-title">
        <div class="inventory-heading"><div><p class="eyebrow">NitroFS / Inventaire local</p><h2 id="inventory-title">Archives detectees</h2></div><p id="inventory-summary"></p></div>
        <label class="filter-label" for="file-filter">Filtrer les chemins</label>
        <input id="file-filter" class="file-filter" type="search" placeholder="Exemple : /a/0/ ou .narc" autocomplete="off">
        <div class="file-list-wrap"><table class="file-list"><thead><tr><th>Chemin</th><th>Taille</th><th>Signature</th></tr></thead><tbody id="file-list-body"></tbody></table></div>
        <p class="inventory-note" id="inventory-note"></p>
      </section>
      <section class="archive-inspector" id="archive-inspector" hidden aria-labelledby="archive-title">
        <div class="inventory-heading"><div><p class="eyebrow">NARC / Contenu local</p><h2 id="archive-title">Archive</h2></div><button id="close-archive" class="close-archive" type="button">Fermer</button></div>
        <p class="archive-summary" id="archive-summary"></p>
        <div class="file-list-wrap"><table class="file-list"><thead><tr><th>Index</th><th>Taille</th><th>Signature</th></tr></thead><tbody id="archive-list-body"></tbody></table></div>
        <p class="inventory-note" id="archive-note"></p>
      </section>
    </section>
  </main>
`

function getRequiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Element introuvable: ${selector}`)
  }
  return element
}

export function renderAppShell(app: HTMLDivElement): AppShell {
  app.innerHTML = shellMarkup

  return {
    picker: getRequiredElement(app, '#rom-picker'),
    chooseRom: getRequiredElement(app, '#choose-rom'),
    runtimePanel: getRequiredElement(app, '.runtime-panel'),
    status: getRequiredElement(app, '#runtime-status'),
    saveStatus: getRequiredElement(app, '#save-status'),
    details: getRequiredElement(app, '#rom-details'),
    inventorySection: getRequiredElement(app, '#inventory'),
    inventorySummary: getRequiredElement(app, '#inventory-summary'),
    inventoryNote: getRequiredElement(app, '#inventory-note'),
    filter: getRequiredElement(app, '#file-filter'),
    fileListBody: getRequiredElement(app, '#file-list-body'),
    archiveInspector: getRequiredElement(app, '#archive-inspector'),
    archiveTitle: getRequiredElement(app, '#archive-title'),
    archiveSummary: getRequiredElement(app, '#archive-summary'),
    archiveListBody: getRequiredElement(app, '#archive-list-body'),
    archiveNote: getRequiredElement(app, '#archive-note'),
    closeArchive: getRequiredElement(app, '#close-archive'),
    graphicPreview: getRequiredElement(app, '#graphic-preview'),
    graphicCanvas: getRequiredElement(app, '#graphic-canvas'),
    graphicCaption: getRequiredElement(app, '#graphic-caption'),
    resourceCatalog: getRequiredElement(app, '#resource-catalog'),
    catalogGrid: getRequiredElement(app, '#catalog-grid'),
    gameMenu: getRequiredElement(app, '#game-menu'),
    pcBox: getRequiredElement(app, '#pc-box'),
    safariCustomizer: getRequiredElement(app, '#safari-customizer'),
    safariDecorator: getRequiredElement(app, '#safari-decorator'),
    photoAlbum: getRequiredElement(app, '#field-photo-album'),
    inGameHud: {
      root: getRequiredElement(app, '#in-game-hud'),
      location: getRequiredElement(app, '#in-game-hud-location'),
      region: getRequiredElement(app, '#in-game-hud-region'),
      clock: getRequiredElement(app, '#in-game-hud-clock'),
      phase: getRequiredElement(app, '#in-game-hud-phase'),
      money: getRequiredElement(app, '#in-game-hud-money'),
    },
    runtimePosition: getRequiredElement(app, '#runtime-position'),
    ...(import.meta.env.DEV ? {
      botToggle: getRequiredElement<HTMLButtonElement>(app, '#toggle-bot'),
      botStatus: getRequiredElement<HTMLSpanElement>(app, '#bot-status'),
      realtimeTestPanel: getRequiredElement<HTMLElement>(app, '#realtime-test-panel'),
    } : {}),
    screenCanvas: getRequiredElement(app, '#screen-canvas'),
    runtimeCanvas: getRequiredElement(app, '#runtime-canvas'),
    gameMenuButton: getRequiredElement(app, '#game-menu-button'),
    gameMenuButtonKey: getRequiredElement(app, '#game-menu-button-key'),
    fullscreenButton: getRequiredElement(app, '#fullscreen-button'),
    bugReportModal: getRequiredElement(app, '#bug-report-modal'),
    bugReportDescription: getRequiredElement(app, '#bug-report-description'),
    bugReportPreview: getRequiredElement(app, '#bug-report-preview'),
    bugReportStatus: getRequiredElement(app, '#bug-report-status'),
    bugReportCancel: getRequiredElement(app, '#bug-report-cancel'),
    bugReportEdit: getRequiredElement(app, '#bug-report-edit'),
    bugReportDownload: getRequiredElement(app, '#bug-report-download'),
    fieldFade: getRequiredElement(app, '#field-fade'),
    pokegearFlyTransition: {
      root: getRequiredElement(app, '#pokegear-fly-transition'),
      scene: getRequiredElement(app, '#pokegear-fly-scene'),
      carrier: getRequiredElement(app, '#pokegear-fly-carrier'),
      carrierAsset: getRequiredElement(app, '#pokegear-fly-carrier-asset'),
      veil: getRequiredElement(app, '#pokegear-fly-veil'),
    },
    fieldDialogue: getRequiredElement(app, '#field-dialogue'),
    fieldDialogueSpeaker: getRequiredElement(app, '#field-dialogue-speaker'),
    fieldDialogueText: getRequiredElement(app, '#field-dialogue-text'),
    fieldChoice: getRequiredElement(app, '#field-choice'),
    fieldNumber: getRequiredElement(app, '#field-number'),
    fieldNumberInput: getRequiredElement(app, '#field-number-input'),
    fieldNickname: getRequiredElement(app, '#field-nickname'),
    fieldNicknameInput: getRequiredElement(app, '#field-nickname-input'),
    fieldEasyChat: getRequiredElement(app, '#field-easy-chat'),
    fieldEasyChatCategories: getRequiredElement(app, '#field-easy-chat-categories'),
    fieldEasyChatWords: getRequiredElement(app, '#field-easy-chat-words'),
    fieldPokeathlon: getRequiredElement(app, '#field-pokeathlon'),
    fieldPokeathlonTitle: getRequiredElement(app, '#field-pokeathlon-title'),
    fieldPokeathlonContent: getRequiredElement(app, '#field-pokeathlon-content'),
    fieldFrontierRecords: getRequiredElement(app, '#field-frontier-records'),
    fieldFrontierRecordsTitle: getRequiredElement(app, '#field-frontier-records-title'),
    fieldFrontierRecordsView: getRequiredElement(app, '#field-frontier-records-view'),
    fieldFrontierRecordsContent: getRequiredElement(app, '#field-frontier-records-content'),
    fieldAlphPuzzle: getRequiredElement(app, '#field-alph-puzzle'),
    fieldAlphPuzzleBoard: getRequiredElement(app, '#field-alph-puzzle-board'),
    fieldAlphPuzzleHint: getRequiredElement(app, '#field-alph-puzzle-hint'),
    fieldAlphInscription: getRequiredElement(app, '#field-alph-inscription'),
    fieldAlphInscriptionVisual: getRequiredElement(app, '#field-alph-inscription-visual'),
    fieldAlphInscriptionWord: getRequiredElement(app, '#field-alph-inscription-word'),
    modalConfirm: getRequiredElement(app, '#modal-confirm'),
    modalConfirmText: getRequiredElement(app, '#modal-confirm-text'),
    battleScreen: getRequiredElement(app, '#battle-screen'),
    battleBackground: getRequiredElement(app, '#battle-background'),
    battleEffects: getRequiredElement(app, '#battle-effects'),
    battleOpponentTrainer: getRequiredElement(app, '#battle-opponent-trainer'),
    battleOpponentSprite: getRequiredElement(app, '#battle-opponent-sprite'),
    battlePlayerSprite: getRequiredElement(app, '#battle-player-sprite'),
    battleOpponentParty: getRequiredElement(app, '#battle-opponent-party'),
    battlePlayerParty: getRequiredElement(app, '#battle-player-party'),
    battleOpponentName: getRequiredElement(app, '#battle-opponent-name'),
    battlePlayerName: getRequiredElement(app, '#battle-player-name'),
    battleOpponentLevel: getRequiredElement(app, '#battle-opponent-level'),
    battlePlayerLevel: getRequiredElement(app, '#battle-player-level'),
    battleOpponentHp: getRequiredElement(app, '#battle-opponent-hp'),
    battlePlayerHp: getRequiredElement(app, '#battle-player-hp'),
    battlePlayerHpText: getRequiredElement(app, '#battle-player-hp-text'),
    battlePlayerExp: getRequiredElement(app, '#battle-player-exp'),
    battleMessage: getRequiredElement(app, '#battle-message'),
    battleCommands: getRequiredElement(app, '#battle-commands'),
    battleMoves: getRequiredElement(app, '#battle-moves'),
    battleEvolution: getRequiredElement(app, '#battle-evolution'),
    battleEvolutionKicker: getRequiredElement(app, '#battle-evolution-kicker'),
    battleEvolutionFrom: getRequiredElement(app, '#battle-evolution-from'),
    battleEvolutionTo: getRequiredElement(app, '#battle-evolution-to'),
    battleEvolutionTitle: getRequiredElement(app, '#battle-evolution-title'),
    battleEvolutionText: getRequiredElement(app, '#battle-evolution-text'),
  }
}
