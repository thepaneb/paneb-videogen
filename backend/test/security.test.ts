import test from "node:test";
import assert from "node:assert/strict";
import { loadUsers, userFor } from "../src/auth.js";
import { signFile, verifyFile } from "../src/signing.js";

test("auth: APP_KEYS e APP_KEY; chave errada ou ausente não autentica", () => {
  const u = loadUsers({ APP_KEYS: "alice:k1, bob:k:com:dois-pontos", APP_KEY: "legacy" } as any);
  assert.equal(userFor(u, "k1"), "alice");
  assert.equal(userFor(u, "k:com:dois-pontos"), "bob");
  assert.equal(userFor(u, "legacy"), "default");
  assert.equal(userFor(u, "nope"), undefined);
  assert.equal(userFor(u, undefined), undefined);
  assert.equal(loadUsers({} as any).size, 0); // sem chaves configuradas ninguém entra
  assert.throws(() => loadUsers({ APP_KEYS: "semdoispontos" } as any));
});

test("signing: aceita link válido; recusa expirado, adulterado e outro arquivo", () => {
  const now = 1_800_000_000_000;
  const url = new URL("http://x" + signFile("a.mp4", "segredo", 60_000, now));
  const [exp, sig] = [url.searchParams.get("exp")!, url.searchParams.get("sig")!];
  assert.equal(verifyFile("a.mp4", exp, sig, "segredo", now + 1000), true);
  assert.equal(verifyFile("a.mp4", exp, sig, "segredo", now + 61_000), false); // expirou
  assert.equal(verifyFile("b.mp4", exp, sig, "segredo", now + 1000), false);   // outro arquivo
  assert.equal(verifyFile("a.mp4", exp, sig, "outro", now + 1000), false);     // outro segredo
  assert.equal(verifyFile("a.mp4", String(Number(exp) + 999), sig, "segredo", now + 1000), false);
  assert.equal(verifyFile("a.mp4", exp, "zz", "segredo", now + 1000), false);
});
