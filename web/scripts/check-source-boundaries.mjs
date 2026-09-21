import { readFile, readdir } from 'node:fs/promises'
import console from 'node:console'
import { Buffer } from 'node:buffer'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

// Ces fichiers sont des points de composition historiques. Leur budget est un
// plafond de dette : ils peuvent maigrir, mais tout nouveau système doit vivre
// dans un module de domaine plutôt que les faire grossir de nouveau.
const legacyLineBudgets = new Map([
  ['src/main.ts', 4849],
  ['src/game/scripts/fieldScriptRunner.ts', 6419],
  ['src/mapRuntime.ts', 1646],
  ['src/nds.ts', 2005],
  ['src/game/battle/doubleBattleSession.ts', 1500],
])

// Le plafond physique seul peut être contourné en tassant plusieurs opérations
// sur une ligne. Le poids UTF-8 de la racine de composition ne peut donc pas
// augmenter non plus ; chaque extraction abaisse les deux valeurs ensemble.
const legacyByteBudgets = new Map([
  ['src/main.ts', 274637],
])

const cssModuleLineBudget = 2200
// Ce plafond compte aussi les exceptions d'accessibilité (reduced-motion) et
// les décalages d'animation historiques. Elles restent donc valides, mais ne
// peuvent plus servir de prétexte à faire croître la spécificité globale.
const globalImportantBudget = 8
// Les sept propriétaires croisés restants sont des primitives réellement
// transversales. Le combat n'en ajoute plus aucun.
const crossFileSelectorBudget = 7
const expectedStyleImports = [
  './foundation.css',
  './application.css',
  './battle.css',
  './menus.css',
  './ui-system.css',
  './in-game.css',
  './ui-harmony.css',
  './menu-shell.css',
  './hud.css',
  './title.css',
  './summary.css',
  './pokedex.css',
  './team.css',
  './bag.css',
  './pc-box.css',
  './hud-dialog.css',
  './choice.css',
  './progression.css',
  './field-input.css',
  './game-text-entry.css',
  './shop.css',
  './field-apps.css',
  './alph-puzzle.css',
  './modal.css',
  './pokegear.css',
  './safari.css',
  './multiplayer.css',
]

