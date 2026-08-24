/**
 * A scratchpad that lives exactly as long as one request.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A PARAMETER
 *
 * บันทึกระบบ has to name the person on every row, and the only place that
 * knows who they are is `requireAuth`, seven stack frames inside a handler that
 * `route()` called. Threading an argument back out would mean changing the
 * signature of `requireAuth`, of every one of the fifty-odd handlers that call
 * it, and of the several helpers that call it on their behalf — and the failure
 * mode of forgetting one of them is a log row with no name on it, which is
 * indistinguishable from a request that genuinely had no session.
 *
 * `AsyncLocalStorage` is the Node facility for exactly this: a store attached
 * to the async execution of one request, readable from anywhere inside it and
 * from nowhere outside. Node-only, which is fine — every route in this app runs
 * in the Node runtime, and the file that would not be able to use it (a
 * `proxy.js` on the edge) does not exist.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS ONLY EVER WRITTEN TO, NEVER READ BY THE APP
 *
 * Nothing in this system behaves differently because of what is in here. It is
 * a place for a request to leave notes for the logger that runs after it, and
 * `route()` is the only reader. A store that decisions were made from would be
 * a second, invisible way to pass arguments; this one cannot become that,
 * because the only consumer writes a log row and returns nothing.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/** Run one request with a fresh scratchpad. Called by `route()` and nowhere else. */
export function withRequestNotes(fn) {
  return storage.run({ actor: null, event: null, attemptedCode: null }, fn);
}

/** The notes for the request in flight, or null outside one. */
export const requestNotes = () => storage.getStore() || null;

/**
 * Remember who this request turned out to be.
 *
 * Called by `requireAuth` once the token has been verified AND the account
 * checked — so a valid token belonging to a deactivated account never names
 * anybody here, because that request was refused. The fields are copied rather
 * than the document being held: the log stores denormalised strings (see
 * src/models/AccessLog.js), and keeping a mongoose document alive past the
 * response for the sake of a name is a memory leak with a nicer name.
 */
export function noteActor(user) {
  const notes = requestNotes();
  if (!notes || !user) return;
  notes.actor = {
    id: user._id,
    code: user.code || null,
    name: user.name || null,
    role: user.role || null,
  };
}

/**
 * Say what this request WAS, when the status code cannot.
 *
 * Only the two auth routes call it. `POST /api/auth/login` answering 401 is a
 * wrong password; every other 401 in the app is an expired session, and one
 * word in a log that conflates them is worth more than any amount of filtering
 * afterwards.
 *
 * `attemptedCode` is the employee code as typed, and it is the only value from
 * any request body that this system writes to a log. See the field's comment on
 * the model for why a failed login is useless without it — and note there is no
 * parameter here, on the model, or anywhere downstream that could carry a
 * password even if somebody passed one.
 */
export function noteAuthEvent(event, { attemptedCode = null } = {}) {
  const notes = requestNotes();
  if (!notes) return;
  notes.event = event;
  if (attemptedCode != null) notes.attemptedCode = String(attemptedCode).slice(0, 40);
}
