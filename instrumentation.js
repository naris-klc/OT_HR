/**
 * The boot-time check src/server.js has always had, for the server that
 * replaced it. The check itself is in ./instrumentation-node.js — this file is
 * only the door it comes through.
 *
 * WHY THE SPLIT. Next calls `register` in every runtime it has, and compiles
 * this file for every one of them, so a `process.exit` sitting here is a
 * Node-only API in an Edge bundle. It compiled and it ran — but Turbopack
 * warned about it on every rebuild, in a block ending "Ecmascript file had an
 * error", which is a frightening thing to print several times a minute about a
 * server that is working perfectly. Loading the Node half behind
 * `NEXT_RUNTIME` is the pattern the Next docs give for exactly this
 * (`node_modules/next/dist/docs/01-app/02-guides/instrumentation.md`,
 * "Importing runtime-specific code").
 *
 * There is deliberately no edge branch. Neither MONGODB_URI nor JWT_SECRET is
 * read from the edge runtime, and checking there would fail a request path
 * that was never going to use them.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node.js');
  }
}
