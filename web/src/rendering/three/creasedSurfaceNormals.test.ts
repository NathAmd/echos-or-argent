import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyCreasedSurfaceNormals } from './creasedSurfaceNormals'

function joinedTriangles(lastVertex: [number, number, number]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 0, 0, 1, 0, ...lastVertex,
  ], 3))
  return geometry
}

describe('creased world surface normals', () => {
  it('smooths neighboring low-poly facets below the crease angle', () => {
    const geometry = applyCreasedSurfaceNormals(joinedTriangles([-Math.SQRT1_2, 0, Math.SQRT1_2]))
    const normals = geometry.getAttribute('normal')
    const first = new THREE.Vector3().fromBufferAttribute(normals, 0)
    const shared = new THREE.Vector3().fromBufferAttribute(normals, 3)
    expect(first.dot(shared)).toBeCloseTo(1)
    expect(first.x).toBeGreaterThan(0.1)
    expect(first.z).toBeGreaterThan(0.7)
  })

  it('keeps architectural right angles crisp', () => {
    const geometry = applyCreasedSurfaceNormals(joinedTriangles([0, 0, 1]))
    const normals = geometry.getAttribute('normal')
    const first = new THREE.Vector3().fromBufferAttribute(normals, 0)
    const shared = new THREE.Vector3().fromBufferAttribute(normals, 3)
    expect(first.dot(shared)).toBeCloseTo(0)
  })
})