function classFamilyPattern(...roots) {
  const alternatives = roots
    .map((root) => root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  return new RegExp(`[.#](?:${alternatives})(?:-[\\w-]+)?(?=[^\\w-]|$)`)
}

// Un domaine visuel a un propriétaire unique. Les motifs portent uniquement
// sur les classes/IDs racines : une valeur de données comme
// [data-screen='pokegear'] peut ainsi piloter la composition sans devenir un
// second propriétaire graphique.
const cssDomainOwners = [
  {
    name: 'chrome du menu principal',
    owner: 'menu-shell.css',
    selectorPattern: /(?:[.#](?:ui-menu-(?:root|detail|navigation-root|header|back|button)(?:-[\w-]+)?|game-menu-(?:header|layout|list|content|button|rom-asset)(?:-[\w-]+)?|ui-theme-particle(?:-[\w-]+)?)(?=[^\w-]|$)|\[data-menu-state-value\])/,
    exceptions: [
      {
        fileName: 'title.css',
        reason: 'adaptateur du menu de sauvegarde du titre',
        selectorPattern: /\.game-menu-title/,
      },
      {
        fileName: 'summary.css',
        reason: 'adaptateur de grille du résumé Pokémon',
        selectorPattern: /\.pokemon-summary/,
      },
      {
        fileName: 'pokedex.css',
        reason: 'adaptateur de coque du Pokédex',
        selectorPattern: /(?:data-screen\s*=\s*["']pokedex["']|[.#]pokedex)/,
      },
      {
        fileName: 'team.css',
        reason: 'contrôles propres à la grille Équipe',
        selectorPattern: /(?:data-screen\s*=\s*["']team["']|[.#]team-menu)/,
      },
      {
        fileName: 'bag.css',
        reason: 'contrôles propres aux poches du Sac',
        selectorPattern: /(?:data-screen\s*=\s*["']bag["']|[.#]bag-menu)/,
      },
      {
        fileName: 'pokegear.css',
        reason: 'contrôles propres aux applications Pokématos',
        selectorPattern: /[.#]pokegear/,
      },
    ],
  },
  {
    name: 'sauvegarde/titre',
    owner: 'title.css',
    selectorPattern: classFamilyPattern('title-save', 'game-menu-title'),
  },
  {
    name: 'HUD en jeu',
    owner: 'hud.css',
    selectorPattern: classFamilyPattern('in-game-hud', 'game-menu-trigger', 'fullscreen-button'),
  },
  {
    name: 'résumé Pokémon',
    owner: 'summary.css',
    selectorPattern: classFamilyPattern('pokemon-summary'),
  },
  {
    name: 'Pokédex',
    owner: 'pokedex.css',
    selectorPattern: classFamilyPattern('pokedex'),
  },
  {
    name: 'équipe',
    owner: 'team.css',
    selectorPattern: classFamilyPattern('team-menu', 'team-roster'),
  },
  {
    name: 'sac',
    owner: 'bag.css',
    selectorPattern: classFamilyPattern('bag-menu'),
  },
  {
    name: 'PC',
    owner: 'pc-box.css',
    selectorPattern: /[.#](?:pc-box(?:-[\w-]+)?|pc-[\w-]+)(?=[^\w-]|$)/,
  },
  {
    name: 'dialogue en jeu',
    owner: 'hud-dialog.css',
    selectorPattern: classFamilyPattern('field-dialogue'),
  },
  {
    name: 'progression Pokémon',
    owner: 'progression.css',
    selectorPattern: classFamilyPattern('battle-evolution', 'battle-learn-move', 'egg-hatch', 'is-evolution-only', 'is-egg-hatch'),
  },
  {
    name: 'combat',
    owner: 'battle.css',
    selectorPattern: /[.#]battle(?:-[\w-]+)?(?=[^\w-]|$)/,
    exceptions: [
      {
        fileName: 'progression.css',
        reason: 'apprentissage, évolution et éclosion restent un domaine modal autonome',
        selectorPattern: /[.#]battle(?:-[\w-]+)?(?=[^\w-]|$)/,
      },
    ],
  },
  {
    name: 'choix starter et équipe',
    owner: 'choice.css',
    selectorPattern: classFamilyPattern('field-choice-starter', 'field-choice-party', 'field-party-choice', 'starter'),
  },
  {
    name: 'boutique terrain',
    owner: 'shop.css',
    selectorPattern: /(?:(?<!:not\()[.#]field-choice-shop(?=[^\w-]|$)|[.#](?:field-shop|field-number-shop)(?:-[\w-]+)?(?=[^\w-]|$))/,
  },
  {
    name: 'saisies de terrain',
    owner: 'field-input.css',
    selectorPattern: /^(?!.*[.#]field-number-shop(?=[^\w-]|$)).*[.#](?:field-nickname|field-number)(?:-[\w-]+)?(?=[^\w-]|$)/,
  },
  {
    name: 'saisie globale',
    owner: 'game-text-entry.css',
    selectorPattern: classFamilyPattern('game-text-entry'),
  },
  {
    name: 'mini-applications de terrain',
    owner: 'field-apps.css',
    selectorPattern: classFamilyPattern('field-easy-chat', 'field-pokeathlon', 'field-frontier-records'),
  },
  {
    name: 'puzzle Alpha',
    owner: 'alph-puzzle.css',
    selectorPattern: classFamilyPattern('field-alph'),
  },
  {
    name: 'fenetres modales',
    owner: 'modal.css',
    selectorPattern: classFamilyPattern('modal-confirm', 'bug-report'),
  },
  {
    name: 'Pokématos',
    owner: 'pokegear.css',
    selectorPattern: classFamilyPattern('pokegear'),
    exceptions: [
      {
        fileName: 'ui-harmony.css',
        reason: 'cible tactile minimale du socle transversal',
        selectorPattern: /^html\[data-input-profile=(["'])touch\1\] #app \.runtime-panel :where\(/,
      },
    ],
  },
  {
    name: 'Safari',
    owner: 'safari.css',
    selectorPattern: classFamilyPattern('safari-ui', 'safari-customizer', 'safari-decorator'),
  },
]

function countLines(source) {
  if (source.length === 0) return 0
  return source.split('\n').length - (source.endsWith('\n') ? 1 : 0)
}

async function listFilesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? listFilesRecursively(path) : [path]
  }))
  return nested.flat()
}

function isInside(directory, candidate) {
  const pathFromDirectory = relative(directory, candidate)
  return pathFromDirectory !== '..' && !pathFromDirectory.startsWith(`..${sep}`)
}

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
}

function isKeyframeStepHeader(header) {
  return header.split(',').every((segment) => (
    /^(?:from|to|[+-]?(?:\d+(?:\.\d*)?|\.\d+)%)$/.test(segment.trim())
  ))
}

function splitSelectorList(selectorList) {
  const selectors = []
  let segmentStart = 0
  let quote
  let escaped = false
  let parenthesesDepth = 0
  let bracketsDepth = 0
  for (let index = 0; index < selectorList.length; index += 1) {
    const character = selectorList[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '(') parenthesesDepth += 1
    else if (character === ')') parenthesesDepth -= 1
    else if (character === '[') bracketsDepth += 1
    else if (character === ']') bracketsDepth -= 1
    else if (character === ',' && parenthesesDepth === 0 && bracketsDepth === 0) {
      selectors.push(selectorList.slice(segmentStart, index).trim())
      segmentStart = index + 1
    }
  }
  selectors.push(selectorList.slice(segmentStart).trim())
  return selectors.filter(Boolean)
}

function extractRuleSelectors(source) {
  const withoutComments = stripCssComments(source)
  const selectors = []
  let segmentStart = 0
  let quote
  let escaped = false
  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === ';' || character === '}') {
      segmentStart = index + 1
      continue
    }
    if (character !== '{') continue
    const header = withoutComments.slice(segmentStart, index).trim().replace(/\s+/g, ' ')
    if (header && !header.startsWith('@') && !isKeyframeStepHeader(header)) selectors.push(header)
    segmentStart = index + 1
  }
  return selectors
}

function findDomainOwnershipException(domain, fileName, selector) {
  return (domain.exceptions ?? []).find((exception) => (
    exception.fileName === fileName && exception.selectorPattern.test(selector)
  ))
}

const violations = []
const usedDomainOwnershipExceptions = new Set()

const sourceDirectory = resolve(webRoot, 'src')
const onlineDirectory = resolve(sourceDirectory, 'online')
const forbiddenOnlineDependencies = [resolve(sourceDirectory, 'game'), resolve(sourceDirectory, 'rom')]
const localDevelopmentReportPath = resolve(sourceDirectory, 'game/diagnostics/bugReport.ts')
const mainCompositionPath = resolve(sourceDirectory, 'main.ts')
const titleCampaignCoordinatorPath = resolve(sourceDirectory, 'game/newGamePlus/titleCampaignCoordinator.ts')
const titleSaveCatalogPath = resolve(sourceDirectory, 'game/menu/titleSaveCatalog.ts')
const hgssStoredSavePreparationPath = resolve(sourceDirectory, 'game/save/hgssStoredSavePreparation.ts')
const portableCloudFacadePath = resolve(sourceDirectory, 'game/save/portableCloudVault.ts')
const hgssFullSaveCloudFacadePath = resolve(sourceDirectory, 'game/save/hgssFullSaveCloudVault.ts')
const hgssDataOnlySaveStorageFacadePath = resolve(sourceDirectory, 'game/save/hgssDataOnlySaveStorage.ts')
const opaqueJsonVaultModule = resolve(sourceDirectory, 'online/opaqueJsonVault')
const onlineVaultKeyringPath = resolve(sourceDirectory, 'online/onlineVaultKeyring.ts')
const opaqueVaultHttpClientModule = resolve(sourceDirectory, 'online/opaqueVaultHttpClient')
const portableCloudVaultModule = resolve(sourceDirectory, 'game/save/portableCloudVault')
const portableStateRegistryModule = resolve(sourceDirectory, 'game/save/portableStateRegistry')
const hgssDataOnlySaveDocumentModule = resolve(sourceDirectory, 'game/save/hgssDataOnlySaveDocument')
const hgssDataOnlySaveStorageModule = resolve(sourceDirectory, 'game/save/hgssDataOnlySaveStorage')
const directHgssSaveWriteImportPattern = /(?:import|export)\s*\{[^}]*\b(?:createHgssBrowserSaveSlotIfEmpty|migrateHgssBrowserSaveSlotIfStorageUnchanged|writeHgssBrowserSave|writeHgssBrowserSaveSlot)\b[^}]*\}\s*from\s*(['"])[^'"]*hgssSaveStorage\1/
const broadHgssSaveStorageImportPattern = /import\s*(?:\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s*|\(\s*)(['"])[^'"]*hgssSaveStorage\1/
const allowedLowLevelVaultImporters = new Map([
  [opaqueJsonVaultModule, new Set([
    resolve(sourceDirectory, 'online/opaqueVaultHttpClient.ts'),
    onlineVaultKeyringPath,
    portableCloudFacadePath,
  ])],
  [opaqueVaultHttpClientModule, new Set([portableCloudFacadePath])],
  [portableCloudVaultModule, new Set([hgssFullSaveCloudFacadePath])],
  [portableStateRegistryModule, new Set([
    portableCloudFacadePath,
    hgssFullSaveCloudFacadePath,
  ])],
  [hgssDataOnlySaveDocumentModule, new Set([
    mainCompositionPath,
    titleCampaignCoordinatorPath,
    titleSaveCatalogPath,
    hgssFullSaveCloudFacadePath,
    hgssDataOnlySaveStorageFacadePath,
    hgssStoredSavePreparationPath,
  ])],
  [hgssDataOnlySaveStorageModule, new Set([titleCampaignCoordinatorPath, titleSaveCatalogPath])],
])
const browserNetworkApiPattern = /\b(?:fetch\s*\(|new\s+(?:WebSocket|RTCPeerConnection|EventSource|WebTransport)\b|XMLHttpRequest\b|navigator\.sendBeacon\b)/
const typeScriptFiles = (await listFilesRecursively(sourceDirectory))
  .filter((path) => /\.(?:ts|tsx)$/.test(path))
for (const path of typeScriptFiles) {
  const source = await readFile(path, 'utf8')
  if (
    !/\.test\.(?:ts|tsx)$/.test(path)
    && path !== hgssDataOnlySaveStorageFacadePath
    && (directHgssSaveWriteImportPattern.test(source) || broadHgssSaveStorageImportPattern.test(source))
  ) {
    violations.push(`${relative(webRoot, path)}: les écritures de slot HGSS doivent passer par la barrière data-only`)
  }
  for (const match of source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)) {
    const specifier = match[2]
    if (!specifier?.startsWith('.')) continue
    const importedPath = resolve(dirname(path), specifier)
    if (!isInside(webRoot, importedPath)) {
      violations.push(`${relative(webRoot, path)}: import hors du projet client (${specifier})`)
    }
    if (isInside(onlineDirectory, path) && forbiddenOnlineDependencies.some((directory) => isInside(directory, importedPath))) {
      violations.push(`${relative(webRoot, path)}: le transport en ligne générique ne doit pas importer le domaine de jeu (${specifier})`)
    }
    const importedModule = importedPath.replace(/\.(?:ts|tsx)$/, '')
    const allowedImporters = allowedLowLevelVaultImporters.get(importedModule)
    if (
      allowedImporters
      && !/\.test\.(?:ts|tsx)$/.test(path)
      && !allowedImporters.has(path)
    ) {
      violations.push(`${relative(webRoot, path)}: les primitives sensibles de sauvegarde/cloud doivent être utilisées via une façade auditée (${specifier})`)
    }
  }
  if (
    !/\.test\.(?:ts|tsx)$/.test(path)
    && !isInside(onlineDirectory, path)
    && browserNetworkApiPattern.test(source)
  ) {
    if (
      path !== localDevelopmentReportPath
      || !source.includes('if (!import.meta.env.DEV) return undefined')
      || !source.includes("fetch('/__pokemaster/report'")
    ) {
      violations.push(`${relative(webRoot, path)}: les API réseau navigateur doivent rester dans src/online`)
    }
  }
}

for (const [relativePath, maximum] of legacyLineBudgets) {
  const source = await readFile(resolve(webRoot, relativePath), 'utf8')
  const actual = countLines(source)
  if (actual > maximum) violations.push(`${relativePath}: ${actual} lignes (plafond ${maximum})`)
}

for (const [relativePath, maximum] of legacyByteBudgets) {
  const source = await readFile(resolve(webRoot, relativePath), 'utf8')
  const actual = Buffer.byteLength(source, 'utf8')
  if (actual > maximum) violations.push(`${relativePath}: ${actual} octets UTF-8 (plafond ${maximum})`)
}

const stylesDirectory = resolve(webRoot, 'src/styles')
const styleFiles = (await readdir(stylesDirectory)).filter((fileName) => fileName.endsWith('.css') && fileName !== 'index.css')
const styleFileSet = new Set(styleFiles)
for (const domain of cssDomainOwners) {
  if (!styleFileSet.has(domain.owner)) {
    violations.push(`src/styles: propriétaire absent pour le domaine « ${domain.name} » (${domain.owner})`)
  }
  for (const exception of domain.exceptions ?? []) {
    if (!exception.reason) {
      violations.push(`src/styles: exception sans justification pour le domaine « ${domain.name} » (${exception.fileName})`)
    }
    if (!styleFileSet.has(exception.fileName)) {
      violations.push(`src/styles: exception absente pour le domaine « ${domain.name} » (${exception.fileName})`)
    }
  }
}
const selectorOwners = new Map()
let globalImportantCount = 0
for (const fileName of styleFiles) {
  const source = await readFile(resolve(stylesDirectory, fileName), 'utf8')
  const actual = countLines(source)
  if (actual > cssModuleLineBudget) violations.push(`src/styles/${fileName}: ${actual} lignes (plafond ${cssModuleLineBudget})`)
  for (const selector of extractRuleSelectors(source)) {
    for (const selectorBranch of splitSelectorList(selector)) {
      if (
        selectorBranch.includes(':hover')
        && !/data-input-modality\s*=\s*(?:(["'])pointer\1|pointer)\s*\]/.test(selectorBranch)
      ) {
        violations.push(`src/styles/${fileName}: survol sans modalité pointeur (${selectorBranch})`)
      }
      for (const domain of cssDomainOwners) {
        if (fileName === domain.owner || !domain.selectorPattern.test(selectorBranch)) continue
        const exception = findDomainOwnershipException(domain, fileName, selectorBranch)
        if (exception) usedDomainOwnershipExceptions.add(exception)
        else violations.push(
          `src/styles/${fileName}: le domaine « ${domain.name} » appartient à src/styles/${domain.owner} (${selectorBranch})`,
        )
      }
    }
    const owners = selectorOwners.get(selector) ?? new Set()
    owners.add(fileName)
    selectorOwners.set(selector, owners)
  }

  const withoutComments = stripCssComments(source)
  globalImportantCount += [...withoutComments.matchAll(/!important\b/g)].length
  for (const match of withoutComments.matchAll(/\bcontent\s*:\s*(["'])((?:\\.|.)*?)\1/gs)) {
    const value = match[2]
      .replace(/\\[0-9a-fA-F]{1,6}\s?/g, '')
      .replace(/\\./gs, '')
    if (/\p{L}/u.test(value)) {
      violations.push(`src/styles/${fileName}: texte alphabétique interdit dans content (${JSON.stringify(match[2])})`)
    }
  }
}

for (const domain of cssDomainOwners) {
  for (const exception of domain.exceptions ?? []) {
    if (!usedDomainOwnershipExceptions.has(exception)) {
      violations.push(`src/styles: exception inutilisée pour le domaine « ${domain.name} » (${exception.fileName}: ${exception.reason})`)
    }
  }
}

if (globalImportantCount > globalImportantBudget) {
  violations.push(`src/styles: ${globalImportantCount} !important (plafond global ${globalImportantBudget})`)
}

const crossFileSelectors = [...selectorOwners.values()].filter((owners) => owners.size > 1).length
if (crossFileSelectors > crossFileSelectorBudget) {
  violations.push(`src/styles: ${crossFileSelectors} sélecteurs répartis entre plusieurs fichiers (plafond ${crossFileSelectorBudget})`)
}

const styleIndex = await readFile(resolve(stylesDirectory, 'index.css'), 'utf8')
const actualStyleImports = [...styleIndex.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
const importedStyleFiles = new Set(actualStyleImports.map((styleImport) => basename(styleImport)))
for (const domain of cssDomainOwners) {
  if (!importedStyleFiles.has(domain.owner)) {
    violations.push(`src/styles/index.css: propriétaire non importé pour le domaine « ${domain.name} » (${domain.owner})`)
  }
}
if (actualStyleImports.join('\n') !== expectedStyleImports.join('\n')) {
  violations.push(`src/styles/index.css: ordre attendu ${expectedStyleImports.map((styleImport) => basename(styleImport)).join(' -> ')}`)
}

if (violations.length > 0) {
  console.error('Frontières de source dépassées :')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log(`Frontières de source valides (${typeScriptFiles.length} sources client cloisonnées, ${legacyLineBudgets.size} monolithes plafonnés en lignes, ${legacyByteBudgets.size} plafond en octets, ${styleFiles.length} modules CSS, ${crossFileSelectors} sélecteurs CSS partagés, ${globalImportantCount} !important).`)
}
