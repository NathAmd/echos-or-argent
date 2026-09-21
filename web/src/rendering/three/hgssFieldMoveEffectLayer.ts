import * as THREE from 'three'
import { sampleHgssVBlankFrame } from '../../game/time/hgssFrameTiming'
import {
  resolveHgssFieldMoveDirectionOffset,
  sampleHgssFieldMoveEffect,
  type HgssFieldMoveEffectMode,
} from '../../game/world/hgssFieldMoveEffect'
import { usesWorldMatrixCoordinates } from '../../game/world/mapCoordinates'
import type { OpeningMapPreview, PlayerDirection, RomInventory } from '../../ndsTypes'
import { resolveHgssFieldMoveEffectAsset, type HgssFieldMoveEffectAsset } from '../../rom/overworld/hgssFieldMoveEffectAssets'
import { NitroAnimatedModelInstance } from './nitroAnimatedModelInstance'

export type HgssFieldMoveEffectResult = 'completed' | 'cancelled'

type FieldMoveActor = Readonly<{
  position: THREE.Vector3
  direction: PlayerDirection
}>

export type HgssFieldMoveEffectContext = Readonly<{
  map: OpeningMapPreview | undefined
  player: FieldMoveActor | undefined
  follower: FieldMoveActor | undefined
}>

type ActiveFieldMoveEffect = {
  mode: HgssFieldMoveEffectMode
  instance: NitroAnimatedModelInstance
  asset: HgssFieldMoveEffectAsset
  startedAt: number
  lastFrame: number
  cameraOffset: Readonly<{ x: number, z: number }>
  cameraPulse: boolean
  resolve: (result: HgssFieldMoveEffectResult) => void
}

type FieldMoveCamera = Readonly<{
  setWorldTranslationOffset: (x: number, z: number) => void
}>

/** Possède le modèle Nitro, sa timeline VBlank et la translation caméra native. */
export class HgssFieldMoveEffectLayer {
  readonly group = new THREE.Group()
  readonly runtime = Object.freeze({
    playFieldMoveEffect: (
      mode: HgssFieldMoveEffectMode,
      modelResolver: RomInventory['gymOverlayModelResolver'],
      animationResolver: RomInventory['gymOverlayAnimationResolver'],
    ) => this.play(mode, modelResolver, animationResolver),
    clearFieldMoveEffect: () => this.clear(),
  })

  private active: ActiveFieldMoveEffect | undefined
  private readonly camera: FieldMoveCamera
  private readonly readContext: () => HgssFieldMoveEffectContext
  private readonly now: () => number

  constructor(
    parent: THREE.Object3D,
    camera: FieldMoveCamera,
    readContext: () => HgssFieldMoveEffectContext,
    now: () => number = () => performance.now(),
  ) {
    this.camera = camera
    this.readContext = readContext
    this.now = now
    this.group.name = 'hgss-field-move-effect'
    parent.add(this.group)
  }

  play(
    mode: HgssFieldMoveEffectMode,
    modelResolver: RomInventory['gymOverlayModelResolver'],
    animationResolver: RomInventory['gymOverlayAnimationResolver'],
  ): Promise<HgssFieldMoveEffectResult> {
    if (this.active) throw new Error('Un effet de capacité terrain HGSS est déjà actif.')
    const asset = resolveHgssFieldMoveEffectAsset(mode, modelResolver, animationResolver)
    const context = this.readContext()
    if (!context.map) throw new Error(`Aucune carte ROM active pour l'effet terrain ${asset.profile.kind}.`)
    const actor = asset.profile.target === 'player' ? context.player : context.follower
    if (!actor) throw new Error(`Le MapObject ${asset.profile.target} de l'effet terrain ${asset.profile.kind} est absent.`)
    if (!context.player) throw new Error(`Le joueur requis par l'effet terrain ${asset.profile.kind} est absent.`)

    const tileSize = usesWorldMatrixCoordinates(context.map) ? 1 : 16
    const positionOffset = resolveHgssFieldMoveDirectionOffset(actor.direction, tileSize)
    const cameraOffset = resolveHgssFieldMoveDirectionOffset(context.player.direction, tileSize / 2)
    const instance = new NitroAnimatedModelInstance(context.map, asset.model, this.group)
    const startedAt = this.now()
    try {
      instance.object.position.set(
        actor.position.x + positionOffset.x,
        actor.position.y - 0.08,
        actor.position.z + positionOffset.z,
      )
      if (usesWorldMatrixCoordinates(context.map)) instance.object.scale.setScalar(1 / 16)
      instance.applyFrame(asset.frames[0]!)
      instance.animate(startedAt)
    } catch (error) {
      this.group.remove(instance.object)
      instance.dispose()
      throw error
    }

    return new Promise((resolve) => {
      this.active = {
        mode,
        instance,
        asset,
        startedAt,
        lastFrame: 0,
        cameraOffset,
        cameraPulse: false,
        resolve,
      }
    })
  }

  update(now: number): void {
    const active = this.active
    if (!active) return
    const sample = sampleHgssFieldMoveEffect(active.mode, sampleHgssVBlankFrame(now, active.startedAt))
    if (sample.complete) {
      this.kill(active, 'completed')
      return
    }
    if (sample.cameraPulse !== active.cameraPulse) {
      active.cameraPulse = sample.cameraPulse
      this.camera.setWorldTranslationOffset(
        sample.cameraPulse ? active.cameraOffset.x : 0,
        sample.cameraPulse ? active.cameraOffset.z : 0,
      )
    }
    active.instance.object.visible = sample.visible
    if (sample.visible && sample.animationFrame !== active.lastFrame) {
      active.instance.applyFrame(active.asset.frames[sample.animationFrame]!)
      active.lastFrame = sample.animationFrame
    }
    if (sample.visible) active.instance.animate(now)
  }

  clear(): void {
    if (this.active) this.kill(this.active, 'cancelled')
    this.camera.setWorldTranslationOffset(0, 0)
    this.group.clear()
  }

  dispose(): void {
    this.clear()
    this.group.removeFromParent()
  }

  private kill(active: ActiveFieldMoveEffect, result: HgssFieldMoveEffectResult): void {
    if (this.active !== active) return
    this.active = undefined
    this.camera.setWorldTranslationOffset(0, 0)
    this.group.remove(active.instance.object)
    active.instance.dispose()
    active.resolve(result)
  }
}
