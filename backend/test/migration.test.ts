import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("migração: banco v1 (sem user_id) vira v2 preservando dados", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "videogen-mig-"));
  const old = new DatabaseSync(path.join(dir, "videogen.db"));
  old.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_job_id TEXT NOT NULL,
    status TEXT NOT NULL, params TEXT NOT NULL, output TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
    idem_key TEXT UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  old.prepare("INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run("old1", "mock", "p", "succeeded", '{"prompt":"antigo"}', null, null, 0, "k-old", 1, 2);
  old.close();
  const out = execFileSync(process.execPath, ["--import", "tsx", path.join(process.cwd(), "test/helpers/migrate-check.ts"), dir],
    { encoding: "utf8", cwd: process.cwd() });
  const r = JSON.parse(out.trim().split("\n").pop()!);
  assert.equal(r.job.userId, "default");
  assert.equal(r.job.params.prompt, "antigo");
  assert.equal(r.byIdem, "old1");
  assert.equal(r.job.locked, false); // migração v4: destravado por padrão
});
