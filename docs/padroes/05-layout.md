# Guia de layout (telas do app)

## Mapa das telas (abas na `NavigationBar`)

| Aba | Conteúdo (de cima para baixo) |
|---|---|
| **Criar** | (se ajustando: faixa "Ajustando job anterior" + Cancelar) → prompt → [Melhorar prompt] → "o que evitar" → imagem → duração → proporção → qualidade → [Ajustes finos (expansível): expandir prompt, força da imagem, CFG, passos] → botão Gerar |
| **Histórico** | Cards por job: prompt (2 linhas) → `status · provedor · dd/mm hh:mm` → parâmetros (`3s · 9:16 · Padrão · seed …`) → progresso/ETA ou erro → ações por ícone |
| **Ajustes** | URL base → chave da API → Salvar e reconectar → cartão de conexão (semáforo + latência + causa de falha + Testar) |

## Componentes e quando usar

- **Chips** (`FilterChip`): escolhas fechadas vindas do servidor (duração, proporção, qualidade, passos). Nunca hardcode as opções — use `capabilities`.
- **Slider com valor**: parâmetros contínuos (`imgStrength` 0–100%, `cfg` 0–10 passo 0,5). Sempre mostre o número junto.
- **Switch**: booleanos (`Expandir prompt (LTX)`). Rótulo explica o efeito, não o nome interno.
- **Seção expansível**: "Ajustes finos" começa recolhida (cabeçalho clicável + ícone expandir/recolher) para não assustar o uso básico.
- **Ícones com `contentDescription` em português**: Assistir, Salvar na galeria, Compartilhar, Cancelar, Refazer, Variar ×2, Ajustar, Excluir. Ícone sem descrição = falha de acessibilidade.
- **Card de histórico**: parâmetros sempre visíveis (o que foi pedido, não só o status); botão **Ajustar** reaproveita tudo no Criar (imagem original mantida salvo troca).

## Responsividade e estados

- Coluna com scroll vertical + `fillMaxWidth`; linhas de ação com scroll horizontal (não quebrar em telas estreitas).
- Estados de job: `Na fila` (indeterminado + ETA), `Gerando…` (determinado + ETA), `Pronto` (Assistir/Salvar/Compartilhar), `Falhou` (erro em vermelho), `Cancelado`.
- Lista vazia: "Nenhum vídeo ainda." Rede com erro: mensagem + "Tentar de novo" (nunca tela branca).
- Polling do histórico com pausa em tela invisível (4 s com job ativo, 30 s sem) + aviso "Desatualizado" quando a última leitura falha; sem paginação além de `limit` (ok para uso pessoal).

## Aderência verificada (2026-11-21)

- Conforme: telas/abas/componentes acima implementados; chips dirigidos por capabilities; parâmetros completos no card (`duration/aspect/quality/seed/imagem/negativo/knobs`); data/hora do pedido; ações por ícone com descrição; estados vazios/erro tratados.
- A melhorar (futuro, sem urgência): tema próprio (cores/tipografia da marca), pré-visualização da imagem maior, confirmação antes de excluir, opções de `steps` vindas do servidor (hoje o app fixa `low|std|high`, duplicando o enum do backend — as capabilities anunciam só o nome em `features.tune`).
