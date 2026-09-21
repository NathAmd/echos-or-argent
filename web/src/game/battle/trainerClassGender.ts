export type TrainerClassGender = 'male' | 'female' | 'double'

const trainerClassCount = 128
const femaleTrainerClasses = new Set([
  1, 3, 5, 7, 8, 10, 13, 17, 18, 21, 22, 25, 26, 30, 33, 35, 36, 40, 43, 45,
  47, 50, 54, 56, 61, 62, 67, 70, 74, 76, 77, 80, 82, 84, 85, 87, 88, 90, 92,
  94, 96, 99, 101, 103, 105, 106, 107, 114, 126,
])
const doubleTrainerClasses = new Set([89, 112])

export function getTrainerClassGender(trainerClass: number): TrainerClassGender {
  if (!Number.isInteger(trainerClass) || trainerClass < 0 || trainerClass >= trainerClassCount) {
    throw new Error(`La classe de dresseur HGSS ${trainerClass} est invalide.`)
  }
  if (femaleTrainerClasses.has(trainerClass)) return 'female'
  if (doubleTrainerClasses.has(trainerClass)) return 'double'
  return 'male'
}