import { usesWorldMatrixCoordinates } from './game/world/mapCoordinates'
import type { RomFile, RomInventory } from './ndsTypes'

export type InventoryView = {
  details: HTMLDivElement
  inventorySection: HTMLElement
  inventorySummary: HTMLParagraphElement
  inventoryNote: HTMLParagraphElement
  fileListBody: HTMLTableSectionElement
  archiveInspector: HTMLElement
  archiveTitle: HTMLHeadingElement
  archiveSummary: HTMLParagraphElement
  archiveListBody: HTMLTableSectionElement
  archiveNote: HTMLParagraphElement
  graphicPreview: HTMLElement
  graphicCanvas: HTMLCanvasElement
  graphicCaption: HTMLParagraphElement
  resourceCatalog: HTMLElement
  catalogGrid: HTMLElement
}

type ArchiveView = Pick<InventoryView, 'archiveInspector' | 'archiveTitle' | 'archiveSummary' | 'archiveListBody' | 'archiveNote'>
type GraphicView = Pick<InventoryView, 'graphicPreview' | 'graphicCanvas' | 'graphicCaption'>
type FileListView = Pick<InventoryView, 'fileListBody' | 'inventoryNote'>
type ResourceCatalogView = Pick<InventoryView, 'resourceCatalog' | 'catalogGrid'>
type InventorySummaryView = Pick<InventoryView, 'inventorySection' | 'inventorySummary' | 'inventoryNote' | 'archiveInspector'>

function formatDataArchives(archives: RomInventory['resourceCatalog']['gameData']): string {
  return archives
    .map((data) => data.file ? `${data.label} : ${data.file.path} (${data.file.archiveEntries} entrées)` : `${data.label} : absente`)
    .join(' · ')
}

