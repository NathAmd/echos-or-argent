import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { FieldCameraParam, OpeningMapPreview } from '../../ndsTypes'
import type { SceneLayout } from './mapProjection'
import { MapCameraController } from './mapCameraController'

const layout: SceneLayout = {
  floorMinX: 0,
  floorMaxX: 1,
  floorMinZ: 0,
  floorMaxZ: 1,
  cameraHeight: 10,
  cameraDistance: 40,
  focusX: 0,
  focusZ: 0,
}

function createIndoorMap(cameraType = 0): OpeningMapPreview {
  return {
    id: 1,
    header: { cameraType },
    matrix: { hasHeaders: false, width: 1, height: 1 },
    terrain: {
      modelId: 0,
      width: 1,
      height: 1,
      attributes: new Uint16Array(1),
    },
  } as OpeningMapPreview
}

const perspectiveParam: FieldCameraParam = {
  type: 0,
  distance: 100,
  angleX: 0xe000,
  angleY: 0,
  angleZ: 0,
  perspectiveType: 0,
  perspectiveAngle: 0x1000,
  near: 2,
  far: 300,
  lookAtOffsetX: 1,
  lookAtOffsetY: 2,
  lookAtOffsetZ: 3,
}

describe('controleur camera de carte', () => {
  it('applique et redimensionne la projection orthographique de repli', () => {
    const viewport = { width: 400, height: 200 }
    const controller = new MapCameraController(() => viewport)
    controller.setContext(createIndoorMap(), layout, undefined)
    controller.follow(new THREE.Vector3(2, 3, 4))

    expect(controller.camera).toBe(controller.orthographicCamera)
    expect(controller.camera.position.toArray()).toEqual([2, 13, 22])
    expect(controller.orthographicCamera).toMatchObject({
      left: -18,
      right: 18,
      top: 9,
      bottom: -9,
      near: 0.1,
      far: 5_000,
    })

    controller.resize(200, 400)
    expect(controller.orthographicCamera.left).toBe(-4.5)
    expect(controller.orthographicCamera.right).toBe(4.5)
  })

  it('suit une cible de tuile fixe puis revient au joueur', () => {
    const controller = new MapCameraController(() => ({ width: 320, height: 240 }))
    controller.setContext(createIndoorMap(), layout, undefined)
    const player = new THREE.Vector3(8, 2, 6)

    controller.setTileTarget(0, 0)
    controller.follow(player)
    expect(controller.camera.position.toArray()).toEqual([0, 10.08, 18])

    controller.setTileTarget()
    controller.follow(player)
    expect(controller.camera.position.toArray()).toEqual([8, 12, 24])
  })

  it('selectionne la perspective ROM et conserve les offsets transitoires', () => {
    const controller = new MapCameraController(() => ({ width: 400, height: 200 }))
    controller.setContext(createIndoorMap(), layout, [perspectiveParam])
    controller.follow(new THREE.Vector3(4, 5, 6))

    expect(controller.camera).toBe(controller.perspectiveCamera)
    expect(controller.perspectiveCamera.fov).toBe(45)
    expect(controller.perspectiveCamera.aspect).toBe(2)
    expect(controller.perspectiveCamera.near).toBe(2)
    expect(controller.perspectiveCamera.far).toBe(300)
    expect(controller.perspectiveCamera.position.x).toBeCloseTo(5)
    expect(controller.perspectiveCamera.position.y).toBeGreaterThan(7)
    const depthBeforeOffset = controller.perspectiveCamera.position.z
    controller.addDepthOffset(1.25)
    expect(controller.perspectiveCamera.position.z).toBeCloseTo(depthBeforeOffset + 1.25)
  })

  it('translate position et cible par un offset monde réversible sans changer le regard', () => {
    const controller = new MapCameraController(() => ({ width: 320, height: 240 }))
    controller.setContext(createIndoorMap(), layout, [perspectiveParam])
    const player = new THREE.Vector3(4, 5, 6)
    controller.follow(player)
    const base = controller.camera.position.clone()
    const quaternion = controller.camera.quaternion.clone()

    controller.setWorldTranslationOffset(-8, 4)
    expect(controller.camera.position.toArray()).toEqual([base.x - 8, base.y, base.z + 4])
    expect(controller.camera.quaternion.equals(quaternion)).toBe(true)
    controller.follow(player)
    expect(controller.camera.position.toArray()).toEqual([base.x - 8, base.y, base.z + 4])
    expect(controller.camera.quaternion.equals(quaternion)).toBe(true)

    controller.setWorldTranslationOffset(0, 0)
    expect(controller.camera.position.toArray()).toEqual(base.toArray())
  })
})
