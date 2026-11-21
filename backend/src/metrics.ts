// Métricas no formato de texto do Prometheus, sem dependências.
type Labels = Record<string, string>;
const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
const fmt = (l: Labels, extra = "") => {
  const parts = Object.keys(l).map((k) => `${k}="${esc(l[k])}"`);
  if (extra) parts.push(extra);
  return parts.length ? `{${parts.join(",")}}` : "";
};

export class Counter {
  private v = new Map<string, { labels: Labels; n: number }>();
  constructor(readonly name: string, readonly help: string) {}
  inc(labels: Labels = {}, n = 1) {
    const k = JSON.stringify(labels), e = this.v.get(k);
    e ? (e.n += n) : this.v.set(k, { labels, n });
  }
  render() {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, n } of this.v.values()) out.push(`${this.name}${fmt(labels)} ${n}`);
    return out.join("\n");
  }
}

export class Histogram {
  private v = new Map<string, { labels: Labels; counts: number[]; sum: number; count: number }>();
  constructor(readonly name: string, readonly help: string, readonly buckets: number[]) {}
  observe(labels: Labels, value: number) {
    const k = JSON.stringify(labels);
    let e = this.v.get(k);
    if (!e) this.v.set(k, (e = { labels, counts: this.buckets.map(() => 0), sum: 0, count: 0 }));
    this.buckets.forEach((b, i) => { if (value <= b) e!.counts[i]++; });
    e.sum += value; e.count++;
  }
  render() {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const { labels, counts, sum, count } of this.v.values()) {
      this.buckets.forEach((b, i) => out.push(`${this.name}_bucket${fmt(labels, `le="${b}"`)} ${counts[i]}`));
      out.push(`${this.name}_bucket${fmt(labels, 'le="+Inf"')} ${count}`);
      out.push(`${this.name}_sum${fmt(labels)} ${sum}`, `${this.name}_count${fmt(labels)} ${count}`);
    }
    return out.join("\n");
  }
}

export const jobsCreated = new Counter("videogen_jobs_created_total", "Jobs criados, por provedor");
export const jobsFinished = new Counter("videogen_jobs_finished_total", "Jobs que chegaram a um estado terminal");
export const jobSeconds = new Histogram("videogen_job_duration_seconds", "Do pedido ao estado terminal, em segundos",
  [10, 30, 60, 120, 300, 600, 900]);
export const providerErrors = new Counter("videogen_provider_errors_total", "Erros ao falar com o provedor (submit/poll)");
export const httpRequests = new Counter("videogen_http_requests_total", "Requisições HTTP, por rota (padrão) e status");
export const enhanceTotal = new Counter("videogen_prompt_enhance_total", "Pedidos de aprimoramento de prompt, por resultado");

export function recordFinish(provider: string, status: string, createdAt: number) {
  jobsFinished.inc({ provider, status });
  jobSeconds.observe({ provider }, (Date.now() - createdAt) / 1000);
}

export function render(active: Record<string, number>): string {
  const gauge = [
    "# HELP videogen_jobs_active Jobs em andamento", "# TYPE videogen_jobs_active gauge",
    ...Object.entries(active).map(([s, n]) => `videogen_jobs_active${fmt({ status: s })} ${n}`),
    "# HELP process_uptime_seconds Tempo de execução do processo", "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${Math.round(process.uptime())}`,
    "# HELP process_resident_memory_bytes Memória residente", "# TYPE process_resident_memory_bytes gauge",
    `process_resident_memory_bytes ${process.memoryUsage().rss}`,
  ].join("\n");
  return [jobsCreated, jobsFinished, jobSeconds, providerErrors, httpRequests, enhanceTotal]
    .map((m) => m.render()).join("\n") + "\n" + gauge + "\n";
}
