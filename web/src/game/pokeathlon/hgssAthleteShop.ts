export type HgssAthleteShopItem = {
  itemId: number
  price: number
}

// scrcmd_mart.c::_0210FA04. Date#getDay() uses the same Sunday-first order as
// RTCDate.week in HGSS.
const preNationalDexShops: readonly (readonly HgssAthleteShopItem[])[] = [
  [[485, 200], [487, 200], [491, 200], [33, 100], [221, 3000], [93, 1000]],
  [[485, 200], [487, 200], [488, 200], [33, 100], [81, 3000], [50, 2000]],
  [[486, 200], [489, 200], [490, 200], [33, 100], [82, 2500], [51, 1000]],
  [[487, 200], [489, 200], [491, 200], [33, 100], [84, 2500], [93, 1000]],
  [[486, 200], [489, 200], [490, 200], [33, 100], [83, 2500], [51, 1000]],
  [[485, 200], [486, 200], [488, 200], [33, 100], [233, 2500], [92, 500]],
  [[488, 200], [490, 200], [491, 200], [33, 100], [85, 2500], [50, 2000]],
].map((shop) => shop.map(([itemId, price]) => ({ itemId, price })))

const postNationalDexExtras: readonly (readonly HgssAthleteShopItem[])[] = [
  [[23, 500], [92, 500], [80, 3000], [82, 2500], [107, 3000], [109, 3000]],
  [[23, 500], [221, 3000], [80, 3000], [84, 2500], [107, 3000], [108, 3000]],
  [[23, 500], [233, 2500], [84, 2500], [85, 2500], [108, 3000], [109, 3000]],
  [[23, 500], [235, 2500], [83, 2500], [81, 3000], [107, 3000], [109, 3000]],
  [[23, 500], [221, 3000], [82, 2500], [85, 2500], [107, 3000], [108, 3000]],
  [[23, 500], [235, 2500], [84, 2500], [80, 3000], [108, 3000], [109, 3000]],
  [[23, 500], [233, 2500], [83, 2500], [107, 3000], [108, 3000], [109, 3000]],
].map((shop) => shop.map(([itemId, price]) => ({ itemId, price })))

export function getHgssAthleteShop(dayOfWeek: number, nationalDexEnabled: boolean): readonly HgssAthleteShopItem[] {
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new Error(`Jour de boutique Athlète HGSS ${dayOfWeek} invalide.`)
  }
  const base = preNationalDexShops[dayOfWeek]!
  return nationalDexEnabled ? [...base, ...postNationalDexExtras[dayOfWeek]!] : [...base]
}
