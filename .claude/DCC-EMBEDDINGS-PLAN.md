# DCC Embeddings — De Heurísticas a Embeddings Inteligentes de Código

**Fecha:** 2026-03-23
**Estado:** Planificación
**Referencia:** Comparación con OpenViking (volcengine/OpenViking) — su L0/L1/L2 + búsqueda semántica vs nuestro keyword matching

---

## Problema Actual

DCC usa features algorítmicos de 63 dimensiones (50 léxicos + 8 estructurales + 5 semánticos) computados por heurísticas numéricas. No son embeddings neuronales. El experience memory usa keyword matching + domain guessing para buscar experiencias relevantes.

**Resultado:** cuando busco experiencias para `authService.ts`, solo matchea si hay keywords como "auth" o "service" en el store. No entiende que `loginController.ts` en otro proyecto es semánticamente similar.

**OpenViking resuelve esto** con embeddings + LLM rerank, pero depende de APIs cloud (Volcengine, OpenAI). Nosotros queremos **local, sin costo, sin latencia de red**.

---

## Visión: Metadata-Enriched Code Embeddings

No embedear código como texto plano. Embedear un prompt enriquecido con toda la metadata que DCC + LSP ya proveen:

```
ARCHIVO: src/services/authService.ts
FUNCIÓN: validateToken(token: string): Promise<boolean>
IMPORTS: jwt (jsonwebtoken), redis (ioredis), config (./configService)
EXPORTS: validateToken, refreshToken, revokeSession
TIPOS: recibe string, retorna Promise<boolean>
CALLS: redis.get(), jwt.verify(), logger.warn()
DOMINIO: auth (DCC clasificación)
COMPLEJIDAD: ciclomática 8, 45 LOC
CONTRATOS DCC: depende de redisService.ts (import), configService.ts (import)
DEPENDIENTES: loginController.ts, middleware/auth.ts (3 archivos importan este)
SMELLS: ninguno
TENSIONES: 0 activas
```

Esto produce embeddings que capturan **relaciones, roles, y semántica funcional** — no solo patrones léxicos.

---

## Modelos Candidatos (Local, Gratuitos)

| Modelo | Params | Dims | Código | Runtime | VRAM |
|--------|--------|------|--------|---------|------|
| **Nomic Embed Code** | 137M | 768 | ✅ Entrenado con código | Ollama | ~300MB |
| **BGE-Code-v1** (BAAI) | 326M | 1024 | ✅ | sentence-transformers | ~650MB |
| **StarEncoder** | 125M | 768 | ✅ Derivado de StarCoder | HuggingFace | ~250MB |
| **Jina Embeddings v3** | 570M | 1024 | ✅ Modo "code" | Docker/local | ~1.1GB |
| **CodeSage** (Microsoft) | 356M | 1024 | ✅ Code search optimized | HuggingFace | ~700MB |
| **All-MiniLM-L6-v2** | 22M | 384 | ❌ General | sentence-transformers | ~50MB |

**Recomendación:** Nomic Embed Code via Ollama — mejor relación calidad/tamaño para código, trivial de desplegar.

---

## Fases de Implementación

### Fase 1: Embeddings Básicos con Ollama (~1 día)

**Objetivo:** Reemplazar keyword matching por similarity search real.

**Componentes:**
1. **Ollama como servicio** — correr en Podman/Docker:
   ```bash
   podman run -d --name ollama -p 11434:11434 ollama/ollama
   podman exec ollama ollama pull nomic-embed-code
   ```

2. **DCC: nueva columna** en `code_points`:
   ```sql
   ALTER TABLE code_points ADD COLUMN embedding BLOB;
   -- 768 floats × 4 bytes = 3072 bytes por archivo
   ```

3. **DCC: embed al indexar** — después de `cube_index_file`, llamar Ollama:
   ```python
   response = httpx.post("http://localhost:11434/api/embed", json={
       "model": "nomic-embed-code",
       "input": file_content[:8000]  # truncar a context window
   })
   embedding = response.json()["embeddings"][0]
   ```

4. **DCC: nuevo tool** `cube_find_similar_semantic(file_path, top_k)`:
   - Embede el archivo query
   - Cosine similarity contra todos los embeddings en DB
   - Retorna top-K archivos más similares

5. **Experience injector** — reemplazar `_score_entry()` keyword matching por:
   - Embedear el file_path + context
   - Buscar experiencias con mayor cosine similarity
   - Threshold: >0.7 (en vez de score >0.10)

**Archivos a modificar:**
- `.deltacodecube/src/deltacodecube/db/schema.py` — nueva columna
- `.deltacodecube/src/deltacodecube/db/migrations.py` — migración
- `.deltacodecube/src/deltacodecube/tools/core.py` — embed al indexar
- `.deltacodecube/src/deltacodecube/tools/search.py` — nuevo tool semántico
- `.claude/hooks/experience_injector.py` — usar embeddings para scoring

**Dependencias:**
- Ollama corriendo en localhost:11434
- Modelo `nomic-embed-code` descargado (~300MB)
- `httpx` o `urllib3` para llamadas HTTP (DCC ya usa stdlib, sin deps nuevas)

