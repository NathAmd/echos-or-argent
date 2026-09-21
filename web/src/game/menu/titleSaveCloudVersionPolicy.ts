import type {
  HgssFullSaveCloudPresentSnapshot,
  HgssFullSaveCloudSnapshot,
} from '../save/hgssFullSaveCloudVault'
import {
  compareHgssSharedCampaignSaveProgression,
  readHgssSharedCampaignSaveExtension,
} from '../save/hgssSharedCampaignSaveExtension'

export type TitleSaveCloudVersionDecision =
  | 'candidate-newer'
  | 'current-newer'
  | 'equivalent'
  | 'simultaneous-conflict'

function requireCanonicalTimestamp(value: string): number {
  const timestamp = new Date(value)
  if (value.length > 32 || Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== value) {
    throw new Error('La réconciliation cloud a reçu un horodatage invalide.')
  }
  return timestamp.getTime()
}

export function titleSaveCloudSnapshotTimestamp(snapshot: HgssFullSaveCloudSnapshot): string {
  return snapshot.kind === 'present' ? snapshot.savedAt : snapshot.changedAt
}

export function sameTitleSaveCloudDocument(
  left: HgssFullSaveCloudPresentSnapshot['document'],
  right: HgssFullSaveCloudPresentSnapshot['document'],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Empêche l'arbitrage cloud de régresser ou fusionner implicitement une
 * branche de campagne. `causallyAttested` autorise uniquement l'ajout initial
 * de l'extension quand l'empreinte prouve une descendance réelle.
 */
export function guardTitleSaveCloudCampaignVersion(
  candidate: HgssFullSaveCloudSnapshot,
  current: HgssFullSaveCloudSnapshot,
  decision: TitleSaveCloudVersionDecision,
  causallyAttested = false,
): TitleSaveCloudVersionDecision {
  // Une progression de campagne ne doit jamais masquer une vraie divergence
  // causale du document complet (inventaire, équipe, position, etc.).
  if (decision === 'simultaneous-conflict') return decision

  const candidateCampaign = candidate.kind === 'present'
    ? readHgssSharedCampaignSaveExtension(candidate.document.extensions)
    : undefined
  const currentCampaign = current.kind === 'present'
    ? readHgssSharedCampaignSaveExtension(current.document.extensions)
    : undefined
  if (!candidateCampaign && !currentCampaign) return decision

  // Une tombstone n'est pas un document legacy incomplet : l'absence
  // d'extension y est intentionnelle et son ordre causal reste souverain.
  if (candidate.kind === 'deleted' || current.kind === 'deleted') {
    return causallyAttested ? decision : 'simultaneous-conflict'
  }

  if (!candidateCampaign || !currentCampaign) {
    const extendedSideWins = candidateCampaign
      ? decision === 'candidate-newer'
      : decision === 'current-newer'
    return causallyAttested && extendedSideWins ? decision : 'simultaneous-conflict'
  }

  const order = compareHgssSharedCampaignSaveProgression(candidateCampaign, currentCampaign)
  if (order === 'different-branch' || order === 'divergent') return 'simultaneous-conflict'
  if (order === 'equivalent') return decision
  if (order === 'left-ahead') {
    return causallyAttested && decision === 'current-newer'
      ? 'simultaneous-conflict'
      : 'candidate-newer'
  }
  return causallyAttested && decision === 'candidate-newer'
    ? 'simultaneous-conflict'
    : 'current-newer'
}

/**
 * Politique de compatibilité pour un ancien service/double sans horloge logique
 * et pour départager deux traces locales legacy. Le coordinateur de production
 * emploie d'abord l'ancrage ETag + `Opaque-Mutation` + empreinte locale ; il ne
 * doit jamais appeler cette fonction pour arbitrer deux branches causales.
 *
 * Dans ce fallback seulement, deux versions sont ordonnées par leur date
 * métier. Une égalité ne demande une intervention que si les états divergent.
 */
export function resolveTitleSaveCloudVersion(
  candidate: HgssFullSaveCloudSnapshot,
  current: HgssFullSaveCloudSnapshot,
): TitleSaveCloudVersionDecision {
  const candidateTime = requireCanonicalTimestamp(titleSaveCloudSnapshotTimestamp(candidate))
  const currentTime = requireCanonicalTimestamp(titleSaveCloudSnapshotTimestamp(current))
  if (candidateTime > currentTime) {
    return guardTitleSaveCloudCampaignVersion(candidate, current, 'candidate-newer')
  }
  if (candidateTime < currentTime) {
    return guardTitleSaveCloudCampaignVersion(candidate, current, 'current-newer')
  }

  let decision: TitleSaveCloudVersionDecision
  if (candidate.kind !== current.kind) decision = 'simultaneous-conflict'
  else if (candidate.kind === 'deleted') decision = 'equivalent'
  else if (current.kind !== 'present') decision = 'simultaneous-conflict'
  else decision = sameTitleSaveCloudDocument(candidate.document, current.document)
    ? 'equivalent'
    : 'simultaneous-conflict'
  return guardTitleSaveCloudCampaignVersion(candidate, current, decision)
}
