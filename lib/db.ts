import "server-only";

import postgres from "postgres";

declare global {
  var __myscrobblerSql: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  const connectionString = process.env.WEB_DB_URI ??
    (process.env.NODE_ENV === "development" ? process.env.DB_URI : undefined);

  if (!connectionString) {
    throw new Error("WEB_DB_URI must be configured for the production web application");
  }

  return postgres(connectionString, {
    ssl: "require",
    prepare: false,
    // A single slow page must not hold every other route behind it. Four
    // connections is still deliberately small for Supabase's transaction
    // pooler, while allowing navigation and health checks to proceed.
    max: 4,
    connect_timeout: 10,
    // Keep the Tokyo TLS connection warm during normal personal use. Opening a
    // fresh Supavisor connection from Istanbul costs several seconds.
    idle_timeout: 300,
    keep_alive: 60,
    max_lifetime: 60 * 10,
    connection: {
      application_name: "myscrobbler-web",
      statement_timeout: 15_000,
      lock_timeout: 3_000,
      idle_in_transaction_session_timeout: 15_000,
    },
  });
}

// Route imports are evaluated during builds, before deployment secrets exist.
// Resolve the client only when a query or transaction is actually requested.
function getClient() {
  return globalThis.__myscrobblerSql ??= createClient();
}
export const sql = new Proxy(function () {}, {
  apply(_target, thisArg, args) {
    return Reflect.apply(getClient(), thisArg, args);
  },
  get(_target, property) {
    const client = getClient();
    const value = Reflect.get(client, property);
    return typeof value === "function" ? value.bind(client) : value;
  },
}) as unknown as ReturnType<typeof postgres>;
