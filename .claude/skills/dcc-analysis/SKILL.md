---
name: dcc-analysis
description: Analisis de codebase con DeltaCodeCube. Proporciona catalogo de 35 tools, flujos recomendados, y ejemplos de uso.
user-invocable: true
argument-hint: "[help|index|diagnose|impact|report]"
---

# DeltaCodeCube Analysis

Catalogo completo de las 35 tools de DeltaCodeCube con flujos recomendados.

## Subcomandos

Parsea `$ARGUMENTS` para determinar la accion:

- **vacio o "help"** → Mostrar catalogo de tools por categoria
- **"index [path]"** → Indexar codebase
- **"diagnose"** → Correr diagnostico completo (smells, debt, tensions, clones, drift)
- **"impact [path]"** → Evaluar impacto de cambiar un archivo
- **"report"** → Generar reportes visuales

## Ejecucion

### Para help (default):

Muestra el catalogo organizado:

```
DeltaCodeCube - 35 Tools en 63D Feature Space

INDEXACION:
  cube_index_directory  — Indexar directorio completo
  cube_index_file       — Indexar archivo individual
  cube_reindex          — Re-indexar y detectar cambios

CONSULTA:
  cube_get_stats        — Estadisticas del cubo
  cube_get_position     — Coordenadas 63D
  cube_list_code_points — Listar code points
  cube_get_temporal     — Features temporales (git)

BUSQUEDA:
  cube_find_similar     — Archivos similares
  cube_search_by_domain — Por dominio semantico
  cube_find_by_criteria — Por multiples criterios
  cube_compare          — Comparar dos archivos

ANALISIS:
  cube_analyze_graph    — Grafo dependencias
  cube_get_centrality   — Centralidad de archivo
  cube_detect_smells    — Code smells
  cube_cluster_files    — Clustering K-means
  cube_get_suggestions  — Sugerencias refactoring
  cube_simulate_wave    — Onda de tension
  cube_predict_impact   — Predecir impacto
  cube_detect_clones    — Clones de codigo
  cube_get_debt         — Deuda tecnica
  cube_analyze_surface  — API surface
  cube_detect_drift     — Drift de archivos

DELTAS:
  cube_get_deltas       — Cambios recientes
  cube_analyze_impact   — Impacto de cambios
  cube_get_tensions     — Tensiones activas
  cube_resolve_tension  — Resolver tension

CONTRATOS:
  cube_get_contracts    — Relaciones import/require
  cube_get_contract_stats — Stats de contratos

REPARACION:
  cube_suggest_fix      — Contexto de fix

VISUALIZACION:
  cube_generate_timeline     — Timeline interactivo
  cube_generate_matrix       — Matriz dependencias
  cube_generate_heatmap      — Heatmap de calidad
  cube_generate_architecture — Diagrama arquitectura

EXPORT:
  cube_export_positions — Posiciones para viz externa
  cube_export_html      — HTML interactivo
```

### Para index [path]:

1. Si no hay path, usar el directorio actual del proyecto
2. Ejecutar `cube_index_directory` con el path
3. Luego `cube_get_stats` para mostrar resumen
4. Reportar: totalFiles, grade, score

### Para diagnose:

Ejecutar secuencialmente y consolidar:
1. `cube_get_stats` — panorama general
2. `cube_detect_smells` — code smells
3. `cube_get_debt` — deuda tecnica
4. `cube_get_tensions` — tensiones
5. `cube_detect_clones` — clones
6. `cube_detect_drift` — drift

Presentar reporte consolidado con prioridades.

### Para impact [path]:

1. `cube_predict_impact` con el path indicado
2. `cube_simulate_wave` desde ese archivo
3. `cube_get_contracts` para ver dependencias directas
4. Presentar mapa de impacto

### Para report:

Generar visualizaciones:
1. `cube_generate_architecture` — diagrama
2. `cube_generate_heatmap` — calidad
3. `cube_export_html` — export completo
4. Informar paths de los archivos generados

## Notas

- Requiere que el MCP `deltacodecube` este disponible
- Siempre indexar antes del primer uso en un proyecto nuevo
- Las visualizaciones generan archivos HTML en el directorio del proyecto
