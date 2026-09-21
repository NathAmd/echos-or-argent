import type { AccountEntitlementPolicy } from "./accounts.js";
import { isUserId } from "./validation.js";

export interface ServerConfig {
  readonly accountEntitlementPolicy: AccountEntitlementPolicy;
  readonly accountSessionTtlMs: number;
  readonly accountStorePath: string;
  readonly allowLegacyCoopBootstrap: boolean;
  readonly allowLoopbackOrigins: boolean;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly authTokenHashes: ReadonlyMap<string, string>;
  readonly coopRendezvousStorePath: string;
  readonly coopRendezvousTtlMs: number;
  readonly friendStorePath: string;
  readonly host: string;
  readonly matchmakingAuthorizationTtlMs: number;
  readonly matchmakingQueueTtlMs: number;
  readonly lanDevelopmentMode: boolean;
  readonly objectStorePath: string;
  readonly port: number;
  readonly sharedSessionIdleTtlMs: number;
  readonly sharedSessionStorePath: string;
  readonly ticketTtlMs: number;
}

export type BrowserOriginPolicy = Pick<
  ServerConfig,
  "allowLoopbackOrigins" | "allowedOrigins" | "lanDevelopmentMode"
>;

const parseInteger = (
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
};

const parseBoolean = (name: string, value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
};

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

const isPrivateIpv4Hostname = (hostname: string): boolean => {
  const octets = hostname.split(".");
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) return false;
  const values = octets.map(Number);
  if (values.some((octet) => octet > 255)) return false;
  const [first = -1, second = -1] = values;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254);
};

const isPrivateIpv6Hostname = (hostname: string): boolean => {
  const unwrapped = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  return /^(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/i.test(unwrapped);
};

const isPrivateLanHostname = (hostname: string): boolean =>
  isPrivateIpv4Hostname(hostname) || isPrivateIpv6Hostname(hostname);

const isCanonicalMdnsHostname = (hostname: string): boolean =>
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$/.test(hostname);

const isCanonicalLoopbackOrigin = (candidate: string): boolean => {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  return (url.protocol === "http:" || url.protocol === "https:")
    && isLoopbackHostname(url.hostname)
    && url.origin === candidate;
};

const isCanonicalLanDevelopmentOrigin = (candidate: string): boolean => {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  const isPrivateAddress = isLoopbackHostname(url.hostname) || isPrivateLanHostname(url.hostname);
  const isAllowedNetworkOrigin = (
    (url.protocol === "http:" || url.protocol === "https:") && isPrivateAddress
  ) || (url.protocol === "https:" && isCanonicalMdnsHostname(url.hostname));
  return isAllowedNetworkOrigin && url.origin === candidate;
};

/**
 * Politique unique des requêtes HTTP, preflights et upgrades WebSocket.
 * L'option loopback accepte n'importe quel port, mais jamais une IP LAN, `null`
 * ou un sous-domaine ressemblant à localhost. Le mode LAN ajoute uniquement les
 * adresses privées canoniques ; il reste désactivé dans la configuration publique.
 */
export const isBrowserOriginAllowed = (policy: BrowserOriginPolicy, origin: string): boolean =>
  policy.allowedOrigins.has(origin)
  || (policy.allowLoopbackOrigins && isCanonicalLoopbackOrigin(origin))
  || (policy.lanDevelopmentMode && isCanonicalLanDevelopmentOrigin(origin));

const parseAllowedOrigins = (
  value: string | undefined,
  allowLoopbackOrigins: boolean,
  lanDevelopmentMode: boolean,
): ReadonlySet<string> => {
  if (value === undefined || value.trim() === "") {
    if (allowLoopbackOrigins || lanDevelopmentMode) return new Set();
    throw new Error(
      "ALLOWED_ORIGINS is required unless ALLOW_LOOPBACK_ORIGINS or LAN_DEVELOPMENT_MODE is true",
    );
  }
  const values = value.split(",").map((origin) => origin.trim());
  if (values.length > 20) {
    throw new Error("ALLOWED_ORIGINS accepts at most 20 origins");
  }
  const origins = new Set<string>();
  for (const candidate of values) {
    if (candidate === "*" || candidate.endsWith("/")) {
      throw new Error("ALLOWED_ORIGINS must contain exact origins without a trailing slash");
    }
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error(`Invalid allowed origin: ${candidate}`);
    }
    const isLocalHttp = url.protocol === "http:" && isLoopbackHostname(url.hostname);
    const isLanHttp = lanDevelopmentMode
      && url.protocol === "http:"
      && isPrivateLanHostname(url.hostname);
    if ((url.protocol !== "https:" && !isLocalHttp && !isLanHttp) || url.origin !== candidate) {
      throw new Error(`Allowed origin must be an exact HTTPS origin (or private HTTP in LAN mode): ${candidate}`);
    }
    origins.add(candidate);
  }
  return origins;
};

