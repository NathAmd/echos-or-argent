export type RomMetadata = {
  fileName: string
  fileSize: number
  title: string
  gameCode: string
  makerCode: string
  unitCode: number
}

export type RomFile = {
  id: number
  path: string
  offset: number
  size: number
  signature: string
  archiveEntries: number
  archiveMembers: NarcMember[]
}

export type NarcMember = {
  index: number
  offset: number
  size: number
  signature: string
}

export type NitroCellSpritePreview = {
  frames: NitroGraphic[]
  animation: import('./rom/graphics/nitroCellAnimations').NitroCellAnimation
  /** Bornes OAM natives, nécessaires pour conserver les déplacements encodés dans les cellules. */
  cells?: import('./rom/graphics/nitroCells').NitroCell[]
}

export type ResolvedMapCatalog = {
  startMapId: number
  maps: OpeningMapPreview[]
}

export type RomInventory = {
  metadata: RomMetadata
  files: RomFile[]
  totalDataSize: number
  archiveEntryCount: number
  filesystemOffset: number
  filesystemSize: number
  graphicPreview?: NitroGraphic
  openingGraphicPreview?: NitroGraphic
  openingMovieGraphics?: NitroGraphic[]
  openingMovieSceneGraphics?: NitroGraphic[][]
  openingMovieSprites?: NitroCellSpritePreview[]
  openingMovieModels?: NitroModelPreview[]
  openingMovieModelFrames?: Array<NitroModelPreview[] | undefined>
  openingMovieModelAnimations?: NitroAnimationPreview[]
  openingStarterParticleResource?: import('./rom/battle/splParticleResources').HgssSplParticleResource
  titleBackgroundGraphicPreview?: NitroGraphic
  titleLogoGraphicPreview?: NitroGraphic
  titleCreditGraphicPreview?: NitroGraphic
  introOakGraphicPreview?: NitroGraphic
  introGraphicPreview?: NitroGraphic
  introTopBackgroundGraphic?: NitroGraphic
  introOakSpriteGraphic?: NitroGraphic
  introMarillGraphic?: NitroGraphic
  introMarillSprite?: NitroCellSpritePreview
  introLowerBackgroundGraphic?: NitroGraphic
  introTutorialBackgroundGraphics?: NitroGraphic[]
  introGenderBackgroundGraphic?: NitroGraphic
  introBoyGraphic?: NitroGraphic
  introGirlGraphic?: NitroGraphic
  introBoyShrinkGraphics?: NitroGraphic[]
  introGirlShrinkGraphics?: NitroGraphic[]
  nameInputGraphicPreview?: NitroGraphic
  fontGraphicPreview?: NitroGraphic
  titleLegendModel?: NitroModelPreview
  titleLegendModelFrames?: NitroModelPreview[]
  titleSparklesModel?: NitroModelPreview
  starterMachineModel?: NitroModelPreview
  titleLegendAnimation?: NitroAnimationPreview
  titleMaterialAnimation?: NitroAnimationPreview
  titlePatternAnimation?: NitroAnimationPreview
  titleSparkleAnimation?: NitroAnimationPreview
  titleTouchMessage?: string
  introMessages?: Record<number, string>
  playerTexturePreview?: NitroTexturePreview
  playerTextureFrames?: PlayerTextureFrames
  playerTexturePreviewsByGender?: Partial<Record<PlayerGender, NitroTexturePreview>>
  playerTextureFramesByGender?: Partial<Record<PlayerGender, PlayerTextureFrames>>
  eventTexturePreviews?: Record<number, NitroTexturePreview>
  eventTextureFrames?: Record<number, PlayerTextureFrames>
  eventTextureResolver?: (spriteId: number) => { preview?: NitroTexturePreview, frames?: PlayerTextureFrames }
  followerTextureResolver?: (parameterIndex: number, shiny?: boolean) => PokemonFollowerTextures
  followerEmoteResolver?: (emoteId: number) => import('./rom/overworld/followerEmotes').HgssFollowerEmote
  grassEffectResolver: (kind: import('./rom/overworld/grassEffects').HgssGrassEffectKind) => import('./rom/overworld/grassEffects').HgssGrassEffect
  fishingBiteEffectResolver: () => import('./game/encounters/hgssFishingBiteEffect').HgssFishingBiteEffectAsset
  blackoutDestinationResolver: (spawnId: number) => import('./rom/overworld/blackoutSpawns').HgssBlackoutDestination
  blackoutSpawnForMapResolver: (mapId: number) => number | undefined
  flyDestinationResolver: (mapId: number) => import('./rom/overworld/blackoutSpawns').HgssFlyDestination | undefined
  mapPropModelResolver?: (modelId: number, areaDataBank: number, domain?: 'field' | 'room') => NitroModelPreview | undefined
  mapPropAnimationMetadataResolver?: (modelId: number, domain?: 'field' | 'room', areaDataBank?: number) => import('./rom/model/mapPropAnimationMetadata').MapPropAnimationMetadata | undefined
  mapPropAnimationResolver?: (modelId: number, areaDataBank: number, animationArchiveId: number, domain?: 'field' | 'room') => NitroMapPropAnimationPreview | undefined
  gymOverlayModelResolver?: (archivePath: string, modelMember: number) => NitroModelPreview | undefined
  gymOverlayAnimationResolver?: (archivePath: string, modelMember: number, animationMember: number) => NitroMapPropAnimationPreview | undefined
  /** Variantes ROM dépendantes du calendrier, de la progression et de la composition Safari. */
  mapVariantResolver?: (map: OpeningMapPreview, context: {
    weekday: number
    rocketHideoutCleared: boolean
    safariZone?: import('./game/safari/hgssSafariState').HgssSafariState
    playerGender?: PlayerGender
  }) => OpeningMapPreview
  fieldTextureAnimations?: Record<string, NitroTextureAnimationPreview>
  fieldCameraParams: FieldCameraParam[]
  pokemonCatalog: PokemonCatalog
  pokeathlonPerformanceCatalog: import('./rom/pokemon/pokeathlonPerformance').HgssPokeathlonPerformanceCatalog
  followerReactionCatalog: import('./rom/overworld/followerReactions').HgssFollowerReactionCatalog
  itemCatalog: import('./rom/items/itemData').HgssItemCatalog
  uiAssets: import('./rom/ui/hgssUiAssets').HgssUiAssets
  safariUiAssets: import('./rom/safari/safariUiAssets').HgssSafariUiAssets
  pokegearMapData: import('./rom/pokegear/mapData').HgssPokegearMapData
  mapEncounterLandmarks: import('./rom/pokegear/mapEncounterLandmarks').MapEncounterLandmarkIndex
  itemIconResolver: (itemId: number) => NitroGraphic
  pokemonIconResolver: (speciesId: number, form?: number, isEgg?: boolean) => import('./rom/pokemon/pokemonIcons').PokemonIconPreview
  battlePokemonSpriteResolver: (request: import('./rom/pokemon/battlePokemonSprites').BattlePokemonSpriteRequest) => import('./rom/pokemon/battlePokemonSprites').BattlePokemonSprite
  trainerBattleSpriteResolver: (trainerClass: number) => NitroGraphic
  battleBackgroundResolver: (request: import('./rom/battle/battleBackgrounds').HgssBattleBackgroundRequest) => NitroGraphic
  battleAnimationCatalog: import('./rom/battle/battleAnimationScripts').HgssBattleAnimationCatalog
  battlePrizeMoneyTable: import('./rom/battle/prizeMoney').HgssPrizeMoneyEntry[]
  phoneContactNames: string[]
  /** Banques de dialogues Pokématos décodées depuis la ROM, indexées par contact. */
  phoneContactMessages: Record<number, Record<number, string>>
  /** Salutations communes du téléphone (banque message 640 de la ROM). */
  phoneGreetingMessages: Record<number, string>
  /** Titres, animateurs et textes des douze émissions Radio natives. */
  radioProgramMessages: Record<number, Record<number, string>>
  phoneBookEntries: import('./rom/phone/phoneBook').HgssPhoneBookEntry[]
  /** Noms initiaux des dix-huit Boîtes PC, banque message 24 de la ROM. */
  storageBoxNames: string[]
  trainerCatalog: import('./rom/battle/trainerData').HgssTrainer[]
  trainerMessages: import('./rom/battle/trainerMessages').HgssTrainerMessageCatalog
  npcTradeCatalog: import('./rom/pokemon/npcTradeData').HgssNpcTrade[]
  wildEncounterCatalog: import('./rom/encounters/wildEncounterData').HgssWildEncounterData[]
  safariEncounterCatalog: import('./rom/safari/safariEncounterData').HgssSafariEncounterCatalog
  photoDataCatalog: import('./rom/photo/photoData').HgssPhotoDataCatalog
  pokedexCatalog: import('./rom/pokedex/pokedexData').HgssPokedexCatalog
  easyChatCatalog: import('./rom/easyChat/easyChatData').HgssEasyChatCatalog
  pokeathlonDataMessages: Record<number, string>
  alphPuzzleTiles: NitroGraphic[][]
  alphPuzzleBackground?: NitroGraphic
  alphPuzzleHints: string[]
  alphHiddenRoomBackground?: NitroGraphic
  alphHiddenRoomWords: string[]
  mailMessageBanks: Record<number, Record<number, string>>
  trainerHouseDefaultName: string
  battleMessages: Record<number, string>
  /** Libellés des écrans natifs, conservés par banque et identifiant ROM. */
  uiMessageBanks: Record<number, Record<number, string>>
  blackoutMessages: Record<number, string>
  trainerNames: string[]
  trainerClassNames: string[]
  soundArchive: RomSoundArchive
  resolvedMapCatalog: ResolvedMapCatalog
  resourceCatalog: RomResourceCatalog
}

