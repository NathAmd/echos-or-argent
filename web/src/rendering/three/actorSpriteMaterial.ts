import * as THREE from 'three'

const spriteProjection = '\tgl_Position = projectionMatrix * mvPosition;'
const actorSpriteDepthModeKey = 'hgssActorSpriteDepthMode'

export type ActorSpriteDepthMode = 'none' | 'upright'

function normalizeActorSpriteDepthMode(mode: ActorSpriteDepthMode | boolean): ActorSpriteDepthMode {
  return typeof mode === 'boolean' ? (mode ? 'upright' : 'none') : mode
}

/**
 * Three.js donne par defaut la meme profondeur a tous les pixels d'un Sprite.
 * Un acteur HGSS est pourtant debout : sa tete est plus proche de la camera que
 * ses pieds. On conserve exactement sa silhouette 2D, mais on reconstruit cette
 * profondeur verticale pour que les decors 3D l'occultent proprement.
 */
export function patchActorSpriteVertexShader(vertexShader: string): string {
  if (!vertexShader.includes(spriteProjection)) {
    throw new Error('Le shader Sprite Three.js ne contient plus le point d\'ancrage attendu.')
  }
  return vertexShader.replace(spriteProjection, `${spriteProjection}
	float uprightDepthSlope = clamp( modelViewMatrix[ 1 ].z / max( abs( modelViewMatrix[ 1 ].y ), 0.0001 ), -4.0, 4.0 );
	vec4 uprightDepthPosition = projectionMatrix * vec4( mvPosition.xy, mvPosition.z + alignedPosition.y * uprightDepthSlope, mvPosition.w );
	gl_Position.z = uprightDepthPosition.z * gl_Position.w / uprightDepthPosition.w;`)
}

/**
 * Configure le contrat de profondeur sans remplacer la matiere persistante du
 * joueur. Le mode upright est commun aux pieces et au terrain : le pied garde
 * la profondeur de l'ancre ROM et chaque pixel plus haut suit l'axe vertical
 * du monde. Cela conserve l'ordre tete/comptoir/facade d'un acteur debout.
 */
export function setActorSpriteDepthMode(
  material: THREE.SpriteMaterial,
  requestedMode: ActorSpriteDepthMode | boolean,
): void {
  const mode = normalizeActorSpriteDepthMode(requestedMode)
  if (material.userData[actorSpriteDepthModeKey] === mode) return
  material.userData[actorSpriteDepthModeKey] = mode
  material.depthTest = mode !== 'none'
  material.onBeforeCompile = mode === 'upright'
    ? (shader): void => { shader.vertexShader = patchActorSpriteVertexShader(shader.vertexShader) }
    : (): void => {}
  material.customProgramCacheKey = (): string => `hgss-actor-depth-${mode}-v3`
  material.needsUpdate = true
}

export function getActorSpriteDepthMode(material: THREE.SpriteMaterial): ActorSpriteDepthMode {
  const mode = material.userData[actorSpriteDepthModeKey]
  return mode === 'upright' ? mode : 'none'
}

export function createActorSpriteMaterial(
  texture: THREE.Texture | null,
  depthMode: ActorSpriteDepthMode | boolean = 'upright',
): THREE.SpriteMaterial {
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.02,
    depthTest: false,
    depthWrite: false,
  })
  setActorSpriteDepthMode(material, depthMode)
  return material
}
