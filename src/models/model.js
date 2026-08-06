import mongoose from 'mongoose';

/**
 * Register a model — and in dev, re-register it when its schema has changed.
 *
 * Next re-executes these modules on every dev reload, so a bare
 * `mongoose.model()` throws OverwriteModelError the second time. Guarding it
 * with `mongoose.models.X ||` stops the throw but buys a worse bug:
 * `mongoose.models` outlives the reload, so the FIRST schema compiled in that
 * session keeps being used and every later edit to it is silently ignored
 * until the server is restarted. The symptom is an error naming a value the
 * schema on disk plainly allows —
 * "`hr_edit` is not a valid enum value for path `action`".
 *
 * Dropping the stale model makes a schema edit take effect on the next
 * request, like every other edit in dev. In production the module is evaluated
 * once and the branch never runs.
 */
export function model(name, schema) {
  if (mongoose.models[name]) {
    if (process.env.NODE_ENV === 'production') return mongoose.models[name];
    mongoose.deleteModel(name);
  }
  return mongoose.model(name, schema);
}