export type PokemonFollowerTextures = {
  preview: NitroTexturePreview
  textures: NitroTexturePreview[]
  animationFrames: Record<PlayerDirection, NitroTexturePreview[]>
}

export type PokemonCatalog = {
  speciesNames: string[]
  natureNames?: string[]
  abilityNames?: string[]
  /** Table poketool/personal/pms.narc : espèce de base produite par la Pension. */
  babySpecies?: number[]
  /** Membre unique de fielddata/breeding/egg_move_list, regroupé par espèce. */
  eggMoves?: number[][]
  /** fielddata/wazaoshie/waza_oshie.bin, un bit par capacité du maître. */
  moveTutorLearnsets?: Uint8Array[]
  moveNames: string[]
  /** Table de poids du Pokédex HGSS, en dixièmes de kilogramme. */
  weightsTenthsKg?: number[]
  /** sTerrainMove de l'overlay de combat HGSS, indexé par terrain logique. */
  naturePowerMoveIds?: number[]
  /** Table terrain→type de Camouflage, lue dans l'overlay de combat HGSS. */
  camouflageTypeIds?: number[]
  /** Table terrain→effet secondaire de Force Cachée, lue dans l'overlay de combat HGSS. */
  secretPowerEffectIds?: number[]
  personalData: import('./rom/pokemon/personalData').PokemonPersonalData[]
  growthTables: import('./rom/pokemon/growthTable').PokemonGrowthTable[]
  moves: import('./rom/pokemon/moveData').PokemonMoveData[]
  levelUpLearnsets: import('./rom/pokemon/levelUpLearnset').PokemonLevelUpMove[][]
  evolutions: import('./rom/pokemon/evolutionData').PokemonEvolutionRule[][]
  followers: import('./rom/overworld/followerParameters').PokemonFollowerCatalog
}

