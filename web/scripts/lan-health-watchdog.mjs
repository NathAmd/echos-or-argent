import { Buffer } from 'node:buffer'
import { clearTimeout, setTimeout } from 'node:timers'

const healthContentType = /^application\/json(?:\s*;\s*charset=utf-8)?$/i

export const lanHealthProbeContracts = Object.freeze({
  health: 'health-json',
  page: 'page-status',
})

function exactHealthDocument(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === 1
    && value.status === 'ok'
}

/**
 * Valide la réponse déjà bornée d'une probe. Une chaîne est renvoyée en cas
 * d'écart afin que le lanceur puisse nommer précisément le service fautif.
 */
export function inspectLanHealthProbeResponse(contract, response) {
  if (contract !== lanHealthProbeContracts.health && contract !== lanHealthProbeContracts.page) {
    throw new TypeError(`Contrat de santé LAN inconnu : ${contract}.`)
  }
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new TypeError('La réponse de santé LAN doit être un objet.')
  }
  if (response.statusCode !== 200) return `HTTP ${response.statusCode ?? 'absent'} au lieu de 200`
  if (contract === lanHealthProbeContracts.page) return undefined

  const contentType = typeof response.contentType === 'string' ? response.contentType.trim() : ''
  if (!healthContentType.test(contentType)) return 'Content-Type de santé invalide'
  if (typeof response.body !== 'string' || Buffer.byteLength(response.body, 'utf8') > 1_024) {
    return 'corps de santé absent ou trop volumineux'
  }
  let parsed
  try {
    parsed = JSON.parse(response.body)
  } catch {
    return 'JSON de santé invalide'
  }
  return exactHealthDocument(parsed) ? undefined : 'contrat de santé différent de {"status":"ok"}'
}

function requirePositiveInteger(name, value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} doit être compris entre 1 et ${maximum}.`)
  }
  return value
}

function validateTargets(targets) {
  if (!Array.isArray(targets) || targets.length === 0 || targets.length > 16) {
    throw new TypeError('Le watchdog LAN exige de 1 à 16 cibles.')
  }
  const labels = new Set()
  return Object.freeze(targets.map((target) => {
    if (
      !target
      || typeof target !== 'object'
      || Array.isArray(target)
      || typeof target.label !== 'string'
      || target.label.length === 0
      || target.label.length > 96
      || target.label.trim() !== target.label
      || labels.has(target.label)
      || (target.contract !== lanHealthProbeContracts.health
        && target.contract !== lanHealthProbeContracts.page)
    ) throw new TypeError('Cible de watchdog LAN invalide ou dupliquée.')
    labels.add(target.label)
    return Object.freeze({ ...target })
  }))
}

/** Exécute une ronde parallèle sans timer ni accès réseau imposé. */
export async function inspectLanHealthTargets(targets, probe) {
  const checkedTargets = validateTargets(targets)
  if (typeof probe !== 'function') throw new TypeError('La probe du watchdog LAN est requise.')
  const outcomes = await Promise.allSettled(checkedTargets.map((target) => probe(target)))
  return Object.freeze(outcomes.flatMap((outcome, index) => {
    if (outcome.status === 'fulfilled') return []
    const target = checkedTargets[index]
    const detail = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
    return [Object.freeze({ label: target.label, detail })]
  }))
}

/**
 * Watchdog supervisé et réentrant. `checkNow` est exposé pour les tests et les
 * diagnostics ; les rondes concurrentes partagent toujours la même Promise.
 */
export function startLanHealthWatchdog(options) {
  const targets = validateTargets(options?.targets)
  if (typeof options?.probe !== 'function' || typeof options?.onUnhealthy !== 'function') {
    throw new TypeError('Le watchdog LAN exige une probe et un gestionnaire de panne.')
  }
  const intervalMs = requirePositiveInteger('L’intervalle du watchdog LAN', options.intervalMs ?? 5_000, 300_000)
  const maximumConsecutiveFailures = requirePositiveInteger(
    'Le seuil du watchdog LAN',
    options.maximumConsecutiveFailures ?? 3,
    20,
  )
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle))
  if (typeof schedule !== 'function' || typeof cancel !== 'function') {
    throw new TypeError('Les ports de minuterie du watchdog LAN sont invalides.')
  }

  let activeCheck
  let consecutiveFailures = 0
  let failureReported = false
  let stopped = false
  let timer

  const scheduleNext = () => {
    if (stopped || timer !== undefined) return
    timer = schedule(() => {
      timer = undefined
      void checkNow()
    }, intervalMs)
  }

  const runCheck = async () => {
    const failures = await inspectLanHealthTargets(targets, options.probe)
    if (stopped) return Object.freeze({ consecutiveFailures, failures, stopped: true })
    consecutiveFailures = failures.length === 0 ? 0 : consecutiveFailures + 1
    if (consecutiveFailures >= maximumConsecutiveFailures && !failureReported) {
      failureReported = true
      stopped = true
      await options.onUnhealthy(failures)
    } else {
      scheduleNext()
    }
    return Object.freeze({ consecutiveFailures, failures, stopped })
  }

  const checkNow = () => {
    if (stopped) {
      return Promise.resolve(Object.freeze({ consecutiveFailures, failures: Object.freeze([]), stopped: true }))
    }
    if (timer !== undefined) {
      cancel(timer)
      timer = undefined
    }
    if (activeCheck) return activeCheck
    activeCheck = runCheck().finally(() => { activeCheck = undefined })
    return activeCheck
  }

  scheduleNext()
  return Object.freeze({
    checkNow,
    stop() {
      stopped = true
      if (timer !== undefined) cancel(timer)
      timer = undefined
    },
  })
}
