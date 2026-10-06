
### Workers AI (REST con el token OAuth de wrangler)

| puerto | modelo | ms | CER oro p.10 | folio | m$ | resultado |
|---|---|---|---|---|---|---|
| lector | @cf/google/gemma-4-26b-a4b-it | 7318.618 | 0.105 | 4 | 0.403 | Danes, Vrgél, Oliveros, Dudon, Reinaldos, Celinos, y su prim |
| lector | @cf/zai-org/glm-5.3-flash | 121162.462 | 1 | ∅ | 0.887 | […] |
| lector | @cf/meta/llama-4-scout-17b-16e-instruct | 22227.737 | 0.058 | 4 | 1.602 | Danes, Vrgèl, Olivéros, Dudon, Reinaldos, Gelinos, y fu prim |
| lector | @cf/mistralai/mistral-small-3.1-24b-instruct | 325.423 | — | — | 0 | ERROR [workers-ai] HTTP 400 en https://api.cloudflare.com/client/v4/accounts/f22c7a728ddc8e41cefd2644f8fb7632/ai/run/@cf/mistralai/mistral-small-3.1-24b-instruct: {"e |
| reordenador | bge-reranker-base | 215.013 | — | — | 0.00041 | puntuaciones 0.000, 0.097, 0.000 (la buena es la 2.ª) |
| embebedor | qwen3-embedding-0.6b | 527.707 | — | — | 0.00120 | puntuaciones 0.178, 0.707, 0.122 (la buena es la 2.ª) |