export type FieldCameraParam = {
  type: number
  distance: number
  angleX: number
  angleY: number
  angleZ: number
  perspectiveType: number
  perspectiveAngle: number
  near: number
  far: number
  lookAtOffsetX: number
  lookAtOffsetY: number
  lookAtOffsetZ: number
}

export type RomSoundArchive = {
  path: string
  bytes: Uint8Array
}

export type MapMatrixPreview = {
  matrixIndex: number
  name: string
  width: number
  height: number
  /** Présence du tableau de headers dans la matrice NARC. Les matrices locales
   *  de donjon n'en ont pas et leurs cellules forment une seule grande carte. */
  hasHeaders?: boolean
  headers: Uint16Array
  altitudes: Uint8Array
  modelIds: Uint16Array
}

export type MapEventPreview = {
  backgroundEvents: number
  backgrounds: { scriptId: number, type: number, x: number, z: number, y: number, direction: number }[]
  objects: {
    id: number
    spriteId: number
    movement: number
    type: number
    eventFlag: number
    scriptId: number
    facingDirection: number
    /** Trois paramètres ObjectEvent natifs; param[0] porte notamment la distance de vue des Dresseurs. */
    parameters?: readonly [number, number, number]
    xRange: number
    zRange: number
    x: number
    z: number
  }[]
  warps: { x: number, z: number, header: number, anchor: number }[]
  coordinateEvents: MapCoordinateEventPreview[]
}

export type MapCoordinateEventPreview = {
  scriptId: number
  x: number
  z: number
  width: number
  height: number
  y: number
  expectedValue: number
  variableId: number
}

export type MapTerrainPreview = {
  modelId: number
  width: number
  height: number
  attributes: Uint16Array
  collisionPlates?: MapCollisionPlatePreview[]
}

export type MapCollisionPlatePreview = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  normalX: number
  normalY: number
  normalZ: number
  distance: number
}

export type MapHeaderPreview = {
  mapId: number
  wildEncounterBank: number
  areaDataBank: number
  moveModelBank: number
  worldMapX: number
  worldMapY: number
  matrixId: number
  scriptsBank: number
  scriptHeaderBank: number
  msgBank: number
  dayMusicId: number
  nightMusicId: number
  eventsBank: number
  mapSection: number
  areaIcon: number
  momCallIntroParam: number
  region: number
  weather: number
  mapType: number
  cameraType: number
  followMode: number
  battleBackground: number
  bikeAllowed: boolean
  runningAllowed: boolean
  escapeRopeAllowed: boolean
  flyAllowed: boolean
  outgoingCalls: boolean
  incomingCalls: boolean
  radioSignal: boolean
}