const parseTokenHashes = (value: string | undefined): ReadonlyMap<string, string> => {
  if (value === undefined || value.trim() === "") {
    return new Map();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("AUTH_TOKENS_JSON must be valid JSON");
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("AUTH_TOKENS_JSON must be an object mapping user IDs to SHA-256 hashes");
  }
  const entries = Object.entries(parsed);
  if (entries.length > 1_000) {
    throw new Error("AUTH_TOKENS_JSON must contain at most 1000 identities");
  }
  const hashes = new Map<string, string>();
  const uniqueHashes = new Set<string>();
  for (const [userId, hash] of entries) {
    if (!isUserId(userId)) {
      throw new Error(`Invalid user ID in AUTH_TOKENS_JSON: ${userId}`);
    }
    if (typeof hash !== "string" || !/^[a-fA-F0-9]{64}$/.test(hash)) {
      throw new Error(`Token hash for ${userId} must be a 64-character SHA-256 hex digest`);
    }
    const normalizedHash = hash.toLowerCase();
    if (uniqueHashes.has(normalizedHash)) {
      throw new Error("Every configured identity must have a distinct token hash");
    }
    uniqueHashes.add(normalizedHash);
    hashes.set(userId, normalizedHash);
  }
  return hashes;
};

const parseEntitlementPolicy = (value: string | undefined): AccountEntitlementPolicy => {
  const policy = value?.trim() || "open";
  if (policy !== "open" && policy !== "patreon") {
    throw new Error("ACCOUNT_ENTITLEMENT_POLICY must be open or patreon");
  }
  return policy;
};

export const loadServerConfig = (environment: NodeJS.ProcessEnv): ServerConfig => {
  const allowLoopbackOrigins = parseBoolean(
    "ALLOW_LOOPBACK_ORIGINS",
    environment.ALLOW_LOOPBACK_ORIGINS,
    false,
  );
  const lanDevelopmentMode = parseBoolean(
    "LAN_DEVELOPMENT_MODE",
    environment.LAN_DEVELOPMENT_MODE,
    false,
  );
  const allowLegacyCoopBootstrap = parseBoolean(
    "ALLOW_LEGACY_COOP_BOOTSTRAP",
    environment.ALLOW_LEGACY_COOP_BOOTSTRAP,
    false,
  );
  const allowedOrigins = parseAllowedOrigins(
    environment.ALLOWED_ORIGINS,
    allowLoopbackOrigins,
    lanDevelopmentMode,
  );
  const authTokenHashes = parseTokenHashes(environment.AUTH_TOKENS_JSON);
  return {
    accountEntitlementPolicy: parseEntitlementPolicy(environment.ACCOUNT_ENTITLEMENT_POLICY),
    accountSessionTtlMs: parseInteger(
      "ACCOUNT_SESSION_TTL_MS",
      environment.ACCOUNT_SESSION_TTL_MS,
      30 * 24 * 60 * 60 * 1_000,
      5 * 60 * 1_000,
      90 * 24 * 60 * 60 * 1_000,
    ),
    accountStorePath: environment.ACCOUNT_STORE_PATH?.trim() || "./data/accounts.json",
    allowLegacyCoopBootstrap,
    allowLoopbackOrigins,
    allowedOrigins,
    authTokenHashes,
    coopRendezvousStorePath: environment.COOP_RENDEZVOUS_STORE_PATH?.trim()
      || "./data/coop-rendezvous.json",
    coopRendezvousTtlMs: parseInteger(
      "COOP_RENDEZVOUS_TTL_MS",
      environment.COOP_RENDEZVOUS_TTL_MS,
      120_000,
      15_000,
      600_000,
    ),
    friendStorePath: environment.FRIEND_STORE_PATH?.trim() || "./data/friends.json",
    host: environment.HOST?.trim() || (lanDevelopmentMode ? "0.0.0.0" : "127.0.0.1"),
    lanDevelopmentMode,
    matchmakingAuthorizationTtlMs: parseInteger(
      "MATCHMAKING_AUTHORIZATION_TTL_MS",
      environment.MATCHMAKING_AUTHORIZATION_TTL_MS,
      120_000,
      15_000,
      300_000,
    ),
    matchmakingQueueTtlMs: parseInteger(
      "MATCHMAKING_QUEUE_TTL_MS",
      environment.MATCHMAKING_QUEUE_TTL_MS,
      120_000,
      10_000,
      600_000,
    ),
    objectStorePath: environment.OBJECT_STORE_PATH?.trim() || "./data/objects",
    port: parseInteger("PORT", environment.PORT, 8787, 1, 65_535),
    sharedSessionIdleTtlMs: parseInteger(
      "SHARED_SESSION_IDLE_TTL_MS",
      environment.SHARED_SESSION_IDLE_TTL_MS,
      24 * 60 * 60 * 1_000,
      60_000,
      7 * 24 * 60 * 60 * 1_000,
    ),
    sharedSessionStorePath: environment.SHARED_SESSION_STORE_PATH?.trim()
      || "./data/shared-sessions.json",
    ticketTtlMs: parseInteger("WS_TICKET_TTL_MS", environment.WS_TICKET_TTL_MS, 30_000, 5_000, 60_000),
  };
};
