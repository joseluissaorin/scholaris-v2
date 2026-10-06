
### crearInteligencia (configuración por defecto)

| pieza | nombre |
|---|---|
| lector | cascada(gemini:gemini-3.8-flash → gemini:gemini-3.5-flash-lite → openrouter:mistral-ocr+google/gemini-3.5-flash-lite → workers-ai:@cf/meta/llama-4-scout-17b-16e-instruct) |
| reserva | — |
| embebedor | gemini-embedding-2@1536 |
| transcriptor | workers-ai:@cf/openai/whisper-large-v3-turbo | gemini:gemini-3.5-transcribe |
| reordenador | jev:jev-latest |
| juez | jev:jev-latest |
| redactor | gemini | openrouter |

Prueba: vector de 1536 dims; reordenar → 0.990, 0.020; 2 usos registrados por onUso.