export type FieldScriptBankPreview = {
  bank: number
  baseScriptId: number
  bytes: Uint8Array
  headerSize: number
  entryOffsets: number[]
  messages: Record<number, string>
}

export type OpeningMapPreview = {
  id: number
  label: string
  connectedMapIds?: number[]
  header: MapHeaderPreview
  fieldScripts: {
    bank: number
    bytes: Uint8Array
    headerSize: number
    entryOffsets: number[]
  }
  standardScripts?: FieldScriptBankPreview
  standardScriptBanks?: FieldScriptBankPreview[]
  initScripts: import('./rom/scripts/fieldScripts').MapInitScriptEntry[]
  messages: Record<number, string>
  externalMessages?: Record<number, Record<number, string>>
  matrix: MapMatrixPreview
  events?: MapEventPreview
  terrain?: MapTerrainPreview
  model?: NitroModelPreview
}

export type NitroTexturePreview = {
  id: string
  name: string
  paletteName?: string
  sourcePath?: string
  sourceMemberIndex?: number
  width: number
  height: number
  pixels: Uint8ClampedArray
}

export type NitroTextureAnimationFramePreview = {
  texture: NitroTexturePreview
  durationFrames: number
}

export type NitroTextureAnimationPreview = {
  name: string
  /** Membre n+1 de fldtanime.narc associé à l'entrée n par le moteur HGSS. */
  sourceMemberIndex: number
  frames: NitroTextureAnimationFramePreview[]
}

export type PlayerDirection = 'north' | 'south' | 'west' | 'east'
export type PlayerGender = 'male' | 'female'

export type PlayerTextureFrames = {
  standing: Record<PlayerDirection, NitroTexturePreview>
  walking: Record<PlayerDirection, NitroTexturePreview[]>
  /** Deuxième bloc cardinal du héros HGSS, utilisé par MOVEMENT_RUN_* (16–19). */
  running?: Record<PlayerDirection, NitroTexturePreview[]>
}

export type NitroSurfacePreview = {
  materialIndex: number
  materialName?: string
  materialColor?: readonly [number, number, number]
  materialDiffuseColor?: readonly [number, number, number]
  materialAmbientColor?: readonly [number, number, number]
  materialSpecularColor?: readonly [number, number, number]
  materialEmissionColor?: readonly [number, number, number]
  materialAlpha?: number
  /** Bit 15 de PolygonAttr Nitro : le matériau reçoit la table de brouillard DS. */
  fogEnabled?: boolean
  textureId?: string
  textureName?: string
  paletteName?: string
  positions: Float32Array
  colors?: Float32Array
  uvs?: Float32Array
  /** Field props are visible scenery, not walkable ground. */
  supportsMovement?: boolean
  /** Cellule source de la matrice HGSS, utilisée par la fenêtre native 2x2. */
  mapMatrixCellIndex?: number
}

export type NitroMapPropPreview = {
  modelId: number
  position: readonly [number, number, number]
  rotation: readonly [number, number, number]
  scale: readonly [number, number, number]
  /** Cellule source de la matrice HGSS, utilisée par la fenêtre native 2x2. */
  mapMatrixCellIndex?: number
}

export type NitroMapPropAnimationPreview = {
  frameCount: number
  frames: NitroModelPreview[]
}

export type NitroModelPreview = {
  modelId: number
  vertexCount: number
  triangleCount: number
  quadCount: number
  materialCount: number
  pieceCount: number
  positions?: Float32Array
  colors?: Float32Array
  surfaces?: NitroSurfacePreview[]
  textures?: NitroTexturePreview[]
  mapProps?: NitroMapPropPreview[]
  tileBounds?: { minX: number, maxX: number, minZ: number, maxZ: number }
}

export type NitroAnimationPreview = {
  kind: 'BCA' | 'BTA' | 'BMA' | 'BTP'
  sourcePath?: string
  sourceMemberIndex?: number
  name?: string
  frameCount: number
  trackCount?: number
}

export type RomResourceCatalog = {
  archives: number
  fontFiles: RomFile[]
  messageArchives: RomFile[]
  scenarioArchives: RomFile[]
  gameData: GameDataArchive[]
  pokemonArchives: import('./rom/pokemon/pokemonArchiveRegistry').PokemonArchiveEntry[]
}

export type GameDataArchive = {
  id: 'opening' | 'intro' | 'nameInput' | 'mapMatrices' | 'zoneEvents' | 'fieldScripts' | 'landData' | 'messages' | 'species' | 'moves'
  label: string
  file?: RomFile
}

export type NitroGraphic = {
  width: number
  height: number
  pixels: Uint8ClampedArray
  graphicsOffset: number
  paletteOffset: number
  colorDepth: number
}
