import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { Job, Output, Status } from "./model.js";

export const DATA_DIR = process.env.DATA_DIR ?? "data";
export const FILES_DIR = path.join(DATA_DIR, "videos");
fs.mkdirSync(FILES_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "videogen.db"));

// Migrações versionadas (PRAGMA user_version). Nunca edite uma antiga: acrescente uma nova.
const MIGRATIONS: { version: number; sql: string }[] = [
  { version: 1, sql: `
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_job_id TEXT NOT NULL,
      status TEXT NOT NULL, params TEXT NOT NULL, output TEXT, error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, idem_key TEXT UNIQUE,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX jobs_status ON jobs(status);
    CREATE INDEX jobs_created ON jobs(created_at);` },
  { version: 2, sql: `
    CREATE TABLE jobs_new (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'default',
      provider TEXT NOT NULL, provider_job_id TEXT NOT NULL,
      status TEXT NOT NULL, params TEXT NOT NULL, output TEXT, error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, idem_key TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (user_id, idem_key)
    );
    INSERT INTO jobs_new (id, user_id, provider, provider_job_id, status, params, output, error, attempts, idem_key, created_at, updated_at)
      SELECT id, 'default', provider, provider_job_id, status, params, output, error, attempts, idem_key, created_at, updated_at FROM jobs;
    DROP TABLE jobs;
    ALTER TABLE jobs_new RENAME TO jobs;
    CREATE INDEX jobs_status ON jobs(status);
    CREATE INDEX jobs_user_created ON jobs(user_id, created_at);` },
  { version: 3, sql: `
    CREATE TABLE push_tokens (
      user_id TEXT NOT NULL, token TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, token)
    );` },
];

function migrate() {
  let cur = Number((db.prepare("PRAGMA user_version").get() as any).user_version);
  const hasJobs = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'").get();
  if (cur === 0 && hasJobs) cur = 1; // banco criado antes do versionamento
  for (const m of MIGRATIONS.filter((x) => x.version > cur)) {
    db.exec("BEGIN");
    try { db.exec(m.sql); db.exec(`PRAGMA user_version = ${m.version}`); db.exec("COMMIT"); }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  }
}
migrate();

const toJob = (r: any): Job => ({
  id: r.id, userId: r.user_id, provider: r.provider, providerJobId: r.provider_job_id, status: r.status,
  params: JSON.parse(r.params), output: r.output ? JSON.parse(r.output) : undefined,
  error: r.error ?? undefined, attempts: r.attempts, idemKey: r.idem_key ?? undefined,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export function insertJob(j: Job) {
  db.prepare(`INSERT INTO jobs (id,user_id,provider,provider_job_id,status,params,attempts,idem_key,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(j.id, j.userId, j.provider, j.providerJobId, j.status, JSON.stringify(j.params), 0, j.idemKey ?? null, j.createdAt, j.updatedAt);
}
export const getJob = (id: string) => { const r = db.prepare("SELECT * FROM jobs WHERE id=?").get(id); return r ? toJob(r) : undefined; };
export const getJobFor = (userId: string, id: string) => {
  const r = db.prepare("SELECT * FROM jobs WHERE id=? AND user_id=?").get(id, userId); return r ? toJob(r) : undefined;
};
export const getByIdem = (userId: string, k: string) => {
  const r = db.prepare("SELECT * FROM jobs WHERE user_id=? AND idem_key=?").get(userId, k); return r ? toJob(r) : undefined;
};
export const listJobs = (userId: string, limit: number, before: number) =>
  db.prepare("SELECT * FROM jobs WHERE user_id=? AND created_at<? ORDER BY created_at DESC, id DESC LIMIT ?").all(userId, before, limit).map(toJob);
export const listActive = () =>
  db.prepare("SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at").all().map(toJob);
/** Mediana (ms) de conclusão dos jobs de um provedor (mesma duração primeiro); null sem histórico. */
export function medianSucceededMs(provider: string, durationSec: number): number | null {
  const pick = (where: string, ...args: (string | number)[]) => {
    const rows = db.prepare(
      `SELECT updated_at - created_at AS ms FROM jobs WHERE provider = ? AND status = 'succeeded' AND ${where} ORDER BY updated_at DESC LIMIT 20`
    ).all(provider, ...args) as { ms: number }[];
    if (!rows.length) return null;
    const v = rows.map((r) => r.ms).sort((a, b) => a - b);
    return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  };
  return pick("json_extract(params, '$.durationSec') = ?", durationSec) ?? pick("1 = 1");
}
export const countSince = (userId: string, t: number) =>
  Number((db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE user_id=? AND created_at>=?").get(userId, t) as any).n);
export const deleteJob = (id: string) => { db.prepare("DELETE FROM jobs WHERE id=?").run(id); };
export const deleteJobFor = (userId: string, id: string) => { db.prepare("DELETE FROM jobs WHERE id=? AND user_id=?").run(id, userId); };
// Tokens de push (FCM) por usuário. INSERT OR IGNORE: registrar de novo é idempotente.
export const addPushToken = (userId: string, token: string) =>
  db.prepare("INSERT OR IGNORE INTO push_tokens (user_id, token, created_at) VALUES (?,?,?)").run(userId, token, Date.now());
export const removePushToken = (userId: string, token: string) =>
  db.prepare("DELETE FROM push_tokens WHERE user_id=? AND token=?").run(userId, token);
export const removePushTokenEverywhere = (token: string) =>
  db.prepare("DELETE FROM push_tokens WHERE token=?").run(token);
export const listPushTokens = (userId: string): string[] =>
  (db.prepare("SELECT token FROM push_tokens WHERE user_id=?").all(userId) as any[]).map((r) => r.token);

export function updateJob(id: string, p: { status?: Status; output?: Output; error?: string; attempts?: number }) {
  const cur = getJob(id)!;
  const n = { ...cur, ...p };
  if (p.status && p.status !== cur.status && p.error === undefined) n.error = undefined; // troca de estado limpa erro obsoleto
  db.prepare("UPDATE jobs SET status=?, output=?, error=?, attempts=?, updated_at=? WHERE id=?")
    .run(n.status, n.output ? JSON.stringify(n.output) : null, n.error ?? null, n.attempts, Date.now(), id);
}
export const countActive = () => {
  const out: Record<string, number> = { queued: 0, running: 0 };
  for (const r of db.prepare("SELECT status, COUNT(*) AS n FROM jobs WHERE status IN ('queued','running') GROUP BY status").all() as any[])
    out[r.status] = Number(r.n);
  return out;
};
export const closeDb = () => db.close();
