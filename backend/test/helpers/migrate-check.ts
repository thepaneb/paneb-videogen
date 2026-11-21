// Executado em processo separado: abre um banco antigo (v1) e imprime o resultado da migração.
process.env.DATA_DIR = process.argv[2];
(async () => {
  const db = await import("../../src/db.js");
  console.log(JSON.stringify({ job: db.getJob("old1"), byIdem: db.getByIdem("default", "k-old")?.id }));
})();