export function formatSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} o`
  if (bytes < 1_000_000) {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(bytes / 1_000) + ' Ko'
  }
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(bytes / 1_000_000) + ' Mo'
}

export function renderRomDetails(view: Pick<InventoryView, 'details'>, inventory: RomInventory): void {
  const { metadata: rom } = inventory
  const label = document.createElement('span')
  label.className = 'detail-label'
  label.textContent = rom.title || rom.fileName
  const value = document.createElement('span')
  value.className = 'detail-value'
  value.textContent = `Code ${rom.gameCode} · Editeur ${rom.makerCode || 'inconnu'} · ${formatSize(rom.fileSize)}`
  view.details.replaceChildren(label, value)
}

export function renderInventorySummary(view: InventorySummaryView, inventory: RomInventory): void {
  view.inventorySummary.textContent = `${inventory.files.length.toLocaleString('fr-FR')} fichiers · ${inventory.archiveEntryCount.toLocaleString('fr-FR')} ressources dans les conteneurs`
  view.inventoryNote.textContent = 'Les ressources restent dans la memoire de cet onglet. Aucun fichier extrait n’est ecrit ni envoye.'
  view.inventorySection.hidden = false
  view.archiveInspector.hidden = true
}

export function renderGraphicPreview(view: GraphicView, inventory: RomInventory): void {
  const graphic = inventory.introGraphicPreview ?? inventory.graphicPreview
  if (!graphic) {
    view.graphicPreview.hidden = true
    return
  }

  view.graphicCanvas.width = graphic.width
  view.graphicCanvas.height = graphic.height
  const context = view.graphicCanvas.getContext('2d')
  if (!context) return

  context.putImageData(new ImageData(new Uint8ClampedArray(graphic.pixels), graphic.width, graphic.height), 0, 0)
  const source = inventory.introGraphicPreview ? 'Introduction /a/1/2/0' : 'Ressource Nitro détectée'
  view.graphicCaption.textContent = `${source} · ${graphic.width} x ${graphic.height} px · ${graphic.colorDepth} bpp · RGCN 0x${graphic.graphicsOffset.toString(16)} · RLCN 0x${graphic.paletteOffset.toString(16)}`
  view.graphicPreview.hidden = false
}

export function renderResourceCatalog(view: ResourceCatalogView, inventory: RomInventory): void {
  const { archives, fontFiles, messageArchives, gameData } = inventory.resourceCatalog
  const openingData = gameData.filter((data) => ['opening', 'intro', 'nameInput'].includes(data.id))
  const worldData = gameData.filter((data) => ['mapMatrices', 'zoneEvents', 'fieldScripts', 'landData'].includes(data.id))
  const gameplayData = gameData.filter((data) => ['messages', 'species', 'moves'].includes(data.id))
  const resolvedMaps = inventory.resolvedMapCatalog.maps
  const startMap = resolvedMaps.find((map) => map.id === inventory.resolvedMapCatalog.startMapId)
  const firstFieldMap = resolvedMaps.find((map) => usesWorldMatrixCoordinates(map))
  const firstFieldEvents = firstFieldMap?.events
  const firstFieldModel = firstFieldMap?.model
  const startMapModel = startMap?.model
  const totalWarpCount = resolvedMaps.reduce((count, map) => count + (map.events?.warps.length ?? 0), 0)
  const totalCoordinateEventCount = resolvedMaps.reduce((count, map) => count + (map.events?.coordinateEvents.length ?? 0), 0)
  const totalConnectedMapRefs = resolvedMaps.reduce((count, map) => count + (map.connectedMapIds?.length ?? 0), 0)
  const firstFieldTextures = firstFieldModel?.textures?.length ?? 0
  const startMapTextures = startMapModel?.textures?.length ?? 0
  const startMapSurfaces = startMapModel?.surfaces?.length ?? 0
  const cards = [
    ['Archives', `${archives.toLocaleString('fr-FR')} conteneurs NARC indexés`, 'Sprites, cartes, sons et données groupées restent disponibles dans l’onglet.'],
    ['Ouverture', formatDataArchives(openingData), 'Ressources source de l’écran titre, de l’introduction, du tutoriel et de la saisie du nom.'],
    ['Cartes résolues', formatDataArchives(worldData), resolvedMaps.length > 0 ? `${resolvedMaps.length} cartes reliées résolues depuis la ROM. Départ courant : ${startMap?.label ?? `Carte ${inventory.resolvedMapCatalog.startMapId}`}. Connexions relevées : ${totalConnectedMapRefs}. Total : ${totalWarpCount} warps et ${totalCoordinateEventCount} déclencheurs. ${firstFieldMap && firstFieldEvents ? `${firstFieldMap.label} : ${firstFieldEvents.objects.length} PNJ, ${firstFieldEvents.warps.length} warps, ${firstFieldEvents.coordinateEvents} déclencheurs et ${firstFieldEvents.backgroundEvents} interactions de décor. Sol : ${firstFieldMap.terrain ? `modèle ${firstFieldMap.terrain.modelId}, ${firstFieldMap.terrain.width * firstFieldMap.terrain.height} attributs` : 'non validé'}. BMD0 : ${firstFieldModel ? `${firstFieldModel.vertexCount} sommets, ${firstFieldModel.triangleCount} triangles, ${firstFieldModel.quadCount} quads${firstFieldTextures ? `, ${firstFieldTextures} textures` : ''}` : 'non validé'}.` : 'Aucune carte extérieure résolue pour le moment.'} ${startMapModel ? `${startMap?.label ?? 'Carte de départ'} BMD0 : ${startMapModel.vertexCount} sommets, ${startMapModel.triangleCount} triangles, ${startMapModel.quadCount} quads, ${startMapModel.materialCount} matériaux${startMapTextures ? `, ${startMapTextures} textures et ${startMapSurfaces} surfaces` : ''}.` : 'Le modèle de la carte de départ n’est pas encore validé.'}` : 'Les cartes résolues doivent encore être extraites depuis la ROM.'],
    ['Données de jeu', formatDataArchives(gameplayData), `Police : ${fontFiles.length ? fontFiles.map((file) => file.path).join(' · ') : 'non trouvée'}. Messages dédiés : ${messageArchives.length ? messageArchives.map((file) => file.path).join(' · ') : 'non trouvés'}.`],
  ]

  view.catalogGrid.replaceChildren(...cards.map(([title, value, description]) => {
    const article = document.createElement('article')
    const heading = document.createElement('h3')
    heading.textContent = title
    const content = document.createElement('strong')
    content.textContent = value
    const details = document.createElement('p')
    details.textContent = description
    article.replaceChildren(heading, content, details)
    return article
  }))
  view.resourceCatalog.hidden = false
}

export function renderFileList(view: FileListView, files: RomFile[], query: string): void {
  const normalizedQuery = query.trim().toLowerCase()
  const matches = files.filter((file) => file.path.toLowerCase().includes(normalizedQuery))
  const preview = matches.slice(0, 250)

  view.fileListBody.replaceChildren(...preview.map((file) => {
    const row = document.createElement('tr')
    const archiveLabel = file.archiveEntries > 0 ? ` · NARC: ${file.archiveEntries}` : ''
    const path = document.createElement('td')
    path.append(file.path)
    if (file.archiveEntries > 0) {
      const action = document.createElement('button')
      action.className = 'inspect-archive'
      action.type = 'button'
      action.dataset.fileId = String(file.id)
      action.textContent = 'Explorer'
      path.append(action)
    }
    const size = document.createElement('td')
    size.textContent = `${formatSize(file.size)}${archiveLabel}`
    const signature = document.createElement('td')
    signature.textContent = file.signature || 'vide'
    row.replaceChildren(path, size, signature)
    return row
  }))

  view.inventoryNote.textContent = matches.length > preview.length
    ? `${matches.length.toLocaleString('fr-FR')} fichiers correspondent. Les 250 premiers sont affiches ; affinez le filtre pour explorer le reste.`
    : `${matches.length.toLocaleString('fr-FR')} fichier(s) affiche(s). Les ressources restent dans la memoire de cet onglet.`
}

export function hideArchiveInspector(view: Pick<InventoryView, 'archiveInspector'>): void {
  view.archiveInspector.hidden = true
}

export function showArchiveMembers(view: ArchiveView, file: RomFile): void {
  view.archiveTitle.textContent = file.path
  view.archiveSummary.textContent = `${file.archiveEntries.toLocaleString('fr-FR')} membres NARC detectes dans ${formatSize(file.size)}.`
  const preview = file.archiveMembers.slice(0, 1_000)

  view.archiveListBody.replaceChildren(...preview.map((member) => {
    const row = document.createElement('tr')
    const index = document.createElement('td')
    index.textContent = String(member.index)
    const size = document.createElement('td')
    size.textContent = formatSize(member.size)
    const signature = document.createElement('td')
    signature.textContent = member.signature || 'vide'
    row.replaceChildren(index, size, signature)
    return row
  }))

  view.archiveNote.textContent = file.archiveEntries > preview.length
    ? `${file.archiveEntries.toLocaleString('fr-FR')} membres valides. Les 1 000 premiers sont affiches.`
    : `${file.archiveEntries.toLocaleString('fr-FR')} membres valides. Les octets restent en memoire locale.`
  view.archiveInspector.hidden = false
  view.archiveInspector.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
