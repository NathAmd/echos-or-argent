import { getHgssStarterSpeciesId } from './hgssStarters'

export type StarterCryPreview = {
  preview: (choice: number) => Promise<boolean>
  reset: () => void
}

export function createStarterCryPreview(
  playCry: (speciesId: number, pattern: number) => Promise<void>,
): StarterCryPreview {
  let selectedChoice: number | undefined

  return {
    async preview(choice): Promise<boolean> {
      if (choice === selectedChoice) return false
      const speciesId = getHgssStarterSpeciesId(choice)
      selectedChoice = choice
      try {
        await playCry(speciesId, 0)
      } catch (error) {
        if (selectedChoice === choice) selectedChoice = undefined
        throw error
      }
      return true
    },
    reset(): void {
      selectedChoice = undefined
    },
  }
}
