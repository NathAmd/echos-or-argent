export type BattleConditionMessagePair = readonly [applied: string, rejected: string]

const conditionMessages: Readonly<Record<string, BattleConditionMessagePair>> = {
  mist: ['Une brume protège l’équipe!', 'La brume est déjà présente.'],
  focusEnergy: ['Le taux de critiques augmente!', 'La concentration est déjà maximale.'],
  substitute: ['Un clone apparaît!', 'Impossible de créer un clone!'],
  substituteHit: ['Le clone encaisse les dégâts!', 'Le clone encaisse les dégâts!'],
  substituteBroken: ['Le clone disparaît!', 'Le clone disparaît!'],
  disable: ['Une capacité est mise hors service!', 'Mais cela échoue!'],
  encore: ['La cible doit répéter sa dernière capacité!', 'Mais cela échoue!'],
  lockOn: ['La cible est verrouillée!', 'La cible est déjà verrouillée!'],
  trapped: ['La cible est prise au piège!', 'La cible est déjà prise au piège!'],
  nightmare: ['La cible est plongée dans un cauchemar!', 'Mais cela échoue!'],
  nightmareDamage: ['Le cauchemar inflige des dégâts!', 'Le cauchemar inflige des dégâts!'],
  curse: ['La cible est maudite!', 'Mais cela échoue!'],
  curseDamage: ['La malédiction frappe!', 'La malédiction frappe!'],
  spikes: ['Des Picots sont dispersés au sol!', 'Il y a déjà trop de Picots!'],
  toxicSpikes: ['Des Pics Toxik sont dispersés au sol!', 'Il y a déjà trop de Pics Toxik!'],
  stealthRock: ['Des pierres flottent autour de l’équipe!', 'Piège de Roc est déjà actif!'],
  perishSong: ['Tous les Pokémon entendent le Requiem!', 'Le compte à rebours est déjà lancé!'],
  endure: ['Le Pokémon se prépare à encaisser!', 'Mais cela échoue!'],
  infatuation: ['La cible tombe amoureuse!', 'Mais cela échoue!'],
  infatuationActive: ['Le Pokémon est amoureux!', 'Le Pokémon est amoureux!'],
  infatuationStopped: ["L’amour l’empêche d’attaquer!", "L’amour l’empêche d’attaquer!"],
  safeguard: ['L’équipe est enveloppée d’un voile protecteur!', 'Rune Protect est déjà actif!'],
  tailwind: ['Un vent arrière souffle sur l’équipe!', 'Le Vent Arrière souffle déjà!'],
  luckyChant: ['L’équipe est protégée des coups critiques!', 'Air Veinard est déjà actif!'],
  stockpile: ['Le Pokémon stocke de l’énergie!', 'Impossible de stocker davantage!'],
  torment: ['La cible est tourmentée!', 'La cible est déjà tourmentée!'],
  taunt: ['La cible est provoquée!', 'La cible est déjà provoquée!'],
  yawn: ['La cible commence à somnoler!', 'Mais cela échoue!'],
  gravity: ['La gravité s’intensifie!', 'La gravité est déjà intense!'],
  trickRoom: ['Les dimensions sont inversées!', 'Les dimensions sont déjà inversées!'],
  embargo: ['La cible ne peut plus utiliser d’objet!', 'Mais cela échoue!'],
  healBlock: ['La cible ne peut plus récupérer de PV!', 'Mais cela échoue!'],
  magnetRise: ['Le Pokémon lévite grâce au magnétisme!', 'Mais cela échoue!'],
  aquaRing: ['Un voile d’eau entoure le Pokémon!', 'Anneau Hydro est déjà actif!'],
  bindingDamage: ['Le piège inflige des dégâts!', 'Le piège inflige des dégâts!'],
  bindingEnded: ['Le Pokémon est libéré du piège!', 'Le Pokémon est libéré du piège!'],
  psychUp: ['Les changements de stats sont copiés!', 'Les changements de stats sont copiés!'],
  powerSwap: ['Les changements offensifs sont échangés!', 'Les changements offensifs sont échangés!'],
  guardSwap: ['Les changements défensifs sont échangés!', 'Les changements défensifs sont échangés!'],
  heartSwap: ['Les changements de stats sont échangés!', 'Les changements de stats sont échangés!'],
  flashFire: ['Torche renforce les capacités Feu!', 'Torche absorbe l’attaque Feu!'],
  swallow: ['L’énergie stockée restaure les PV!', 'Mais cela échoue!'],
  charge: ['Le Pokémon se charge en électricité!', 'Le Pokémon est déjà chargé!'],
  wish: ['Un vœu est formulé!', 'Un vœu est déjà en attente!'],
  wishGranted: ['Le vœu se réalise!', 'Le vœu se réalise!'],
  ingrain: ['Le Pokémon plante ses racines!', 'Le Pokémon est déjà enraciné!'],
  mudSport: ['L’électricité est affaiblie!', 'L’électricité est affaiblie!'],
  waterSport: ['Le feu est affaibli!', 'Le feu est affaibli!'],
  powerTrick: ['Attaque et Défense sont interverties!', 'Attaque et Défense sont interverties!'],
  defog: ['Le brouillard et les obstacles sont dissipés!', 'Mais cela échoue!'],
  resistBerry: ['La Baie tenue affaiblit l’attaque!', 'La Baie tenue affaiblit l’attaque!'],
  heldItemEndure: ['L’objet tenu permet de résister avec 1 PV!', 'L’objet tenu permet de résister avec 1 PV!'],
  screensBroken: ['Les protections de la cible sont détruites!', 'Mais cela échoue!'],
  rapidSpinClear: ['Le Pokémon se libère des pièges!', 'Mais cela échoue!'],
  payDay: ['Des pièces sont éparpillées!', 'Mais cela échoue!'],
  bideStore: ['Le Pokémon encaisse les coups!', 'Mais cela échoue!'],
  magicCoat: ['Le Pokémon se couvre d’un reflet magique!', 'Mais cela échoue!'],
  magicCoatReflected: ['La capacité est renvoyée!', 'Mais cela échoue!'],
  snatch: ['Le Pokémon guette une capacité!', 'Mais cela échoue!'],
  moveSnatched: ['La capacité est saisie!', 'Mais cela échoue!'],
  imprison: ['Le Pokémon scelle les capacités partagées!', 'Possessif est déjà actif!'],
  heldItemRemoved: ['L’objet tenu de la cible est neutralisé!', 'Mais cela échoue!'],
  transform: ['Le Pokémon se transforme!', 'Mais cela échoue!'],
  disableEnded: ['Entrave prend fin!', 'Entrave prend fin!'],
  encoreEnded: ['Encore prend fin!', 'Encore prend fin!'],
  tauntEnded: ['La Provoc prend fin!', 'La Provoc prend fin!'],
  healBlockEnded: ['Anti-Soin prend fin!', 'Anti-Soin prend fin!'],
  embargoEnded: ["L’Embargo prend fin!", "L’Embargo prend fin!"],
  magnetRiseEnded: ['Vol Magnétik prend fin!', 'Vol Magnétik prend fin!'],
  reflectEnded: ['Protection se dissipe!', 'Protection se dissipe!'],
  lightScreenEnded: ['Mur Lumière se dissipe!', 'Mur Lumière se dissipe!'],
  mistEnded: ['La Brume se dissipe!', 'La Brume se dissipe!'],
  safeguardEnded: ['Rune Protect se dissipe!', 'Rune Protect se dissipe!'],
  tailwindEnded: ['Le Vent Arrière tombe!', 'Le Vent Arrière tombe!'],
  luckyChantEnded: ['Air Veinard prend fin!', 'Air Veinard prend fin!'],
  gravityEnded: ['La gravité redevient normale!', 'La gravité redevient normale!'],
  trickRoomEnded: ['Les dimensions redeviennent normales!', 'Les dimensions redeviennent normales!'],
}

const heldItemConditions = new Set([
  'resistBerry', 'heldItemEndure', 'powerHerb', 'itemRecycled', 'itemStolen', 'itemKnockedOff',
])

export function resolveBattleConditionMessage(
  condition: string,
  applied: boolean,
  rejectedFallback = 'Mais cela échoue!',
): string {
  if (condition.startsWith('perish:')) {
    const count = Number(condition.slice('perish:'.length))
    if (Number.isFinite(count)) return `Le compte du Requiem tombe à ${count}!`
  }
  return conditionMessages[condition]?.[applied ? 0 : 1]
    ?? (applied ? 'La condition de combat change!' : rejectedFallback)
}

export function isHeldItemBattleCondition(condition: string): boolean {
  return heldItemConditions.has(condition)
}
