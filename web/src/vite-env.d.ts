/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly POKEMASTER_PUBLIC_BASE_PATH?: string
  readonly POKEMASTER_PUBLIC_LAN_DEVELOPMENT_MODE?: string
  readonly POKEMASTER_PUBLIC_ONLINE_SERVER_IDENTITY_URL?: string
  readonly POKEMASTER_PUBLIC_ONLINE_SERVER_URL?: string
  readonly POKEMASTER_PUBLIC_RTC_ICE_SERVERS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
