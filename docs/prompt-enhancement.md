# Aprimorador de prompt

`POST /prompt/enhance` reescreve uma ideia curta (ex.: "lago ao amanhecer") no estilo que o modelo de vídeo prefere. No app,
aparece o botão **Melhorar prompt** quando `GET /capabilities` traz `promptEnhance: true`.

## Como ligar
```ini
ANTHROPIC_API_KEY=...            # sem isso a rota responde 501 e o botão some
PROMPT_MODEL=claude-haiku-5-5    # confira o modelo disponível na sua conta
ENHANCE_LANGUAGE=en              # en (padrão) | same (mantém o idioma do usuário)
ENHANCE_DAILY_LIMIT=100          # por usuário/dia
```

## O que ele faz
- Chama a API de mensagens da Anthropic com um *system prompt* por provedor. O texto do usuário vai como **dado** a reescrever
  (o modelo é instruído a nunca seguir instruções contidas nele); a saída é só o prompt, sem aspas nem explicações.
- **LTX (ComfyUI):** segue o guia oficial da LTX: um parágrafo corrido, tempo presente, 4–8 frases para um plano contínuo, cobrindo plano,
  cena, ação, personagem (com pistas físicas de emoção), movimento de câmera explícito e áudio, falas entre aspas. Limite de 1500 caracteres.
- **Kling e mock:** diretriz geral de boa prática (sujeito, ação/movimento, cena, luz, câmera, estilo; 2–5 frases; sem negações). **Não é guia oficial.**
- Com imagem inicial (`hasImage: true`) foca em movimento, câmera e som, sem redescrever o que a imagem já mostra.
- Idioma padrão **inglês** (modelos de vídeo costumam responder melhor); falas citadas ficam no idioma original.

## Custo, privacidade e limites
- Cada uso é uma chamada paga à API da Anthropic (um modelo pequeno custa frações de centavo); o limite diário por usuário evita abuso.
- **O texto do prompt é enviado à Anthropic** (a imagem não é enviada). Não ligue se isso for um problema para o seu caso.
- Falhas viram `502`; o app mantém o prompt original. O resultado é uma *sugestão*: o usuário pode editar antes de gerar.
