import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256Token, TokenAuthenticator } from "../src/auth.js";
import { isBrowserOriginAllowed, loadServerConfig } from "../src/config.js";

describe("authentication and configuration", () => {
  it("authenticates an opaque Bearer token from its configured digest", () => {
    const authenticator = new TokenAuthenticator(new Map([["alice", sha256Token("long-random-token")]]));

    assert.equal(authenticator.authenticateAuthorizationHeader("Bearer long-random-token"), "alice");
    assert.equal(authenticator.authenticateAuthorizationHeader("Bearer wrong"), null);
    assert.equal(authenticator.authenticateAuthorizationHeader("bearer long-random-token"), null);
    assert.equal(authenticator.authenticateAuthorizationHeader("Bearer long-random-token extra"), null);
    assert.equal(authenticator.authenticateAuthorizationHeader(undefined), null);
  });

  it("requires an exact origin allow-list but supports an initially empty account store", () => {
    assert.throws(() => loadServerConfig({}), /ALLOWED_ORIGINS is required/);
    const accountsOnly = loadServerConfig({ ALLOWED_ORIGINS: "https://client.example" });
    assert.equal(accountsOnly.authTokenHashes.size, 0);
    assert.equal(accountsOnly.accountStorePath, "./data/accounts.json");
    assert.equal(accountsOnly.allowLegacyCoopBootstrap, false);
    assert.equal(accountsOnly.coopRendezvousStorePath, "./data/coop-rendezvous.json");
    assert.equal(accountsOnly.coopRendezvousTtlMs, 120_000);
    assert.equal(accountsOnly.sharedSessionStorePath, "./data/shared-sessions.json");
    assert.equal(accountsOnly.accountEntitlementPolicy, "open");
    assert.equal(accountsOnly.allowLoopbackOrigins, false);
    assert.equal(accountsOnly.lanDevelopmentMode, false);
    assert.throws(
      () =>
        loadServerConfig({
          ALLOWED_ORIGINS: "*",
          AUTH_TOKENS_JSON: JSON.stringify({ alice: sha256Token("token") }),
        }),
      /exact origins/,
    );
  });

  it("loads a bounded valid production configuration", () => {
    const config = loadServerConfig({
      ACCOUNT_ENTITLEMENT_POLICY: "patreon",
      ACCOUNT_SESSION_TTL_MS: "86400000",
      ACCOUNT_STORE_PATH: "/tmp/accounts.json",
      ALLOWED_ORIGINS: "https://client.example,http://localhost:5173",
      AUTH_TOKENS_JSON: JSON.stringify({
        alice: sha256Token("alice-token"),
        bob: sha256Token("bob-token"),
      }),
      ALLOW_LEGACY_COOP_BOOTSTRAP: "true",
      COOP_RENDEZVOUS_STORE_PATH: "/tmp/coop-rendezvous.json",
      COOP_RENDEZVOUS_TTL_MS: "150000",
      FRIEND_STORE_PATH: "/tmp/social-state.json",
      HOST: "0.0.0.0",
      MATCHMAKING_AUTHORIZATION_TTL_MS: "90000",
      MATCHMAKING_QUEUE_TTL_MS: "180000",
      OBJECT_STORE_PATH: "/tmp/opaque-objects",
      PORT: "9000",
      SHARED_SESSION_IDLE_TTL_MS: "3600000",
      SHARED_SESSION_STORE_PATH: "/tmp/shared-sessions.json",
      WS_TICKET_TTL_MS: "12000",
    });

    assert.equal(config.port, 9000);
    assert.equal(config.accountEntitlementPolicy, "patreon");
    assert.equal(config.accountSessionTtlMs, 86_400_000);
    assert.equal(config.accountStorePath, "/tmp/accounts.json");
    assert.equal(config.allowLegacyCoopBootstrap, true);
    assert.equal(config.coopRendezvousStorePath, "/tmp/coop-rendezvous.json");
    assert.equal(config.coopRendezvousTtlMs, 150_000);
    assert.equal(config.host, "0.0.0.0");
    assert.equal(config.objectStorePath, "/tmp/opaque-objects");
    assert.equal(config.matchmakingAuthorizationTtlMs, 90_000);
    assert.equal(config.matchmakingQueueTtlMs, 180_000);
    assert.equal(config.sharedSessionIdleTtlMs, 3_600_000);
    assert.equal(config.sharedSessionStorePath, "/tmp/shared-sessions.json");
    assert.equal(config.ticketTtlMs, 12_000);
    assert.equal(config.authTokenHashes.size, 2);
    assert.deepEqual([...config.allowedOrigins], ["https://client.example", "http://localhost:5173"]);
  });

  it("allows canonical loopback browser origins on every port only when explicitly enabled", () => {
    const config = loadServerConfig({ ALLOW_LOOPBACK_ORIGINS: "true" });

    assert.equal(config.allowLoopbackOrigins, true);
    assert.deepEqual([...config.allowedOrigins], []);
    for (const origin of [
      "http://localhost:5173",
      "http://localhost:4173",
      "https://localhost:8443",
      "http://127.0.0.1:5174",
      "http://[::1]:5175",
    ]) {
      assert.equal(isBrowserOriginAllowed(config, origin), true, origin);
    }
    for (const origin of [
      "null",
      "file://",
      "http://localhost.example:5173",
      "http://127.0.0.2:5173",
      "http://192.168.1.20:5173",
      "http://[::2]:5173",
      "http://localhost:5173/path",
    ]) {
      assert.equal(isBrowserOriginAllowed(config, origin), false, origin);
    }
  });

  it("validates the dedicated loopback-origin switch strictly", () => {
    assert.throws(
      () => loadServerConfig({ ALLOW_LOOPBACK_ORIGINS: "1" }),
      /ALLOW_LOOPBACK_ORIGINS must be true or false/,
    );
    const explicitIpv6 = loadServerConfig({
      ALLOWED_ORIGINS: "http://[::1]:5173",
      ALLOW_LOOPBACK_ORIGINS: "false",
    });
    assert.equal(isBrowserOriginAllowed(explicitIpv6, "http://[::1]:5173"), true);
    assert.equal(isBrowserOriginAllowed(explicitIpv6, "http://[::1]:5174"), false);
  });

  it("exposes HTTP on private LAN addresses only through the explicit development mode", () => {
    const config = loadServerConfig({ LAN_DEVELOPMENT_MODE: "true" });

    assert.equal(config.lanDevelopmentMode, true);
    assert.equal(config.allowLegacyCoopBootstrap, false);
    assert.equal(config.host, "0.0.0.0");
    assert.deepEqual([...config.allowedOrigins], []);
    for (const origin of [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://10.0.0.8:5173",
      "http://172.16.0.8:4173",
      "http://172.31.255.254:5173",
      "http://192.168.1.42:5173",
      "http://169.254.12.4:5173",
      "http://[fd12:3456::8]:5173",
      "http://[fe80::8]:5173",
      "https://192.168.1.42:5173",
      "https://pokemaster-studio.local:5174",
    ]) {
      assert.equal(isBrowserOriginAllowed(config, origin), true, origin);
    }
    for (const origin of [
      "http://172.32.0.8:5173",
      "http://8.8.8.8:5173",
      "http://console.example:5173",
      "http://pokemaster-studio.local:5174",
      "https://nested.pokemaster.local:5174",
      "https://pokemaster.local.example:5174",
      "null",
      "http://192.168.1.42:5173/path",
    ]) {
      assert.equal(isBrowserOriginAllowed(config, origin), false, origin);
    }
  });

  it("keeps private HTTP origins forbidden outside LAN mode", () => {
    assert.throws(
      () => loadServerConfig({ ALLOWED_ORIGINS: "http://192.168.1.42:5173" }),
      /private HTTP in LAN mode/,
    );
    const production = loadServerConfig({ ALLOWED_ORIGINS: "https://client.example" });
    assert.equal(isBrowserOriginAllowed(production, "http://192.168.1.42:5173"), false);

    const explicitLan = loadServerConfig({
      ALLOW_LEGACY_COOP_BOOTSTRAP: "false",
      ALLOWED_ORIGINS: "http://192.168.1.42:5173",
      HOST: "192.168.1.10",
      LAN_DEVELOPMENT_MODE: "true",
    });
    assert.equal(explicitLan.host, "192.168.1.10");
    assert.equal(explicitLan.allowLegacyCoopBootstrap, false);
    assert.equal(isBrowserOriginAllowed(explicitLan, "http://192.168.1.42:5173"), true);
  });

  it("validates the LAN development switch strictly", () => {
    assert.throws(
      () => loadServerConfig({ LAN_DEVELOPMENT_MODE: "1" }),
      /LAN_DEVELOPMENT_MODE must be true or false/,
    );
    assert.throws(
      () => loadServerConfig({
        ALLOWED_ORIGINS: "https://client.example",
        ALLOW_LEGACY_COOP_BOOTSTRAP: "1",
      }),
      /ALLOW_LEGACY_COOP_BOOTSTRAP must be true or false/,
    );
  });

  it("validates account policy, session lifetime and optional legacy token compatibility", () => {
    assert.throws(
      () => loadServerConfig({
        ACCOUNT_ENTITLEMENT_POLICY: "unknown",
        ALLOWED_ORIGINS: "https://client.example",
      }),
      /must be open or patreon/,
    );
    assert.throws(
      () => loadServerConfig({
        ACCOUNT_SESSION_TTL_MS: "1000",
        ALLOWED_ORIGINS: "https://client.example",
      }),
      /must be between/,
    );
    const config = loadServerConfig({
      ALLOWED_ORIGINS: "https://client.example",
      AUTH_TOKENS_JSON: JSON.stringify({ alice: sha256Token("migration-token") }),
    });
    assert.equal(config.authTokenHashes.size, 1);
    assert.throws(
      () => loadServerConfig({
        ALLOWED_ORIGINS: "https://client.example",
        SHARED_SESSION_IDLE_TTL_MS: "1000",
      }),
      /SHARED_SESSION_IDLE_TTL_MS must be between/,
    );
    assert.throws(
      () => loadServerConfig({
        ALLOWED_ORIGINS: "https://client.example",
        COOP_RENDEZVOUS_TTL_MS: "1000",
      }),
      /COOP_RENDEZVOUS_TTL_MS must be between/,
    );
  });
});
