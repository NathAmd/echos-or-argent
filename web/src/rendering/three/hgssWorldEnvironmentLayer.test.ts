import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { hgssWeather } from '../../game/world/hgssWeather'
import { HgssWorldEnvironmentLayer, syncHgssSunAnchor } from './hgssWorldEnvironmentLayer'

function createFixture() {
  const scene = new THREE.Scene()
  const hemisphere = new THREE.HemisphereLight()
  const sun = new THREE.DirectionalLight()
  const layer = new HgssWorldEnvironmentLayer(scene, hemisphere, sun)
  const particles = scene.children.find((child): child is THREE.Group => (
    child instanceof THREE.Group && child.children.some((entry) => entry instanceof THREE.Points)
  ))
  if (!particles) throw new Error('Couche météo absente de la scène.')
  return { scene, layer, particles }
}

describe('couche météo du monde HGSS', () => {
  it('déplace ensemble la lumière directionnelle et sa cible autour de l’acteur', () => {
    const sun = new THREE.DirectionalLight()
    const focus = new THREE.Vector3(120, 3, -48)

    syncHgssSunAnchor(sun, focus)

    expect(sun.target.position).toEqual(focus)
    expect(sun.position).toEqual(new THREE.Vector3(102, 33, -34))
    expect(sun.position.clone().sub(sun.target.position).normalize()).toEqual(
      new THREE.Vector3(-18, 30, 14).normalize(),
    )
  })

  it('affiche les traînées de pluie et les ancre à la hauteur du joueur', () => {
    const { layer, particles } = createFixture()
    layer.setEnvironment({ timeOfDay: 1, weather: hgssWeather.heavyRain, mapType: 2 })

    const rain = particles.children.find((child): child is THREE.LineSegments => child instanceof THREE.LineSegments)
    const points = particles.children.find((child): child is THREE.Points => child instanceof THREE.Points)
    layer.update(performance.now() + 16, new THREE.OrthographicCamera(), new THREE.Vector3(4, 38, 7))

    expect(particles.visible).toBe(true)
    expect(rain?.visible).toBe(true)
    expect(rain?.geometry.drawRange.count).toBe(192 * 2)
    expect(points?.visible).toBe(false)
    expect(particles.position.toArray()).toEqual([4, 38, 7])
    expect(rain?.material).toMatchObject({ depthTest: true, depthWrite: false })
    layer.dispose()
  })

  it('conserve la neige native des grottes tout en la faisant respecter la profondeur 3D', () => {
    const { layer, particles } = createFixture()
    layer.setEnvironment({ timeOfDay: 1, weather: hgssWeather.snow, mapType: 3 })
    const points = particles.children.find((child): child is THREE.Points => child instanceof THREE.Points)

    expect(particles.visible).toBe(true)
    expect(points).toMatchObject({ visible: true })
    expect(points?.material).toMatchObject({ depthTest: true, depthWrite: false })
    layer.dispose()
  })

  it('active une profondeur de brume uniquement pendant la météo correspondante', () => {
    const { scene, layer } = createFixture()
    layer.setEnvironment({ timeOfDay: 1, weather: hgssWeather.denseMist, mapType: 1 })
    expect(scene.fog).toBeInstanceOf(THREE.FogExp2)

    layer.setEnvironment({ timeOfDay: 1, weather: hgssWeather.clear, mapType: 1 })
    expect(scene.fog).toBeNull()
    layer.dispose()
  })
})
