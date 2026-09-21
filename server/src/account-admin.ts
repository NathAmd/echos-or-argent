import { normalizeUsername } from "./accounts.js";
import { FileAccountStore } from "./persistence/account-store.js";

const [command, rawUsername, confirmation] = process.argv.slice(2);

if (command !== "promote" || confirmation !== "--confirm-server-stopped") {
  console.error(
    "Usage: npm run account:admin -- promote <username> --confirm-server-stopped",
  );
  process.exitCode = 2;
} else {
  const username = normalizeUsername(rawUsername);
  if (username === null) {
    console.error("Invalid canonical account username");
    process.exitCode = 2;
  } else {
    const path = process.env.ACCOUNT_STORE_PATH?.trim() || "./data/accounts.json";
    const store = new FileAccountStore(path);
    const state = await store.load();
    let found = false;
    const accounts = state.accounts.map((account) => {
      if (account.id !== username) return account;
      found = true;
      return { ...account, role: "admin" as const };
    });
    if (!found) {
      console.error(`Account ${username} does not exist`);
      process.exitCode = 1;
    } else {
      await store.save({ ...state, accounts });
      console.log(JSON.stringify({ id: username, role: "admin" }));
    }
  }
}
