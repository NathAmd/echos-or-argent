import type { OpeningMapPreview } from '../../ndsTypes'
import { isHgssNighttime, type HgssTimeOfDay } from '../time/hgssRtc'
import type { HgssWeather } from './hgssWeather'

export type HgssWorldEnvironmentPresentation = { timeOfDay: HgssTimeOfDay, weather: HgssWeather, mapType: number }

type EnvironmentSnapshot = HgssWorldEnvironmentPresentation & {
  map: OpeningMapPreview
  now: Date
  allowMusicTransition: boolean
  radioMusicSequenceId?: number
}

export function createHgssEnvironmentCoordinator(options: {
  readSnapshot: () => EnvironmentSnapshot | undefined
  applyPresentation: (environment: HgssWorldEnvironmentPresentation) => void
  playMapMusic: (map: OpeningMapPreview, now: Date) => Promise<unknown> | undefined
}): { update: (force?: boolean) => void } {
  let nextSyncAt = 0
  let synchronizedMapId: number | undefined
  let synchronizedNightMusic: boolean | undefined
  let observedMapId: number | undefined
  let observedNightMusic: boolean | undefined
  let environmentRevision = 0
  let pendingMusicTransition: {
    revision: number
    mapId: number
    nightMusic: boolean
  } | undefined
  return {
    update(force = false) {
      const timestamp = performance.now()
      if (!force && timestamp < nextSyncAt) return
      nextSyncAt = timestamp + 250
      const snapshot = options.readSnapshot()
      if (!snapshot) return
      options.applyPresentation(snapshot)
      const nightMusic = isHgssNighttime(snapshot.timeOfDay)
      if (observedMapId !== snapshot.map.id || observedNightMusic !== nightMusic) {
        observedMapId = snapshot.map.id
        observedNightMusic = nightMusic
        environmentRevision += 1
      }
      if (synchronizedMapId !== snapshot.map.id || synchronizedNightMusic === undefined) {
        synchronizedMapId = snapshot.map.id
        synchronizedNightMusic = nightMusic
        pendingMusicTransition = undefined
        return
      }
      if (synchronizedNightMusic === nightMusic) return
      // La Radio possede le canal BGM et restaure elle-meme la piste de carte
      // lorsqu'elle est fermee. Memoriser ici le nouveau creneau evite une
      // seconde reprise concurrente au tick suivant.
      if (snapshot.radioMusicSequenceId) {
        synchronizedNightMusic = nightMusic
        pendingMusicTransition = undefined
        return
      }
      // Un combat ou un script de terrain peut temporairement posseder la
      // musique. Ne pas acquitter le changement tant que ce proprietaire est
      // actif : le prochain tick autorise doit encore pouvoir le presenter.
      if (!snapshot.allowMusicTransition) return
      if (pendingMusicTransition?.revision === environmentRevision
        && pendingMusicTransition.mapId === snapshot.map.id
        && pendingMusicTransition.nightMusic === nightMusic) return
      const request = {
        revision: environmentRevision,
        mapId: snapshot.map.id,
        nightMusic,
      }
      let playback: Promise<unknown> | undefined
      try {
        playback = options.playMapMusic(snapshot.map, snapshot.now)
      } catch {
        return
      }
      if (!playback) return
      pendingMusicTransition = request
      void playback
        .then(() => {
          if (pendingMusicTransition !== request
            || environmentRevision !== request.revision
            || synchronizedMapId !== request.mapId) return
          synchronizedNightMusic = request.nightMusic
        })
        .catch(() => undefined)
        .finally(() => {
          if (pendingMusicTransition === request) pendingMusicTransition = undefined
        })
    },
  }
}