### Fase 2: Metadata-Enriched Embeddings (~2-3 días)

**Objetivo:** Embedear contexto enriquecido, no código raw.

**Cambios sobre Fase 1:**
1. **Enrichment pipeline** — antes de embedear, construir prompt:
   ```python
   def build_enriched_prompt(file_path, conn):
       cp = get_code_point(conn, file_path)
       contracts = get_contracts(conn, file_path)
       smells = get_smells_for_file(conn, file_path)

       prompt = f"""
       FILE: {file_path}
       DOMAIN: {cp.dominant_domain}
       SIZE: {cp.line_count} LOC
       IMPORTS: {', '.join(c.callee for c in contracts if c.type == 'import')}
       IMPORTED_BY: {', '.join(c.caller for c in reverse_contracts)}
       SMELLS: {', '.join(s.type for s in smells) or 'none'}
       """
       return prompt
   ```

2. **LSP integration** (opcional) — si LSP está disponible:
   ```python
   lsp_data = get_lsp_symbols(file_path)  # via LSP tool
   prompt += f"FUNCTIONS: {lsp_data.functions}\n"
   prompt += f"TYPES: {lsp_data.types}\n"
   prompt += f"EXPORTS: {lsp_data.exports}\n"
   ```

3. **Embedear el prompt enriquecido** en vez del código raw

**Impacto:** Los embeddings capturan que `authService.ts` y `loginController.py` son semánticamente cercanos aunque usen lenguajes diferentes — ambos tienen domain "auth", imports de JWT, y complejidad similar.

### Fase 3: Fine-Tuning (opcional, ~1 semana, requiere GPU)

**Objetivo:** Que el modelo aprenda qué significa "similar" en contexto de desarrollo.

**Datos de entrenamiento (de DCC):**
- **Pares positivos:** archivos con contratos entre sí (A importa B → similares)
- **Pares positivos:** archivos refactorizados juntos (mismo commit → relacionados)
- **Pares negativos:** archivos en dominios distintos sin relación
- **Pares de experiencia:** archivos donde la misma experiencia aplica

**Proceso:**
```python
from sentence_transformers import SentenceTransformer, InputExample, losses

model = SentenceTransformer('nomic-ai/nomic-embed-code-v1')
train_examples = [
    InputExample(texts=["authService.ts enriched prompt", "loginController.ts enriched prompt"], label=0.9),
    InputExample(texts=["authService.ts enriched prompt", "cssTheme.ts enriched prompt"], label=0.1),
]
model.fit(train_objectives=[(train_loader, losses.CosineSimilarityLoss(model))])
model.save("./fine-tuned-dcc-embed")
```

**Requiere:**
- GPU (NVIDIA con CUDA, o ROCm para AMD)
- >10k pares de entrenamiento (extraíbles de DCC graph)
- ~4-8 horas de training en GPU consumer

---

## Arquitectura Post-Implementación

```
Archivo guardado
  ↓ (inotify → file watcher)
DCC cube_index_file
  ↓
Extrae metadata (contracts, domain, smells, complexity)
  ↓
Construye enriched prompt
  ↓
Ollama embed (nomic-embed-code, ~50ms)
  ↓
Guarda embedding en SQLite (768d BLOB)
  ↓
Experience query
  ↓
Embede query con mismo modelo
  ↓
Cosine similarity top-K
  ↓
Inyecta experiencias relevantes via experience_injector
```

**Latencia estimada:**
- Embed un archivo: ~50ms (modelo pequeño, local)
- Cosine similarity contra 1000 archivos: ~5ms (numpy)
- Total overhead por indexación: ~55ms (imperceptible)

---

## Comparación: Antes vs Después

| Métrica | Keyword matching (actual) | Embeddings semánticos (propuesto) |
|---------|--------------------------|----------------------------------|
| Precisión de búsqueda | ~40% (solo matchea keywords exactos) | ~85%+ (entiende semántica) |
| Cross-language | No (auth.ts no matchea auth.py) | Sí (mismo embedding domain) |
| Cross-project | Parcial (solo keywords) | Sí (embeddings comparables) |
| Latencia | <10ms | ~55ms (embed + search) |
| Costo LLM | $0 | $0 (local) |
| Almacenamiento | ~0 (JSON) | ~3KB por archivo (768 × 4 bytes) |
| Dependencia | Ninguna | Ollama + modelo (~300MB) |

---

## Decisiones Pendientes

- [ ] ¿Ollama en Podman o nativo? (Podman es más portable, nativo es más rápido)
- [ ] ¿Integrar en DCC (Python) o en workflow-manager (Python)? DCC es más natural
- [ ] ¿Embedear al indexar (sync) o en background (async)? Async para no bloquear
- [ ] ¿Guardar embeddings en SQLite BLOB o en archivo separado (numpy .npy)?
- [ ] ¿Fase 2 antes de Fase 1? (enriched prompts sin embeddings aún dan mejor keyword matching)
- [ ] ¿Fine-tuning vale la pena con <5k archivos? Probablemente no — metadata-enriched es suficiente
