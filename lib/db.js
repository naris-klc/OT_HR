/**
 * Mongoose connection for Next.js.
 *
 * Next reloads modules on every edit in dev, and each reload would open a fresh
 * pool until Mongo refuses new connections. Caching the promise on globalThis is
 * the standard way out — the cache survives module reloads because the global
 * object does.
 */
import mongoose from 'mongoose';

/**
 * Registering every model here, for the side effect, is load-bearing.
 *
 * Express registered all five because server.js pulled in every router. Each
 * Next route is bundled on its own, so a route that imports only Employee would
 * leave Department unregistered and `.populate('department')` would throw
 * MissingSchemaError. Importing them at the connection point means any route
 * that can reach the database can also populate across it.
 */
import '@/src/models/Department.js';
import '@/src/models/Employee.js';
import '@/src/models/Holiday.js';
import '@/src/models/OtEntry.js';
import '@/src/models/Setting.js';

const globalForMongoose = globalThis;
globalForMongoose._otMongoose ??= { conn: null, promise: null };
const cached = globalForMongoose._otMongoose;

export async function connect(uri = process.env.MONGODB_URI) {
  if (cached.conn) return cached.conn;
  if (!uri) throw new Error('MONGODB_URI is not set. Copy .env.example to .env.');

  if (!cached.promise) {
    mongoose.set('strictQuery', true);
    cached.promise = mongoose
      .connect(uri, { serverSelectionTimeoutMS: 8000 })
      .then((m) => m.connection);
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    // Let the next request retry instead of caching a rejected promise forever.
    cached.promise = null;
    throw err;
  }
  return cached.conn;
}

export async function disconnect() {
  await mongoose.disconnect();
  cached.conn = null;
  cached.promise = null;
}
