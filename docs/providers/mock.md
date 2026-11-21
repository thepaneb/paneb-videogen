# Provedor `mock`

Simula um provedor para desenvolver e testar sem custo: `queued` (~4 s) → `running` (~11 s) → `succeeded`, devolvendo
um vídeo de exemplo público. Suporta cancelamento (só marca como cancelado, sem custo). Se o servidor reiniciar
durante um job, ele falha ("job desconhecido") — o `mock` guarda o estado em memória, diferente dos provedores
reais cujo id basta para retomar o `poll`.

```bash
PROVIDER=mock APP_KEY=dev npm run dev
```

Se o download do vídeo de exemplo falhar (sem internet), o job ainda conclui e usa a URL remota — comportamento
intencional do worker. Todos os testes automáticos usam este provedor ou respostas simuladas.
