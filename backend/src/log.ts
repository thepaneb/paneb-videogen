// Log estruturado (uma linha JSON por evento). Nunca registre chaves, tokens nem a query string (contém `sig`).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

function emit(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const min = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;
  if (LEVELS[level] < min) return;
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + "\n");
}
export const log = {
  debug: (m: string, f?: Record<string, unknown>) => emit("debug", m, f),
  info: (m: string, f?: Record<string, unknown>) => emit("info", m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit("warn", m, f),
  error: (m: string, f?: Record<string, unknown>) => emit("error", m, f),
};
