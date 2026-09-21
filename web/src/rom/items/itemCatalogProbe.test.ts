import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { readRomInventory } from '../../nds'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ITEM_CATALOG_AUDIT === '1' && existsSync(romPath) ? it : it.skip

probe('inventories ROM field items whose effects are not party-targeted', async () => {
  const bytes = await readFile(romPath)
  const inventory = await readRomInventory(new File([bytes], basename(romPath)))
  const items = inventory.itemCatalog.items
    .filter((item) => item.itemId > 0 && ((item.fieldUseFunction !== 0 && item.partyUse === 0) || /repousse/i.test(item.name)))
    .map(({ itemId, name, fieldUseFunction, description }) => ({ itemId, name, fieldUseFunction, description }))
  console.log(JSON.stringify(items, null, 2))
}, 120_000)
