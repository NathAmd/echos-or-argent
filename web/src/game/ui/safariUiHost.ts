import type { GameDigitalAction } from '../../gameInput'
import type { NitroGraphic } from '../../ndsTypes'
import type {
  HgssSafariCellSpriteAsset,
  HgssSafariUiAssets,
} from '../../rom/safari/safariUiAssets'
import type {
  HgssSafariFieldStep,
  HgssSafariRunnerControls,
} from '../safari/hgssSafariFieldCommands'
import type { HgssSafariObjectId } from '../safari/hgssSafariState'
import {
  createSafariCustomizerController,
  createSafariDecoratorController,
  type SafariCustomizerController,
  type SafariCustomizerControllerOptions,
  type SafariDecoratorController,
  type SafariDecoratorControllerOptions,
  type SafariUiMessageBanks,
} from './safariUiController'

export type SafariUiHostResources = {
  assets: HgssSafariUiAssets
  messageBanks: SafariUiMessageBanks
  createGraphic: (graphic: NitroGraphic) => HTMLElement
  playSoundEffect?: (sequenceId: number) => void
  createObjectPreview?: (
    objectId: HgssSafariObjectId,
    nativeSprites: HgssSafariCellSpriteAsset,
  ) => HTMLElement | undefined
}

type SafariUiHostControllerFactories = {
  customizer: (
    root: HTMLElement,
    options: SafariCustomizerControllerOptions,
  ) => SafariCustomizerController
  decorator: (
    root: HTMLElement,
    options: SafariDecoratorControllerOptions,
  ) => SafariDecoratorController
}

export type SafariUiHostOptions = {
  customizerRoot: HTMLElement
  decoratorRoot: HTMLElement
  readResources: () => SafariUiHostResources | undefined
  onResume: () => void
  onStateChange?: () => void
  /** Point d'injection de test; le jeu utilise toujours les contrôleurs Safari réels. */
  controllerFactories?: SafariUiHostControllerFactories
}

export type SafariUiHost = {
  present: (step: HgssSafariFieldStep, runner: Partial<HgssSafariRunnerControls>) => void
  handle: (action: GameDigitalAction) => boolean
  close: () => void
  isOpen: () => boolean
  getKind: () => HgssSafariFieldStep['kind'] | undefined
}

type ActiveSafariApp =
  | {
    kind: 'safariCustomizer'
    submit: HgssSafariRunnerControls['submitSafariCustomizerChange']
    finish: HgssSafariRunnerControls['closeSafariCustomizer']
  }
  | {
    kind: 'safariDecorator'
    finish: HgssSafariRunnerControls['submitSafariDecoratorSelection']
  }

type SafariControllers = {
  customizer: SafariCustomizerController
  decorator: SafariDecoratorController
  assets: HgssSafariUiAssets
  messageBanks: SafariUiMessageBanks
}

const defaultFactories: SafariUiHostControllerFactories = {
  customizer: createSafariCustomizerController,
  decorator: createSafariDecoratorController,
}

function requireRunnerMethod<K extends keyof HgssSafariRunnerControls>(
  runner: Partial<HgssSafariRunnerControls>,
  method: K,
): HgssSafariRunnerControls[K] {
  const value = runner[method]
  if (typeof value !== 'function') {
    throw new Error(`Le runner du Parc Safari ne fournit pas ${method}.`)
  }
  return value as HgssSafariRunnerControls[K]
}

/**
 * Pont unique entre les suspensions script 716/717 et leurs deux interfaces.
 * Les callbacks restent liés au runner courant : aucun remontage de page n'est
 * nécessaire pendant les échanges successifs du Customizer.
 */
export function createSafariUiHost(options: SafariUiHostOptions): SafariUiHost {
  const factories = options.controllerFactories ?? defaultFactories
  let controllers: SafariControllers | undefined
  let active: ActiveSafariApp | undefined

  function notifyStateChange(): void {
    options.onStateChange?.()
  }

  function resume(): void {
    active = undefined
    notifyStateChange()
    options.onResume()
  }

  function finishCustomizer(): void {
    if (active?.kind !== 'safariCustomizer') return
    const finish = active.finish
    finish()
    resume()
  }

  function finishDecorator(objectId: HgssSafariObjectId | undefined): void {
    if (active?.kind !== 'safariDecorator') return
    const finish = active.finish
    finish(objectId)
    controllers?.decorator.close()
    resume()
  }

  function ensureControllers(): SafariControllers {
    const resources = options.readResources()
    if (!resources) throw new Error('Les ressources UI ROM du Parc Safari sont absentes.')
    if (controllers?.assets === resources.assets && controllers.messageBanks === resources.messageBanks) {
      return controllers
    }
    controllers?.customizer.close()
    controllers?.decorator.close()
    const customizer = factories.customizer(options.customizerRoot, {
      assets: resources.assets,
      messageBanks: resources.messageBanks,
      initialAreas: [0, 1, 2, 3, 4, 5],
      createGraphic: resources.createGraphic,
      playSoundEffect: resources.playSoundEffect,
      onCommit: (change) => {
        if (active?.kind !== 'safariCustomizer') return
        active.submit(change)
        notifyStateChange()
      },
      onClose: finishCustomizer,
      onSelectionChange: notifyStateChange,
    })
    const decorator = factories.decorator(options.decoratorRoot, {
      assets: resources.assets,
      messageBanks: resources.messageBanks,
      objectIds: [],
      createGraphic: resources.createGraphic,
      playSoundEffect: resources.playSoundEffect,
      createObjectPreview: resources.createObjectPreview,
      onSelect: finishDecorator,
      onClose: () => finishDecorator(undefined),
      onSelectionChange: notifyStateChange,
    })
    controllers = {
      customizer,
      decorator,
      assets: resources.assets,
      messageBanks: resources.messageBanks,
    }
    return controllers
  }

  function present(step: HgssSafariFieldStep, runner: Partial<HgssSafariRunnerControls>): void {
    if (active) throw new Error(`L'application ${active.kind} est déjà ouverte.`)
    const ui = ensureControllers()
    if (step.kind === 'safariCustomizer') {
      active = {
        kind: step.kind,
        submit: requireRunnerMethod(runner, 'submitSafariCustomizerChange'),
        finish: requireRunnerMethod(runner, 'closeSafariCustomizer'),
      }
      ui.decorator.close()
      ui.customizer.open(step.areas, step.blockCounts, step.showBlockCounts)
    } else {
      active = {
        kind: step.kind,
        finish: requireRunnerMethod(runner, 'submitSafariDecoratorSelection'),
      }
      ui.customizer.close()
      ui.decorator.open(step.candidates.map(({ objectId, unavailableReason }) => ({
        objectId,
        unavailableReason,
      })))
    }
    notifyStateChange()
  }

  return {
    present,
    handle(action) {
      if (!active || !controllers) return false
      // Start/Select sont ignorés par les overlays 108. Ils doivent néanmoins
      // être consommés ici pour ne jamais ouvrir le menu du jeu sous l'app.
      if (action === 'menu') return true
      if (active.kind === 'safariCustomizer') controllers.customizer.handle(action)
      else controllers.decorator.handle(action)
      return true
    },
    close() {
      controllers?.customizer.close()
      controllers?.decorator.close()
      active = undefined
      notifyStateChange()
    },
    isOpen: () => active !== undefined,
    getKind: () => active?.kind,
  }
}
