// ============================================================================
// HispaSubs — Cloudflare Worker v1.4.32
// Addon de Stremio: subtítulos en español clasificados por dialecto.
//
// v1.4.32 (30/10/2026):
//  - [LÉXICO / TEXTO COMPLETO] `scoreText` puntúa siempre el texto entero (hasta los
//    300 KiB ya analizados) en lugar del muestreo de 48 KB (cabeza+centro+cola). Datos de
//    producción: sobre 48 archivos `spl` y 161 sin etiqueta regional con `full=`, el
//    completo solo convierte Neutro/📄 en dialecto (6 de 8 acuerdan con la etiqueta, igual
//    precisión que antes: 77-79 %), con 0 saltos Castellano<->Latino. Coste estimado
//    +0,34 ms de media por archivo grande (p90 0,68 ms; hasta ~2,8 ms a 300 KB), es decir
//    ~+0,8 ms por respuesta en frío.
//  - [TELEMETRÍA] Se retiran los logs sombra `pref48=` y `full=`, que ya cumplieron su
//    función. Se mantienen `rl=` y la línea `[subtitles] langs`.
//
// v1.4.31 (29/10/2026):
//  - [OS-V3 / spl, spn] Se aceptan los códigos regionales `spl` y `spn` (antes se
//    descartaban en silencio: 176 entradas frente a 945 `spa` en producción; el 6,7 %
//    de los títulos con pistas quedaba vacío). Se clasifican por texto como siempre y
//    llevan `rl=spl` / `rl=spn` en el resumen para medir la etiqueta frente al léxico.
//    Red de seguridad: si el texto no parece español (<15 % de palabras funcionales
//    en las primeras ~12 KB) la pista se descarta (`looksSpanish`, ~0,12 ms).
//  - [SubDL / IDIOMA] Se descartan las entradas cuyo idioma declarado (`language` o
//    `lang`) no es español (visto: `br_pt` servido como "Español" durante 28 h).
//    Sin idioma declarado se conservan. Los descartes aparecen en la línea `langs`
//    como `SubDL es×3 (descartados: br_pt×1)`.
//  - [IDIOMA / PORTUGUÉS] La guarda de portugués de `scoreText` ahora descarta la
//    pista (`[classify] descartado por idioma (portugués)`); antes se servía como
//    "📄 Español (sin clasificar)".
//  - [TELEMETRÍA] `resumen_stats.cjs` cruza `rl=` con el veredicto servido y con
//    `full=`, mide la coincidencia de `spl` con Latino y de `spn` con Castellano,
//    y suma los descartes de SubDL.
//
// v1.4.30 (28/10/2026):
//  - [TELEMETRÍA / FULL TEXT SHADOW SCORING] En 1 de cada 5 archivos >48 KB
//    (muestreo determinista basado en hash de contenido), se ejecuta un análisis
//    léxico del texto completo (`full=<emoji>`) en segundo plano sin alterar
//    el veredicto servido al usuario. Permite comparar objetivamente la precisión
//    del muestreo estratificado (3 ventanas) vs prefijo 48 KB vs archivo completo.
//  - [TELEMETRÍA / IDIOMAS DE PROVEEDOR] Registro consolidado `[subtitles] langs`
//    con los idiomas declarados por OpenSubtitles V3 y SubDL (incluyendo códigos
//    descartados como `spl`), y etiqueta `rl=<lang>` en el resumen cuando el proveedor
//    envía un código no estándar.
//
// v1.4.29 (27/10/2026):
//  - [ANTI-SPAM / POLÍTICA POR FRASE DE CRÉDITO] Cambio de criterio en líneas débiles:
//    cuando una pista incluye una fórmula de autoría ("Traducido por", "Sincronizado por"...),
//    una única línea con dominio o correo ajeno se considera crédito de traductor legítimo
//    y se conserva. Solo se descarta si hay 2 o más líneas ajenas, marcas de agua comerciales
//    (OpenSubtitles / YTS) o términos de spam fuerte (apuestas, Telegram). Rescata 21 de cada
//    23 descartes en producción (TranslatorsIncSubs, SubAdictos, darkalien, correos, etc.).
//  - [TTL / RESPUESTAS VACÍAS SIN FALLOS] Se incrementa a 300 s (5 min) el TTL de caché
//    negativa para respuestas sin subtítulos cuando ambas fuentes respondieron bien o cuando
//    todas las pistas eran 404/duplicadas sin fallos de red. Evita el 27% de recálculos y
//    ráfagas de 8 descargas muertas repetidas cada minuto.
//  - [TELEMETRÍA / LOG SOMBRA PREF48] Registro `pref48=<emoji>` en la línea `resumen`
//    cuando el muestreo estratificado en archivos >48 KB difiere del prefijo de 48 KB.
//
// v1.4.28 (27/10/2026):
//  - [ANTI-SPAM / CRÉDITOS] Ampliación de comunidades legítimas con dominios
//    exactos vistos en producción: Asia-Team (.tv), Subs-Team (.tv y .net),
//    Addic7ed (.com), YYeTs (.com) y ForoMiniSeries (.net).
//  - [TELEMETRÍA / RESUMEN] Se añade métrica `len=Xk` (o `len=Xk+` si truncado)
//    en la línea de resumen de cada pista analizada, permitiendo correlacionar
//    el tamaño del archivo con el muestreo léxico en futuros exports.
//  - [LOGS / RUIDO] Se elimina la línea repetitiva "[SubDL] sin api_key" (ahorrando
//    el 14% de eventos en Cloudflare), integrándola en la línea por título como
//    "SubDL=0 (sin clave)".
//
// v1.4.27 (26/10/2026):
//  - [ANTI-SPAM / CRÉDITOS] Corrección de punto final en `SPAM_CREDIT_NAME_TOKEN`:
//    un punto gramatical al cierre de frase (ej. "Traducido por Argenteam." o
//    "www.subtitulos.es.") se distingue de un punto de dominio compuesto (ej.
//    "argenteam.net.bet-win.top"), evitando que créditos legítimos con punto
//    se descarten por señales débiles.
//
// v1.4.26 (26/10/2026):
//  - [LÉXICO / FIX SOLAPAMIENTO] Corrección matemática en `sampleScoreText`:
//    el inicio de la ventana central se calcula ahora centrando dentro del
//    hueco libre entre cabeza y cola (`SCORE_HEAD_BYTES + Math.floor((len - MAX_SCORE_BYTES) / 2)`)
//    en lugar de sobre la longitud total (`(len - SCORE_MID_BYTES) / 2`).
//    Elimina el solapamiento de hasta 6 KB con la cabeza en archivos de entre
//    48 KB y 60 KB, evitando que un único modismo en la franja [18 KB, 24 KB]
//    se cuente doble y dispare un falso positivo por override sin oposición.
//
// v1.4.25 (26/10/2026):
//  - [ANTI-SPAM / CRÉDITOS] Endurecimiento de `SPAM_CREDIT_NAME_TOKEN`: en vez
//    de `\S*...\S*` (que permitía camuflar dominios propios o URLs de afiliado
//    como `www.casino-argenteam.top` o `https://bet.top/?ref=argenteam`), ahora
//    solo consume el nombre exacto de la comunidad o su URL oficial legítima
//    (`argenteam.net`, `subdivx.com`, `subtitulos.es`, `allsubs.org`, `asia-team.net`,
//    `tusubtitulo.com`, `subtitulamos.tv`, `elrincondelsub.com`).
//  - [LÉXICO / MUESTREO] `scoreText` pasa de cortar en los primeros 48 KB a un
//    muestreo estratificado de 3 ventanas (24 KB cabeza + 12 KB centro + 12 KB
//    cola = 48 KB totales). Mantiene exactamente el mismo techo de CPU (<0,4 ms)
//    pero captura modismos en el segundo y tercer acto de películas de >48 KB.
//
// v1.4.24 (26/10/2026):
//  - [ANTI-SPAM / VECTOR DE ELUSIÓN] Cierre de fuga en exención de créditos:
//    una línea solo se clasifica como crédito comunitario (isCreditOnlyLine) si,
//    tras retirar la frase de autoría y el token de comunidad reconocida, no
//    contiene ninguna otra señal débil. Evita que líneas mixtas (ej. "Subtitulado
//    por www.casino-ya.top" o dominios ajenos en la misma línea) eludan el filtro.
//
// v1.4.23 (26/10/2026):
//  - [ANTI-SPAM CRÉDITOS] Preservación de créditos de comunidades de traducción
//    (Argenteam, SubDivX, subtitulos.es, AllSubs, asia-team, TuSubtitulo, etc.):
//    se introduce SPAM_CREDIT_LINE para evitar que bloques legítimos de 2 líneas
//    (ej. "Subtítulos por" + "www.argenteam.net") se descarten por señales débiles.
//    El descarte exige al menos una señal débil ajena a créditos comunitarios.
//    Recupera listas que antes quedaban vacías en frío (0 resultados).
//  - [OS-V3 429 JITTER RETRY] Reintento único ante HTTP 429 en descargas directas
//    de OpenSubtitles V3 con backoff + jitter (300-700 ms, respetando Retry-After
//    corto <=800 ms) dentro del presupuesto de 2000 ms.
//
// v1.4.22 (26/10/2026):
//  - [SUBDL NOT FOUND / CACHE] Corrección de regex en SubDL: se acota estrictamente
//    al mensaje exacto ("can't find movie or tv") para evitar que avisos de clave
//    inválida ("api_key not found") se tomen como 0 resultados legítimos. Además,
//    un título no encontrado en SubDL se marca unusable (se guarda en el namespace
//    de esa clave y nunca en el k_subdl compartido), blindando la caché contra
//    envenenamiento por claves inválidas.
//  - [RANKING RECORTADO] Simplificación del ranking: solo los subtítulos procedentes
//    de plataformas oficiales ([PLAT]) se ordenan al frente; el resto de pistas
//    conserva el orden natural del proveedor (evita priorizar arbitrariamente
//    WEB sobre BluRay sin disponer del filename del reproductor).
//  - [UX CONFIGURADOR] Ajuste del texto de ayuda de SubDL para reflejar fielmente
//    su función (ampliar el catálogo de búsqueda con subtítulos adicionales).
//
// v1.4.21 (26/10/2026):
//  - [RANKING DE CALIDAD] Priorización activa de subtítulos: las pistas
//    extraídas de releases profesionales y retail se sirven primero, seguidas
//    por ripeos WEB-DL/WEBRip, ediciones físicas (BluRay/UHD) y resto de pistas,
//    manteniendo todas las pistas del pool disponibles.
//  - [SUBDL NOT FOUND] Distinción entre título ausente en SubDL ("can't find
//    movie or tv" / 0 resultados legítimos) y clave inválida/revocada: se
//    registra como info (no error) y se cachea en `k_subdl` normal de 2 h
//    junto a OS-V3, evitando quemar cuota de API en títulos que no existen.
//  - [OS-V3 429] Escalonado (stagger) de 25 ms por candidato concurrente
//    hacia OS-V3 para evitar ráfagas de 5 descargas simultáneas en 0 ms que
//    disparan el rate limit HTTP 429 del proveedor.
//  - [UX CONFIGURADOR] En /configure se añade ayuda visual destacando que la
//    clave gratuita de SubDL amplía el catálogo y prioriza versiones de calidad.
//
// v1.4.20 (25/10/2026):
//  - [CACHE] Anti-envenenamiento en rama vacía: cuando `deduped.length === 0` y
//    SubDL no fue utilizable (clave falsa o rechazada), la lista vacía se
//    guarda en el namespace propio de esa clave (`k_<hash>`) y NUNCA en `k_subdl`.
//    Evita dejar sin resultados a los usuarios legítimos de SubDL durante 60 s.
//  - [OFICIAL] Corrección de precedencia: `releaseName` toma solo `subtitleFileName`
//    en OS-V3, evitando que el título de la película (`movieReleaseName`) diluya o
//    provoque falsos positivos.
//  - [OFICIAL] Regex de streaming estricta: solo `NF|NETFLIX|AMZN|DSNP|ATVP|HMAX|HULU`
//    (y `MAX` solo ante `WEB`). Se eliminan falsos positivos por títulos de película
//    ("Mad Max", "Prime", "The Apple", "Disney Princess").
//  - [TELEMETRÍA] Separación de origen de video: `WEB-DL` y `BluRay` se miden
//    independientemente en el log (`web=N disco=M`), sin confundirlos con plataforma.
//
// v1.4.19 (25/10/2026):
//  - [OFICIAL / OBSERVACIÓN] Detección inicial de subtítulos de streaming
//    (Netflix, Amazon Prime, Disney+, Apple TV+, HBO Max) a través de
//    metadatos de release. Se conserva la metadata en el pool interno, se marca
//    con `[IS_PLATFORM]` y se añade métrica `plataforma=X/Y` en los logs del resumen
//    sin alterar el orden de entrega al cliente (modo observación previo al ranking).
//
// v1.4.18 (25/10/2026) — auditoría técnica de la 1.4.17:
//  - [CACHE] Regresión corregida: una clave de SubDL rechazada (401/403,
//    status:false) se cachea en un namespace POR CLAVE (`k_<hash>`) que el propio
//    usuario lee tras un fallo en `k_subdl` (antes escribía en el público y leía de
//    `k_subdl`: nunca había HIT). Un SubDL caído (5xx/429/red) con clave válida
//    vuelve a cachearse 60 s en `k_subdl` (caché negativa), igual que el `catch`.
//    No hay envenenamiento: nadie puede provocar un 5xx de SubDL a otros usuarios.
//  - [CPU] `isSdh` analiza solo la muestra cabeza (48 KB) + cola (16 KB) y sus
//    clases de caracteres excluyen el delimitador de apertura: sin coste
//    cuadrático con ficheros hostiles (`[[[[…`, `((((…`).
//  - [SDH] Léxico acústico con límites de palabra Unicode: `(Marie)`, `(Cantabria)`,
//    `(Golpeado)` ya no cuentan; `[GRITA]` sí.
//
// v1.4.17 (25/10/2026) — auditoría técnica de la 1.4.16:
//  - [FIX] `canonicalConfigStr` se declara fuera del `try` de /subtitles: el
//    `catch` lo leía fuera de ámbito (ReferenceError -> 500 sin cuerpo en cualquier
//    error inesperado en lugar de la caché negativa de 60 s).
//  - [CACHE] Anti-envenenamiento real de `k_subdl`: si SubDL no es utilizable
//    (clave rechazada 401/403, `status:false`, cuota agotada) `getSubDL` marca el
//    resultado vacío con `unusable` y la respuesta (solo OS-V3) se cachea en el
//    namespace público (""), nunca en `k_subdl`. Una clave falsa ya no puede
//    dejar sin SubDL a los demás usuarios durante 2 h.
//
// v1.4.16 (25/10/2026) — auditoría técnica de la 1.4.15:
//  - [CPU] Blindaje definitivo de CPU en plan Free (<5 ms): `scoreText` se acota
//    a los primeros 48 KB (saturación léxica temprana); `spamVerdict` y
//    `hashContent` evalúan muestreos de cabeza (48 KB) + cola (16 KB) directamente
//    antes de normalizar, reduciendo el coste por candidato de 2.2 ms a ~0.6 ms.
//  - [CACHE] Normalización canónica de `subdlKey`: claves válidas se unifican en
//    el namespace `k_subdl` (máximos Cache HITs compartidos sin fugas); peticiones
//    sin clave o inválidas colapsan en `""`. Protección contra envenenamiento
//    si SubDL falla (no se cachea en `k_subdl`).
//  - [LÉXICO] Calibración sin sobrecorrección: el override sin oposición exige
//    al menos 2 términos FUERTES reales (`strongEs >= 2 && latMatches === 0`),
//    evitando que muletillas o términos débiles (`vale` ×4) tuerzan el dialecto.
//  - [SPAM] Regla contextual para marcas numéricas con espacio (`888 casino online`
//    se descarta; `007 Casino Royale` y `50 casinos` se conservan).
//  - [OBSERVABILIDAD] Cabecera `x-cache: HIT / MISS` en la ruta `/subtitles`.
//
// v1.4.15 (25/10/2026) — auditoría técnica de la 1.4.14:
//  - [SPAM] Fix de falso positivo en títulos legítimos (`007 Casino Royale`):
//    `SPAM_STRONG` exige número adyacente a la marca (`\d{2,}casino`), evitando
//    descartar películas o sinopsis con casinos/poker/slots en título o diálogo.
//  - [CPU] Reducción de `MAX_ANALYZE_BYTES` a 300 KiB (ahorro >65% CPU, blindando
//    el límite de 10 ms en Workers Free) y corrección de `truncated` en `readCapped`.
//  - [CACHE] Normalización canónica de `subtitleCacheUrl`: peticiones sin clave
//    de SubDL comparten la entrada de caché global, neutralizando cache-busting.
//  - [LÉXICO] Calibración de `margin` en `scoreText`: ventajas netas (≥2 vs 0)
//    clasifican directamente como Castellano o Latino en vez de falso Neutro.
//  - [SDH] Permitir signos de exclamación (`!`, `¡`) en descriptores acústicos.
//
// v1.4.14 (25/10/2026) — auditoría técnica de la 1.4.13:
//  - [SDH] Endurecimiento contra falsos positivos: `isSdh` evalúa descriptores
//    acústicos explícitos (efectos de sonido, ambiente, música) descartando
//    etiquetas de hablante (`[Nombre]:`) y letras de canciones ordinarias (`♪`).
//  - [HASH] Hash de 64 bits compuesto (`hashContent`) con prefijo de longitud
//    exacta y muestreo de cabeza (48 KB) + cola (16 KB) para evitar colisiones
//    entre archivos que comparten inicio pero difieren en el final o tamaño.
//  - [DRY] Unificación de la lógica de deduplicación de oleadas en `dedupWave`.
//
// v1.4.13 (24/10/2026):
//  - [SDH] Detección y etiquetado transparente de subtítulos para personas sordas
//    e hipoacúsicas (Closed Captions): añade `(SDH)` a las variantes dialectales
//    (ej. `🇪🇸 Castellano (SDH) (OS-V3)`) y `· SDH ·` a las sin clasificar
//    mediante detección lineal O(n) con detención temprana (`isSdh`).
//  - [DEDUP] Deduplicación por identidad textual (`hashContent`, muestra 64 KB
//    normalizada): descarta clones idénticos del mismo archivo entre fuentes y
//    activa automáticamente la 2ª oleada para completar el cupo de 5 limpias
//    sin penalizar el TTL de caché.
//
// v1.4.12 (22/10/2026) — auditoría externa de la 1.4.11:
//  - [CANONICAL] Las URLs de descarga de dl.subdl.com se normalizan a
//    `origin + pathname`, descartando cualquier consulta o fragmento
//    (api_key, API_KEY, apikey, token...). Esto garantiza 0 fugas de
//    credenciales y URLs 100 % canónicas e independientes del proveedor.
//  - [PROXY] Límite MAX_ENTRY_NAME = 512 en el proxy y descarte total de query
//    para dl.subdl.com en el backend de extracción.
//
// v1.4.11 (21/10/2026):
//  - [PRIVACIDAD / CUOTA] SubDL devuelve URLs con `?api_key=...`, pero su CDN
//    público (dl.subdl.com) no la exige y tiene un cupo diario de 50 descargas/clave
//    que al agotarse responde HTTP 429 (mapeado a 502 en proxy). Se elimina
//    `api_key` de las URLs de SubDL: evita quemar la cuota, protege la clave
//    en logs y Stremio, y hace que la caché del Edge de Vercel sea compartida
//    (Edge HIT).
//  - [PROXY] El proxy sanitiza `api_key` en URLs de entrada y registra el código
//    HTTP del origen en caso de error para diagnóstico inmediato.
//
// v1.4.10 (20/10/2026) — auditoría externa de la 1.4.9:
//  - [PORTUGUÉS] Guarda ampliada a portugués en MAYÚSCULAS (`/[ãõÕ]|Ã(?=[A-Z])/gu`),
//    cubriendo subtítulos de TV en mayúsculas ("NÃO", "AÇÕES") sin que el "Ã"
//    de mojibake UTF-8 ("Ã¡", "Ã©") cuente erróneamente como tilde portuguesa.
//  - [LOGS] Los descartes limpios permanentes (404/410 en directa, 410/422 en
//    proxy) ya no escriben `console.error("[classify]", ...)` en Cloudflare.
//  - [PROXY] Tope de 8 episodios encadenados por cabecera para garantizar O(n)
//    en el matcher multiepisodio ante nombres patológicos.
//
// v1.4.9 (20/10/2026) — auditoría externa de la 1.4.8:
//  - [PORTUGUÉS] La guarda de portugués exige tanto ≥10 apariciones de `ã`/`õ`
//    (solo minúsculas, sin contar `Ã` de mojibake UTF-8) como una densidad
//    ≥0,2 % (`tildes * 500 >= text.length`), para que un subtítulo español de
//    84 KB con nombres propios como "João" o "São Paulo" no caiga en 📄.
//  - [LOGS / CUOTA] Las puntuaciones léxicas (`es`, `lat`, `s` y el motivo de
//    📄: `portugués`, `sin léxico` o `solo términos débiles`) viajan en un
//    Symbol (`SCORE`) y se imprimen en la única línea de `[subtitles] resumen`,
//    evitando multiplicar por 6 el consumo del límite diario de 200k eventos.
//  - [LÉXICO] Lookahead de `manej*` ampliado a `del?` ("manejo del presupuesto").
//  - [PROXY] Eliminados los `0*` redundantes en `SE_HEAD` (evita O(n²) con
//    65.000 ceros) y acotado `EP_NEXT` a `\d{1,2}` (no confunde `.x264`/`.x265`
//    o `-720p` con episodios >= 100).
//
// v1.4.8 (20/10/2026) — auditoría externa de la 1.4.7:
//  - [TTL / PROXY 410/422] Se distingue entre descarte de contenido y caída de
//    plataforma del proxy: en URLs directas (!isZip) se descartan sin FAILED
//    los HTTP 404/410; en URLs proxificadas (isZip) solo se descartan HTTP 410
//    (enlace muerto en SubDL mapeado por el proxy) y HTTP 422 (zip sin
//    subtítulos válidos o sin el episodio pedido), mientras que un HTTP 404
//    crudo en la URL del proxy (ruta rota / PROXY_URL mal configurada) sí
//    marca FAILED y baja el TTL a 60 s. El log resumen incluye `descartes404`.
//  - [LÉXICO] `os` pasa a un regex débil sensible a mayúsculas (`[oO]s`, sin
//    flag `i`, peso 0,25) para que 40 apariciones de "OS" (sistema operativo)
//    o "os" religioso no sumen ni vuelquen un título técnico latino. `fome`
//    pasa a DICT_LAT_WEAK (0,25), y `scoreText` añade una guarda contra
//    subtítulos en portugués mal etiquetados (≥10 apariciones de `ã`/`õ` ->
//    null / 📄 sin clasificar, evitando que "carro"/"celular" en portugués
//    den 🇲🇽 Latino).
//  - [OBSERVABILIDAD] Cada clasificación registra el reparto real (`flag`,
//    `es`, `lat`, `strong`) sin volcar texto del subtítulo, permitiendo medir
//    en producción la distribución de puntuaciones.
//
// v1.4.7 (20/10/2026) — auditoría externa de la 1.4.6:
//  - [LATENCIA] Presupuesto temporal compartido entre las 2 oleadas
//    (CLASSIFY_BUDGET_MS = 6000 ms, WAVE2_MAX_W1_MS = 4000 ms): la 2ª oleada
//    solo se lanza si la 1ª terminó en <= 4 s, y su timeout se acota al
//    presupuesto restante. Evita que descargas colgadas en ambas tandas
//    dupliquen el peor caso a 12-16,5 s y mantiene el techo real en 10,5 s.
//  - [TTL/404] Un HTTP 404 al descargar un candidato (enlace muerto o pack de
//    temporada en el proxy que no contiene el episodio pedido) se descarta
//    como `null` sin marcar FAILED: es una ausencia permanente, no un fallo
//    transitorio de red, así que no degrada el TTL a 60 s si hay pistas
//    válidas (pero sí activa la 2ª oleada para rellenar el cupo).
//  - [LÉXICO] Cobertura regional ampliada en DICT_LAT (voseo y modismos
//    rioplatenses, chilenos y colombianos/andinos: boludo, pelotudo, pibe,
//    quilombo, tenés/querés/podés/sabés/decís/vení/mirá, weón/huevón, cachai,
//    fome, pololo, parce/parcero, chimba, chamo) y DICT_ES (os, mogollón,
//    currar, flipar). `jod*` pasa a DICT_ES_WEAK (0,25) por su uso en LatAm,
//    y se excluyen con negative lookahead las colocaciones no dialectales
//    ("móvil del crimen", "carro de la compra/combate", "conduce a nada/la
//    ruina") sin degradar el peso de coche/carro/móvil/conducir en cine formal.
//  - [OBS/PRIVACIDAD] spamVerdict devuelve el fragmento exacto (`match`) para
//    diagnóstico en logs. Se añade una línea de resumen con tiempos por oleada
//    al final de `/subtitles` y se desactiva `[observability.traces]` en
//    wrangler.toml (el span `cache_put` registraba la URL con config sin
//    redactar y duplicaba el consumo de eventos).
//
// v1.4.6 (19/10/2026) — auditoría de la 1.4.5 y contraste con logs de prod:
//  - [CPU/RED] Descarga de candidatos en DOS oleadas por fuente (5 + 3):
//    primero se descargan hasta ANALYSIS_BUDGET_PER_SOURCE (5) por fuente;
//    solo si una fuente queda con <5 limpias (por spam o fallo) y aún tiene
//    reserva, se lanza la 2ª tanda con las hasta 3 restantes. En el caso
//    común ahorra ~37 % de CPU y descargas, evita el cuello de 6 conexiones
//    simultáneas del runtime y reduce los HTTP 429 de subs5.strem.io.
//  - [TTL] SubDL 401/403 (clave revocada/inválida o cuota agotada) ya no
//    rechaza la promesa ni degrada el TTL a 60 s: devuelve [] como con
//    status:false para que las pistas de OS-V3 se cacheen 2 h. Y si una fuente
//    tenía candidatos pero todos fueron spam (0 limpias), el resultado vacío
//    no se cachea 2 h si el título quedó en 0 pistas.
//  - [TRUNCADO] fetchSubtitle ya no aborta con error cuando el origen declara
//    Content-Length > 1 MB: readCapped ya corta el stream en 1 MB y cancela
//    el resto, igual que cuando no viene Content-Length.
//
// v1.4.5 (19/10/2026) — auditoría de la 1.4.4 (6 mejoras aplicadas):
//  - [UTF-8] Un SRT UTF-8 de >1 MB cortado por readCapped a mitad de un
//    carácter multibyte dejaba un \uFFFD al final y disparaba el fallback a
//    windows-1252, corrompiendo todas las tildes del archivo (órale -> Ã³rale).
//    Ahora el probe de \uFFFD ignora el borde del corte (slice(0, -4)) cuando
//    el buffer fue truncado, y spamVerdict recibe `truncated` para evaluar
//    solo la cabecera (la cola de un corte a 1 MB es diálogo a mitad).
//  - [SERIES] En series, los .zip enrutados al proxy llevan &s=<season>&e=<ep>
//    para que en packs de temporada el proxy priorice el episodio pedido en
//    vez del archivo más grande.
//  - [TTL] El TTL degradado (60 s) por fallos de descarga se evalúa POR FUENTE:
//    solo degrada si una fuente tuvo >=1 fallo Y no alcanzó su cupo de 5
//    pistas limpias (o si una fuente entera rechazó). Si el sobrepaso de 8
//    candidatos rellenó las 5 limpias pese a un enlace roto, se cachea 2 h.
//  - [TIPOS] readCapped devuelve siempre Uint8Array también en el camino sin
//    ReadableStream.getReader (antes devolvía ArrayBuffer y buf.length era
//    undefined en la detección de BOM).
//
// v1.4.4 (19/10/2026) — auditoría externa de la 1.4.3 (verificación medida):
//  - [MEM] El Map del rate limiter fallback tenía un barrido que NO reduce
//    nada si toda la ventana sigue viva: por encima de 5000 IPs distintas en
//    60 s crecía sin límite. Ahora, tras barrer, se expulsa de la cabeza (el
//    Map conserva el orden de inserción) hasta bajar del tope, sin tocar la
//    entrada de la IP actual. (En producción manda el binding
//    SUBS_RATE_LIMIT; este Map es el fallback de tests/entornos sin binding.)
//  - [CPU/MEM] spamVerdict ya no parte el archivo entero con .split(/\r?\n/)
//    (0,8 ms y un array de miles de strings por subtítulo de 1 MB): extrae
//    las primeras/últimas 30 líneas con indexOf/lastIndexOf + slice
//    (0,007 ms medidos, 111×). Equivalencia verificada con fuzz (20 013
//    casos: CRLF, líneas de 299/300/301 car., archivos cortos, UTF-8).
//  - Las otras 3 claims de la auditoría se refutaron con medidas y NO se
//    aplican (ver NOTAS-INTERNAS.md): fatal:true en TextDecoder empeora los
//    BOM corruptos, adm-zip está acotado por MAX_ENTRIES/MAX_BYTES_TOTAL y
//    SPAM_STRONG (5,2 ms/MB) cuesta lo mismo que scoreText (4,5 ms/MB).
//
// v1.4.3 (19/10/2026) — auditoría de la 1.4.2: CPU, falsos positivos y fugas
// de la política de solo pistas verificadas:
//  - [CPU] scoreText recorría cada diccionario fuerte DOS veces (esMatches/
//    latMatches y otra vez strongTotal). Ahora cada uno se recorre una sola
//    vez. Medido a 80 KB: ~2× menos coste léxico.
//  - [CPU] El anti-spam ya no rastrea las ~1.000 líneas de un SRT: analiza
//    solo las primeras y últimas 30 (donde va la publicidad) y salta líneas
//    de más de 300 caracteres.
//  - [ReDoS] SPAM_WEAK_LINE era cuadrático con líneas patológicas (20k car.
//    → 0,5 s; 80k → 9,6 s). El corte de línea lo elimina: un subtítulo
//    hostil ya no deja el título sin respuesta ni tumba la petición.
//  - [FP] Las frases-CTA que también son diálogo ("síguenos en Instagram",
//    "instala la aplicación", "tragamonedas en línea"…) solo descartan si
//    aparecen en la cabecera o el pie, no en mitad del subtítulo.
//  - [FUGAS] Una descarga fallida ya no publica un "📄" sin pasar por el
//    filtro: se descarta (el fallo sigue bajando el TTL a 60 s). El spam de
//    un SRT UTF-16 con BOM ya se detecta (antes se decodificaba a ciegas).
//  - [COBERTURA] El presupuesto se gasta DESPUÉS de filtrar: se analizan
//    hasta 8 candidatos por fuente y se sirven las 5 primeras limpias (antes
//    5 candidatos, los contaminados vaciaban el título).
//  - [MODO SOMBRA] SPAM_FILTER=log mide sin descartar (por defecto descarta).
//  - [ROBUSTEZ] sourceFailed dejaba de ser código muerto: una fuente caída
//    ahora propaga el error y baja el TTL (el README ya lo prometía). El
//    léxico sin raíces abiertas (jod*, ching*, cond*…) y el dialecto exigen
//    al menos un término fuerte. PROXY_URL exige https y el CI fija wrangler.
//
// v1.4.2 (19/10/2026) — limpieza anti-spam y solo pistas verificadas:
//  - Filtro anti-spam durante la clasificación (coste cero: se aplica al texto
//    que YA se descarga para el análisis léxico). Diccionario en dos niveles:
//    los patrones FUERTES (casas de apuestas, casino online, enlaces de
//    Telegram/WhatsApp, "únete a nuestro canal", CTAs de app/web) descartan
//    con UNA coincidencia; los DÉBILES (una URL/dominio suelto, créditos
//    "subtítulos por", nombres de sitios) solo con DOS líneas distintas. Así
//    "Traducido por Argenteam" sobrevive, pero el sub con publicidad no.
//  - Política estricta: solo se sirven pistas clasificadas. Antes, las entradas
//    sin presupuesto de análisis se publicaban como "📄 sin clasificar" y eran
//    un coladero de spam (no se puede saber sin descargar su texto).
//  - Presupuesto de análisis 3 → 5 por fuente: con la política estricta, el
//    tope duro de la respuesta pasa a 10 pistas, todas verificadas.
//  - OS-V3: timeout de la fuente 2500 → 4500 ms (logs 19/10/2026: 2 abortos en
//    88 peticiones que acababan en 0 resultados; ver getOpenSubtitlesV3).
//
// v1.4.1 (19/10/2026) — auditoría de código (solo versión alineada con el
// proxy; la lógica del worker no cambia, su último cambio real es v1.4.0):
//  - Proxy: descarga por streaming acotada a 4 MB (anti-OOM; un origen que
//    miente con content-length ya no puede volcar GB en memoria), .sub
//    UTF-16 con BOM no se descarta como binario VobSub y zipUrl se
//    normaliza a String. Ver cabecera de api/proxy.js.
//
// v1.4.0 (18/10/2026) — auditoría externa (5 lotes):
//  - Léxico: fronteras Unicode (?<![\p{L}\p{N}_], flags giu) porque \b es
//    ASCII y perdía "órale"/"aparcáis"; raíces con conjugaciones (README
//    cumplido); términos ambiguos (vale/papa/neta/ustedes) con peso 0,25 en
//    vez de 1; Neutro exige términos fuertes reales (si no, 📄).
//  - Caché: TTL 60 s si la respuesta está degradada (clasificación con error
//    o fuente caída) en vez de 2 h; clave canónica (config, type, id) que
//    ignora params de query y %3A (antes se fragmentaba la caché).
//  - Rate limit: tests del binding de la Workers Rate Limiting API; docs
//    corregidas (RATE_LIMIT solo desactiva con 0; el tope vive en
//    wrangler.toml [[ratelimits]] simple.limit).
//  - Proxy: variable PROXY_URL (env) para despliegues propios.
//  - /configure con Cache-Control: no-store (la página puede llevar la clave).
//
// v1.3.3 (18/10/2026):
//  - Rate limiting nativo via Workers Rate Limiting API (ratelimit binding).
//    Aplica solo a peticiones SIN caché (subtitles/manifest dinámicos).
//    Usa clave por IP (cf-connecting-ip). Periodo 60 s, configurable vía env
//    RATE_LIMIT (0 = desactivado). Respeta Free plan; sin coste extra.
//    Mantiene logs mínimos (avisa una sola vez por ventana).
//
// v1.3.2 (18/10/2026):
//  - /logo.svg y /favicon.ico se sirven desde la Cache API del borde: el
//    logo concentra >50 % de las ejecuciones (Stremio lo re-pide en cada
//    apertura; ~37k req/día) y ahora el borde responde sin ejecutar el
//    worker. Cabecera x-cache: HIT/MISS para diagnosticar.
//    (Posteriores a este cambio: los ficheros viven ahora en public/ como
//    Workers Static Assets y el borde los sirve sin invocar al Worker ->
//    ni cuota ni logs; la ruta de este archivo queda como fallback.)
//  - /favicon.ico deja de devolver 404 (los navegadores lo piden siempre
//    que la página no declara <link rel="icon">).
//  - Log de SubDL más claro ante HTTP 403 (clave rechazada o cuota agotada).
//
// v1.3.1 (auditoría 18/10/2026):
//  - Firma del manifest eliminada: estaba generada para el manifest de
//    v1.2.0 y dejó de validar al subir la versión (ver cambio 21).
//  - Solo se enrutan al proxy de Vercel los .zip cuyo host está en su
//    allowlist; los .rar y demás formatos que nadie puede abrir se
//    descartan en vez de publicar una URL rota.
//  - El análisis valida el contenido: HTML, binario, vacío o 0 matches ya
//    no se etiquetan "🌎 Neutro", sino "📄 sin clasificar".
//  - Descarga del análisis acotada a 1 MB (un arrayBuffer() completo podía
//    tirar el isolate).
//  - Cache-Control explícito (2 h listas / 60 s negativas) y rate limit por
//    IP configurable (RATE_LIMIT, 0 = desactivado).
// v1.3.0: formato canónico del protocolo: `lang` ISO 639-2 ("spa") + `label`
//         con la etiqueta visible. La app móvil agrupa por código de idioma
//         (con `lang` de texto libre no listaba NINGUNA entrada); el
//         escritorio muestra `label` si existe. Sin config, igual en todos
//         los dispositivos.
// Cambios vs 1.0.0 (ver resumen al final del archivo):
//  - XSS: HTML escapado en la página de configuración.
//  - Fix del regex ///g que rompía los botones de instalación.
//  - Guards defensivos: una sub malformada ya no vacía todas las fuentes.
//  - Análisis equilibrado por fuente + deduplicación por URL.
//  - Timeouts que cubren también la descarga del body.
//  - Fallback de codificación Windows-1252 para SRTs antiguos.
//  - Cache API para la ruta de subtitles.
//  - Descripción del manifest estática (compatibilidad con la firma).
//  - Validación de tipo, IDs y esquemas http(s).
//  - Logging con console.error (sin exponer la API key).
// ============================================================================

// Diccionarios léxicos. Notas:
//  - Fronteras Unicode (?<![\p{L}\p{N}_]) en vez de \b: \b es solo ASCII, y
//    "ó" o "ñ" NO son \w, así que \b[oó]rale\b nunca matcheaba "órale" tras
//    un espacio (el caso más grave del informe de auditoría). Flags giu.
//  - Raíces con [\p{L}]* para capturar conjugaciones ("manejo", "condujo",
//    "aparqué", "tenéis"), no solo infinitivos: el README promete
//    conjugaciones y antes solo matcheaban las formas exactas.
//  - Los plurales siguen con (?:es)? / s? donde la raíz no aplica.
//  - "m[oó]vil" tolera SRTs mal codificados.
//  - String.match(/g/) resetea lastIndex, así que el flag g es seguro aquí
//    (NO cambiar a .test() sin resetear lastIndex a mano).
//
// Términos ambiguos (DICT_*_WEAK, peso WEAK_WEIGHT): comunes a ambos lados
// o con falsos positivos demostrados —"No vale la pena" contaba como España,
// "el Papa" y "ganancia neta" como Latino, "ustedes" (formal en España)
// como Latino—. Cuentan 0,25 en vez de 1 para que una palabra suelta no
// decida la clasificación; solo pesan cuando aparecen muchas veces.
const WEAK_WEIGHT = 0.25;
const DICT_ES = /(?<![\p{L}\p{N}_])(?:vosotros|ordenador(?:es)?|coche[s]?|gilipollas|hostias?|chaval(?:es)?|foll(?:ar|a|an|en|ó|o|ado|ando)|guay|m[oó]vil(?:es)?(?!\s+del\s+(?:crimen|asesinato|delito|robo|ataque)|\s+perpetuo)|patata[s]?|zumo[s]?|aparqu[\p{L}]*|aparc[\p{L}]*|condu(?:cir|zco|zca|zcan|ces|ce|cen|jiste|jeron|jo|cía|cías|cíamos|cían|ciendo|cido)(?!\s+a\s+(?:nada|eso|esto|ninguna\s+parte|la\s+ruina|un\s+desastre|una?\s+conclusi[oó]n))|enfad[\p{L}]*|nevera[s]?|jol[ií]n|mol(?:a|an)|ten[eé]is|sois|est[aá]is|mogoll[oó]n|curr(?:ar|o|as|a|amos|áis|an|ando|ado|ante[s]?)|flip(?:ar|o|as|a|amos|áis|an|é|ó|ando|ado|ante[s]?))(?![\p{L}\p{N}_])/giu;
const DICT_LAT = /(?<![\p{L}\p{N}_])(?:computadora[s]?|carro[s]?(?!\s+de\s+(?:(?:la\s+)?compra|combate)|\s+blindado)|auto(?:s)?|pendej[\p{L}]*|ching(?:ar|a|as|an|o|ó|aron|aba|aban|ado|ada|ando|ón|ones|ue|ues|uen|ué|adera)|platic[\p{L}]*|celular(?:es)?|jugo[s]?|estacion(?:ar|a|as|an|ó|é|aste|aron|aba|abas|ábamos|aban|ado|ada|ando|amiento)|manej[\p{L}]*(?!\s+del?(?![\p{L}\p{N}_]))|enoj[\p{L}]*|refrigerador(?:es)?|chavo(?:s)?|wey|güey|carajo|[oó]rale|chido|bacano|bolud[\p{L}]*|pelotud[\p{L}]*|pibe[s]?|quilombo[s]?|tenés|querés|podés|sabés|decís|vení|mirá|we[oó]n(?:es|a|as)?|huev[oó]n(?:es|a|as)?|cachai|polol[oa][s]?|parce(?:ro|ra|ros|ras)?|chimba[s]?|chamo[s]?)(?![\p{L}\p{N}_])/giu;
const DICT_ES_WEAK = /(?<![\p{L}\p{N}_])(?:vale|jod(?:e|es|en|emos|er|a|as|an|ía|ías|íamos|ían|ió|ieron|iendo|ido|ida|idos|idas))(?![\p{L}\p{N}_])/giu;
// Sin flag `i`: "os" / "Os" (inicio de frase) suman 0,25 para España, pero
// "OS" en mayúsculas (Operating System) no casa nunca.
const DICT_ES_WEAK_CS = /(?<![\p{L}\p{N}_])[oO]s(?![\p{L}\p{N}_])/gu;
const DICT_LAT_WEAK = /(?<![\p{L}\p{N}_])(?:papa[s]?|neta[s]?|ustedes|fome[s]?)(?![\p{L}\p{N}_])/giu;
// Guarda contra archivos en portugués mal etiquetados como español (donde
// "carro", "celular" o "estacionamento" darían falso positivo Latino). Sin
// flag `i` para que "Ã" de mojibake UTF-8 no cuente como tilde portuguesa,
// pero soportando portugués en MAYÚSCULAS ("NÃO", "AÇÕES") con "Ã(?=[A-Z])".
const PT_TILDE_RE = /[ãõÕ]|Ã(?=[A-Z])/gu;

// Túnel Node.js en Vercel como motor de extracción de zips.
// IMPORTANTE: el proxy DEBE llevar allowlist de hosts (ver api/proxy.js),
// si no, cualquiera puede usar tu servidor como open proxy/SSRF.
const VERCEL_UNZIPPER = "https://hispasubs.vercel.app/proxy?zipUrl=";

// PROXY_URL (env, opcional): sobrescribe la URL base del proxy para despliegues
// propios (dominio propio, otro proyecto de Vercel...). Se le añade el
// parámetro ?zipUrl= / &zipUrl= según lleve o no query string.
const proxyBase = (env) => {
  const custom = env && typeof env.PROXY_URL === "string" ? env.PROXY_URL.trim() : "";
  if (!custom) return VERCEL_UNZIPPER;
  // Solo https: el proxy propio también debe ir cifrado (antes se aceptaba
  // http:// y podía degradar la privacidad del zipUrl en tránsito).
  if (!/^https:\/\//i.test(custom)) return VERCEL_UNZIPPER; // basura o http -> valor por defecto
  return custom.includes("?") ? `${custom}&zipUrl=` : `${custom}?zipUrl=`;
};

const LOGO_SVG = `<svg width="80" height="80" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="20" width="80" height="60" rx="10" fill="#00d2ff" fill-opacity="0.2" stroke="#00d2ff" stroke-width="4"/><rect x="25" y="45" width="20" height="8" rx="4" fill="#00d2ff"/><rect x="55" y="45" width="20" height="8" rx="4" fill="#00d2ff"/><rect x="35" y="60" width="30" height="8" rx="4" fill="#00d2ff"/></svg>`;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

// Escapado de HTML — obligatorio para todo lo que viene del usuario (XSS).
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

// Hash determinista para IDs de respaldo (nunca Math.random: rompe la
// deduplicación de Stremio entre peticiones).
const hashStr = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

const isHttpUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(u);

// Solo .zip: el proxy de Vercel extrae zips con adm-zip. Un .rar no lo abre
// Stremio (no descomprime) ni nosotros -> esas entradas se filtran en la
// fusión de fuentes en vez de servir una URL que devolvería 415.
const isCompressed = (u) => /\.zip(\?|$)/i.test(u);

// Formatos comprimidos que NADIE de la cadena puede abrir: se descartan.
const isUnserveable = (u) => /\.(rar|7z|gz|bz2|xz|tar)(\?|$)/i.test(u);

// Hosts que el proxy de Vercel acepta. GEMELO de ALLOWED_HOSTS en
// api/proxy.js: si cambia uno, cambia el otro (si no, el .zip de esa fuente
// se enruta a un proxy que responde 403 y la entrada queda irreproducible).
const PROXY_ALLOWED_HOSTS = [
  "dl.subdl.com",
  "www.opensubtitles.org",
  "dl.opensubtitles.org",
  "files.opensubtitles.org",
  "dl6.opensubtitles.org",
];

// Un .zip solo se enruta al proxy si este lo puede descargar (https + host
// en allowlist). Si no, se trata como no servible.
const isProxyable = (u) => {
  if (!isCompressed(u)) return false;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && PROXY_ALLOWED_HOSTS.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
};

// Formato de cada entrada (campos del protocolo de Stremio):
//  - `lang`: SIEMPRE el código ISO 639-2 "spa". El cliente móvil (núcleo
//    Rust) agrupa/filtra los subtítulos por código de idioma: con texto
//    libre ("🇲🇽 Latino (OS-V3)") no listaba NINGUNA entrada en el selector
//    del reproductor. La selección automática de idioma (escritorio
//    incluido) matchea códigos contra `languages.find()`, no texto libre.
//  - `label`: la etiqueta visible. El escritorio (stremio-web) muestra
//    `label` si existe —`hasValidLabel(track.label)`— y solo recurre a
//    `languages.label(lang)` en su ausencia: la bandera + variante se
//    conservan en escritorio.
// v1.2.0 probó modos configurables (isoLang/langMode) metiendo el código
// dentro de `lang`; el híbrido siguió sin listarse en el móvil. El formato
// correcto del protocolo es `lang` + `label` (changelog 19/20).
const LANG_ISO_ES = "spa";

// Fetch JSON con timeout. El AbortController cubre también la lectura del body
// porque abort() corta el stream, no solo las cabeceras.
const fetchJSON = async (url, ms = 2500) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    // El timeout cubre también la descarga del body (abort corta el stream).
    clearTimeout(timer);
  }
};

// Descarga un .srt y lo decodifica con fallback: muchos SRTs antiguos son
// Windows-1252; en UTF-8 los acentos se rompen y el diccionario deja de
// matchear, sesgando todo hacia "Neutro". Un SRT UTF-16 (con BOM) se detecta
// por el BOM y se decodifica como tal: si no, el léxico y el anti-spam se
// saltaban el fichero entero.
//
// La lectura va ACOTADA a 300 KB: un subtítulo normal pesa ~40-100 KB
// (~2500 líneas). 300 KB cubre holgadamente el 99.9% de subtítulos reales
// de cine y series de principio a fin, manteniendo el consumo acumulado de
// CPU por petición holgadamente por debajo del límite de 10 ms en Workers Free.
const MAX_ANALYZE_BYTES = 300 * 1024;

// Un 429 del CDN de OS-V3 (subs5.strem.io) dejaba la pista como FALLO y,
// con ello, el TTL en 60 s: en producción, 24 errores 429 en 13 de 98
// respuestas en frío (el escalonado de 25 ms no los redujo). Se reintenta UNA
// vez, dentro del mismo timeout total, con una espera corta y con jitter para
// que las descargas simultáneas no vuelvan a coincidir. Solo en descargas
// directas (no en el proxy, cuyo 429 es su propio límite por IP).
const RETRY_429_BASE_MS = 300;
const RETRY_429_JITTER_MS = 400;
const RETRY_429_MAX_WAIT_MS = 800;

const fetchSubtitle = async (url, ms = 2000, retry429 = false) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const doFetch = () => fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
    });
    let res = await doFetch();
    if (res.status === 429 && retry429) {
      // Retry-After en segundos si viene (un valor > 800 ms => sin reintento). Si es una
      // fecha HTTP no se interpreta (NaN) y se usa la espera por defecto con jitter.
      const ra = Number(res.headers && res.headers.get && res.headers.get("retry-after"));
      const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : RETRY_429_BASE_MS + Math.random() * RETRY_429_JITTER_MS;
      if (wait <= RETRY_429_MAX_WAIT_MS) {
        try { await res.body?.cancel(); } catch { /* sin cuerpo que liberar */ }
        await new Promise((r) => setTimeout(r, wait));
        res = await doFetch();
        console.log(`[classify] HTTP 429: reintento tras ${Math.round(wait)}ms -> HTTP ${res.status}`);
      }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Si el subtítulo supera 300 KB (con o sin Content-Length), readCapped lee
    // únicamente los primeros 300 KB y cancela el stream: basta para clasificar
    // el léxico y evaluar la cabecera anti-spam sin rechazar el archivo.
    const buf = await readCapped(res, MAX_ANALYZE_BYTES);
    const truncated = Boolean(buf.truncated);
    // BOM primero: un SRT UTF-16 decodificado a ciegas como UTF-8/windows-1252
    // intercala bytes NUL entre caracteres y NINGÚN patrón (ni el léxico ni el
    // anti-spam) matchea; el spam se servía como "📄". El BOM lo delata.
    let text;
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      text = new TextDecoder("utf-16le").decode(buf); // quita el BOM
    } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      try { text = new TextDecoder("utf-16be").decode(buf); }
      catch { text = new TextDecoder("utf-8").decode(buf); } // codec no disponible
    } else {
      text = new TextDecoder("utf-8").decode(buf);
      // Si readCapped cortó en MAX_ANALYZE_BYTES a mitad de un carácter UTF-8
      // multibyte, el último carácter es \uFFFD por el corte, no porque el
      // archivo sea Windows-1252: ignoramos los últimos 4 caracteres en el
      // probe para no corromper las tildes de un UTF-8 legítimo.
      const probe = truncated ? text.slice(0, -4) : text;
      if (probe.includes("\uFFFD")) {
        try { text = new TextDecoder("windows-1252").decode(buf); } catch { /* codec no disponible: nos quedamos con UTF-8 */ }
      }
    }
    return { text, truncated };
  } finally {
    clearTimeout(timer); // también cubre el body: abort() corta el stream
  }
};

// Lee como mucho `max` bytes y cancela el stream. En entornos sin streaming
// (o si el body ya viene materializado) caemos a arrayBuffer() y cortamos.
async function readCapped(res, max) {
  let truncated = false;
  if (!res.body || typeof res.body.getReader !== "function") {
    const ab = await res.arrayBuffer();
    truncated = ab.byteLength > max;
    const out = new Uint8Array(truncated ? ab.slice(0, max) : ab);
    out.truncated = truncated;
    return out;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total >= max) {
      truncated = true;
      break;
    }
    const room = max - total;
    if (value.length > room) {
      chunks.push(value.subarray(0, room));
      total = max;
      truncated = true;
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  try { await reader.cancel(); } catch { /* stream ya cerrado */ }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  out.truncated = truncated;
  return out;
}

// Cache API tolerante: en algunos entornos caches.default no está disponible.
const cacheMatch = async (request) => {
  try { return await caches.default.match(request); } catch (_) { return undefined; }
};
const cachePut = (ctx, request, response) => {
  try {
    ctx.waitUntil(caches.default.put(request, response.clone()).catch(() => {}));
  } catch { /* caches.default no disponible en este entorno: seguimos sin cache */ }
};

// Cache-Control explícito. La Cache API de Cloudflare aplica por defecto un
// Edge TTL de 120 min a un 200 sin cabecera, es decir: el TTL vivía oculto en
// el default de la plataforma. Ahora está declarado:
//   7200 s: lista normal de subtítulos.
//    60 s: resultados vacíos o error (caché NEGATIVA: si un proveedor cae, no
//          se pagan 2,5 s de timeouts en cada petición de ese título).
const jsonResponse = (obj, cacheSeconds, extraHeaders = {}) =>
  new Response(JSON.stringify(obj), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
      "x-cache": "MISS",
      ...(cacheSeconds ? { "Cache-Control": `public, max-age=${cacheSeconds}` } : {}),
      ...extraHeaders,
    },
  });

// Clave CANÓNICA de caché de la ruta de subtítulos: (config, type, id).
// La petición de Stremio puede traer params de query y el id codificado como
// %3A; usar la URL cruda fragmentaba la caché en variantes y cada variante
// pagaba las descargas de las 5 subs otra vez. Exportada para test_worker.js.
const subtitleCacheUrl = (origin, configStr, type, fullId) =>
  `${origin}/${configStr ? `${configStr}/` : ""}subtitles/${type}/${fullId}.json`;

// ---------------------------------------------------------------------------
// Rate limit por IP (Workers Rate Limiting API + fallback in-memory)
//
// Ventana 60 s (coincide con binding simple.period=60). Solo cuenta
// peticiones SIN caché. Usa cf-connecting-ip como clave. Desactivable con
// RATE_LIMIT=0 (env/vars). Cuando el binding SUBS_RATE_LIMIT existe
// (Cloudflare), el límite es global por PoP/namespace; en tests (Deno) cae
// a un mapa in-memory del isolate (mantiene compatibilidad con los tests).
// ---------------------------------------------------------------------------
const rateHits = new Map();
// Tope del Map fallback: el barrido de expirados no reduce NADA si toda la
// ventana sigue viva (60 s), así que sin este cap un barrido de IPs distintas
// lo crecería sin límite (presión de memoria en el isolate) y cada petición
// pagaría un barrido completo inútil. Es un límite best-effort, no defensa de
// plataforma: en producción manda el binding SUBS_RATE_LIMIT.
const RATE_MAP_CAP = 5000;
const rateLimitFallback = (ip, limit, map = rateHits) => {
  const now = Date.now();
  if (map.size > RATE_MAP_CAP) {
    for (const [k, v] of map) if (v.reset <= now) map.delete(k);
    // Se expulsa de la cabeza (el Map conserva el orden de inserción),
    // preservando la entrada de la IP actual para no reiniciar su contador.
    // El bucle para por DEBAJO del tope: con la inserción posterior el Map
    // queda exactamente en RATE_MAP_CAP.
    for (const k of map.keys()) {
      if (map.size < RATE_MAP_CAP) break;
      if (k !== ip) map.delete(k);
    }
  }
  let entry = map.get(ip);
  if (!entry || entry.reset <= now) {
    entry = { count: 0, reset: now + 60_000, warned: false };
    map.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count > limit) {
    if (!entry.warned) {
      console.warn(`[rate-limit] ${ip} superó ${limit}/min`);
      entry.warned = true;
    }
    return Math.max(1, Math.ceil((entry.reset - now) / 1000));
  }
  return null;
};

const checkRateLimit = async (env, ip, limit) => {
  if (!ip || !Number.isFinite(limit) || limit <= 0) return null;
  try {
    if (env && env.SUBS_RATE_LIMIT && typeof env.SUBS_RATE_LIMIT.limit === "function") {
      const res = await env.SUBS_RATE_LIMIT.limit({ key: ip });
      if (!res.success) {
        return 60;
      }
      return null;
    }
  } catch (_) {
  }
  return rateLimitFallback(ip, limit);
};

// ---------------------------------------------------------------------------
// Config (base64url embebido en la URL)
// ---------------------------------------------------------------------------

const parseConfig = (configStr) => {
  if (!configStr) return {};
  try {
    let base64 = configStr.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    if (pad) base64 += "=".repeat(4 - pad);
    const parsed = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)))
    );
    // Defensa: el JSON debe ser un objeto, no un string/número.
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

// ---------------------------------------------------------------------------
// Página de configuración
// ---------------------------------------------------------------------------

const getConfigureHTML = (existingConfig = {}) => `
<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Configuración | HispaSubs</title><style>body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background-color: #121212; color: #ffffff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; } .container { background-color: #1e1e1e; padding: 40px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); max-width: 500px; width: 100%; text-align: center; } h1 { margin-top: 10px; color: #00d2ff; font-size: 28px; } p { color: #aaaaaa; font-size: 14px; margin-bottom: 24px; line-height: 1.5; } .form-group { text-align: left; margin-bottom: 20px; } label { display: block; margin-bottom: 8px; font-weight: bold; font-size: 14px; } input { width: 100%; padding: 12px; border: 1px solid #333; border-radius: 6px; background-color: #2a2a2a; color: #fff; box-sizing: border-box; font-family: monospace; } input:focus { outline: none; border-color: #00d2ff; } .btn-container { display: flex; flex-direction: column; gap: 10px; margin-top: 15px; } button { font-size: 16px; font-weight: bold; border-radius: 6px; cursor: pointer; width: 100%; padding: 14px 24px; transition: all 0.3s; } .btn-primary { background-color: #00d2ff; color: #121212; border: none; } .btn-primary:hover { background-color: #00a8cc; transform: translateY(-2px); } .btn-secondary { background-color: transparent; color: #00d2ff; border: 2px solid #00d2ff; } </style></head><body><div class="container"><div>${LOGO_SVG}</div><h1>HispaSubs</h1><p>Clasificación léxica en tiempo real para Stremio.<br>Detecta automáticamente modismos en español y los divide en <strong>🇲🇽 Latino</strong>, <strong>🇪🇸 Castellano</strong> y <strong>🌎 Neutro</strong>.</p><div class="form-group"><label>SubDL API Key (Opcional — Mayor catálogo)</label><input type="password" id="subdlKey" placeholder="ej: abc123def456..." value="${esc(existingConfig.subdlKey || "")}"><small style="display:block;margin-top:6px;color:#888;font-size:12px;line-height:1.4;">Obtén una clave gratis en <a href="https://subdl.com" target="_blank" style="color:#00d2ff;text-decoration:none;">subdl.com</a> para ampliar la búsqueda con subtítulos adicionales de su catálogo.</small></div><div class="btn-container"><button class="btn-primary" onclick="installAddon()">Instalar en Stremio</button><button class="btn-secondary" id="copyBtn" onclick="copyManifest()">Copiar URL del Manifest</button></div></div>
<script>
// NOTA: se usa split/join en vez de .replace(/.../) para no depender de
// escapes anidados dentro del template literal del Worker (el bug ///g de 1.0.0).
function getManifestUrl(protocol) {
  var key = document.getElementById('subdlKey').value.trim();
  var origin = protocol + '://' + window.location.host;
  if (!key) return origin + '/manifest.json';
  var bytes = new TextEncoder().encode(JSON.stringify({ subdlKey: key }));
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  var cfg = btoa(bin).split('+').join('-').split('/').join('_');
  while (cfg.charAt(cfg.length - 1) === '=') cfg = cfg.slice(0, -1);
  return origin + '/' + cfg + '/manifest.json';
}
function installAddon() { window.location.href = getManifestUrl('stremio'); }
function copyManifest() {
  var btn = document.getElementById('copyBtn');
  navigator.clipboard.writeText(getManifestUrl('https'))
    .then(function () { btn.innerText = '¡Copiado! ✓'; })
    .catch(function () { btn.innerText = 'Error al copiar'; });
}
</script></body></html>`;

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const getManifest = (host) => ({
  id: "org.hispasubs.addon",
  version: "1.4.32",
  name: "HispaSubs",
  // Descripción ESTÁTICA (no depende de la config del usuario).
  description:
    "Filtro inteligente de dialectos en español (🇲🇽 Latino / 🇪🇸 Castellano / 🌎 Neutro). OpenSubtitles V3 nativo + soporte SubDL.",
  logo: `https://${host}/logo.svg`,
  resources: ["subtitles"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: true },
  // SIN firma stremioAddonsConfig: la que había estaba generada para el
  // manifest de v1.2.0 (commit f8eff37) y al subir la versión dejó de validar
  // (la firma cubre el manifest byte a byte, incluido `version` y `logo`, que
  // depende del host). Una firma inválida es peor que ninguna. Para firmar de
  // nuevo: publica este manifest en stremio-addons.net y pega aquí el bloque
  // que te devuelva.
});

// ---------------------------------------------------------------------------
// Fuentes de subtítulos
// ---------------------------------------------------------------------------

// 1. OpenSubtitles V3 (comunidad)
//
// Timeout de la consulta: 4500 ms (antes 2500). El endpoint comunitario
// opensubtitles-v3.strem.io se congestiona y superaba a menudo los 2,5 s,
// abortando la fuente entera y devolviendo "0 resultados" temporal para
// títulos que sí tienen subs (logs 19/10/2026: 2 abortos en 88 peticiones,
// ambos acabando en lista vacía). El cliente de Stremio espera ~10-15 s, y
// el presupuesto total apura ese margen: fuentes en paralelo (máx 4,5 s) +
// clasificación en paralelo (2 s; 6 s para un .zip vía proxy) = 10,5 s de
// peor caso. SubDL —API comercial, más rápida— se queda en 2500 ms.
const OS_V3_TIMEOUT_MS = 4500;

// Idioma crudo que declara cada proveedor para una pista (solo TELEMETRÍA: el
// router sigue sirviendo todo como `spa`). OS-V3 y SubDL agrupan el español en
// un único cubo; estos helpers registran qué mandan de verdad para medir si su
// etiqueta (p. ej. "es-419") aportaría algo frente al léxico.
// `spl` y `spn` son los códigos con que OS-V3 separa variantes regionales del
// español (en producción: 165 y 11 entradas frente a 945 `spa` en el mismo
// período; hasta ahora se descartaban en silencio y el 6,7 % de los títulos con
// pistas quedaba vacío por ello). Su significado exacto no está confirmado en
// documentación, así que se aceptan con `verifyEs` (ver `looksSpanish`).
const OS_V3_ES_LANG_RE = /^(?:spa|esp|span|spl|spn|es)(?:[-_][a-z0-9]{2,8})?$/;
const OS_V3_VERIFY_LANG_RE = /^(?:spl|spn)(?:[-_][a-z0-9]{2,8})?$/;
// SubDL: idioma declarado que se considera español (campo `language` o `lang`).
// Vacío/ausente se conserva; cualquier otro (p. ej. "br_pt") se descarta.
const SUBDL_ES_LANG_RE = /^(?:es|esp|spa|spanish|español|espanol)(?:[-_][a-z0-9]{2,8})?$/;
// Comprobación barata de que un texto es español (palabras funcionales sobre
// las primeras ~12 KB). Un español real da ~0,35-0,45; inglés o francés ~0.
const ES_STOPWORDS = new Set(["que", "el", "la", "de", "no", "y", "en", "es", "un", "una", "los", "las", "se", "lo", "me", "te", "por", "con", "para", "del", "al", "mi", "tu", "su", "yo", "qué", "está"]);
const looksSpanish = (text) => {
  const words = text.slice(0, 12288).toLowerCase().match(/\p{L}+/gu) || [];
  if (words.length < 20) return true; // texto demasiado corto para juzgar: no se descarta
  let hits = 0;
  for (const w of words) if (ES_STOPWORDS.has(w)) hits += 1;
  return hits / words.length >= 0.15;
};
// Códigos que PARECEN español pero el filtro descarta ("spl", "spn", "ea",
// "lat…", "mx…", "cast…"; "est" = estonio, se excluye). Si OS-V3 enviara un
// código latino propio, hoy se perdería en silencio: así queda a la vista.
const NEAR_ES_LANG_RE = /^(?:sp[a-z]*|es(?!t$)[-_a-z0-9]*|ea|lat\w*|mx\w*|cast\w*)$/;
const RAW_LANG_DEFAULTS = new Set(["", "spa", "es", "spanish", "español", "espanol"]);
const normRawLang = (v) => String(v ?? "").toLowerCase().trim().slice(0, 16);
const langTally = (subs) => {
  const t = {};
  for (const s of subs || []) { const k = s?.rawLang || "(vacío)"; t[k] = (t[k] || 0) + 1; }
  return Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(" ");
};
const tallyToString = (o) =>
  Object.entries(o || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(" ");

const getOpenSubtitlesV3 = async (type, fullId) => {
  try {
    const data = await fetchJSON(
      `https://opensubtitles-v3.strem.io/subtitles/${type}/${encodeURIComponent(fullId)}.json`,
      OS_V3_TIMEOUT_MS
    );
    const nearMiss = {};
    const out = (data.subtitles || [])
      // Guard por entrada: una sub sin URL ya no invalida toda la fuente.
      .filter((sub) => sub && isHttpUrl(sub.url))
      .filter((sub) => {
        // ISO 639-2 ("spa") y variantes usuales ("es", "es-ES", "es-419",
        // "esp", "span"): el resto de idiomas se descarta. Antes solo
        // aceptaba includes("spa") o "es" exacto.
        const l = (sub.lang || "").toLowerCase().trim();
        if (OS_V3_ES_LANG_RE.test(l)) return true;
        if (NEAR_ES_LANG_RE.test(l)) nearMiss[l] = (nearMiss[l] || 0) + 1;
        return false;
      })
      .map((sub) => ({
        id: sub.id || `os_${hashStr(sub.url)}`,
        url: sub.url,
        lang: "spa",
        rawLang: normRawLang(sub.lang),
        verifyEs: OS_V3_VERIFY_LANG_RE.test(normRawLang(sub.lang)),
        source: "OS-V3",
        // `movieReleaseName` es el TÍTULO ("Inception (2010)"), no el release: las
        // etiquetas (AMZN, WEB-DL…) viven en el nombre del fichero. Con el título
        // en la cadena, "Mad Max" o "Prime" salían como plataforma.
        releaseName: sub.subtitleFileName || "",
        releaseGroup: sub.releaseGroup || "",
        releaseFormat: sub.releaseFormat || "",
      }));
    // Propiedad auxiliar de la lista (mismo patrón que `unusable` en SubDL):
    // no es un elemento, así que el spread del router la ignora.
    out.nearMiss = nearMiss;
    return out;
  } catch (e) {
    console.error("[OS-V3]", e.message);
    // Se propaga el error: promesa RECHAZADA en allSettled. Antes se devolvía
    // [] y la fuente caída era indistinguible de "0 resultados", así que
    // sourceFailed (TTL corto) nunca se activaba: la lista se cacheaba 2 h con
    // una fuente entera ausente. El router ya sabe fusionar [] cuando rechaza.
    throw e;
  }
};

// 2. SubDL
// Resultado vacío marcado como "no utilizable" (clave rechazada, cuota agotada,
// status:false): el router NO lo cachea en el namespace compartido `k_subdl`.
const unusableSubDL = () => Object.assign([], { unusable: true });
const getSubDL = async (imdbId, season, episode, apiKey, mediaType = "movie") => {
  // Sin clave no se consulta nada. Antes se escribía un log por petición
  // ("sin api_key"): en producción ocupaba el 14 % de los 1000 eventos
  // exportables (ventana de 46 min). Ahora la línea de diagnóstico por título
  // lleva "SubDL=0 (sin clave)", así que sigue siendo diagnosticable sin ruido.
  if (!apiKey) return [];
  if (!/^tt\d+$/i.test(imdbId)) return [];
  try {
    const subdlType = mediaType === "series" ? "tv" : "movie";
    let url =
      `https://api.subdl.com/api/v1/subtitles?api_key=${encodeURIComponent(apiKey)}` +
      `&imdb_id=${encodeURIComponent(imdbId)}&languages=ES&type=${subdlType}&subs_per_page=30`;
    if (season && episode && /^\d+$/.test(season) && /^\d+$/.test(episode)) {
      url += `&season_number=${season}&episode_number=${episode}`;
    }

    const data = await fetchJSON(url, 2500);
    // SubDL responde 200 con status:false tanto cuando la clave es inválida
    // como cuando no encuentra el título ("can't find movie or tv").
    // v1.4.22: "título no encontrado" se registra de forma informativa pero se marca
    // unusable (se cachea en k_<key> y no en k_subdl compartido) para evitar envenenamiento
    // si un error de clave contiene mensajes similares.
    if (data.status === false || !Array.isArray(data.subtitles)) {
      const errMsg = String(data.error || data.message || "");
      // Solo el mensaje EXACTO observado en producción. La regex anterior
      // (`not found` a secas) también casaba con avisos de clave inválida del
      // estilo "api_key not found", y entonces una clave falsa dejaba el
      // resultado (sin SubDL) en el `k_subdl` compartido.
      const isNotFound = /can'?t\s+find\s+movie\s+or\s+tv/i.test(errMsg);
      if (isNotFound) {
        // Informativo (no error). El resultado se marca `unusable`: la respuesta
        // (solo OS-V3) va al namespace de ESA clave, nunca al `k_subdl`
        // compartido, porque desde aquí no se puede distinguir "el título no
        // existe en SubDL" de "esta clave no sirve" con certeza.
        console.log(`[SubDL] título no encontrado ${imdbId} (${subdlType}${season ? ` s${season}e${episode}` : ""}): ${errMsg}`);
        return unusableSubDL();
      }
      console.error("[SubDL] respuesta sin subs:", data.error || "campo subtitles ausente", data.message || "");
      return unusableSubDL();
    }
    if (data.subtitles.length === 0) {
      console.log(`[SubDL] 0 resultados para ${imdbId} (${subdlType}${season ? ` s${season}e${episode}` : ""})`);
    }

    const droppedLang = {};
    const out = data.subtitles
      .map((sub, i) => {
        if (!sub || typeof sub.url !== "string" || !sub.url.trim()) return null;
        // Idioma declarado por SubDL: con `languages=ES` a veces llegan entradas de
        // otro idioma (visto en producción: `br_pt`, portugués brasileño, servido
        // como español). Si declara un idioma que no es español se descarta; si no
        // declara ninguno, se conserva.
        const declared = normRawLang(sub.language ?? sub.lang);
        if (declared && !SUBDL_ES_LANG_RE.test(declared)) {
          droppedLang[declared] = (droppedLang[declared] || 0) + 1;
          return null;
        }
        // SubDL devuelve URLs RELATIVAS ("/subtitle/111-222.zip", según la doc
        // oficial). El guard de seguridad iba ANTES de absolutizar, así que
        // descartaba TODAS las entradas de SubDL en silencio. Orden correcto:
        // 1) absolutizar, 2) validar el resultado.
        const raw = sub.url.trim();
        let dlUrl = raw.startsWith("http")
          ? raw
          : raw.startsWith("/") // relativa tipo /subtitle/123.zip (doc oficial)
            ? `https://dl.subdl.com${raw}`
            : null; // cualquier otra cosa (javascript:, datos, basura) se descarta
        if (!dlUrl || !isHttpUrl(dlUrl)) return null; // SSRF: solo http(s)
        // SubDL adjunta `?api_key=...` a la URL de descarga, pero su CDN público
        // (dl.subdl.com) no la exige y tiene un cupo diario de 50 descargas/clave
        // que al agotarse responde HTTP 429 -> 502 en el proxy. Al eliminarla:
        //  1. Evitamos exponer la api_key en URLs de Stremio y en logs de Vercel.
        //  2. La URL es canónica -> la caché Edge de Vercel/Cloudflare es compartida.
        //  3. Se evitan los falsos 502 por agotamiento de cuota diaria de SubDL.
        try {
          const parsed = new URL(dlUrl);
          if (parsed.hostname === "dl.subdl.com") {
            // Las URLs de descarga de SubDL son origen + ruta (/subtitle/<id>.zip):
            // se descarta TODA la consulta y el fragmento, sea cual sea el nombre del
            // parámetro (api_key, API_KEY, apikey, token…). Así la URL es canónica y
            // no depende de que SubDL siga llamando "api_key" a la clave.
            if (parsed.search || parsed.hash) dlUrl = parsed.origin + parsed.pathname;
          } else if (parsed.searchParams.has("api_key")) {
            parsed.searchParams.delete("api_key");
            dlUrl = parsed.toString();
          }
        } catch {
          // Si URL falla el parseo, se deja dlUrl tal cual
        }
        return {
          // file_id como fallback: índice determinista, nunca Math.random().
          id: sub.file_id ? `sdl_${sub.file_id}` : `sdl_${hashStr(dlUrl)}_${i}`,
          url: dlUrl,
          lang: "spa",
          rawLang: normRawLang(sub.language ?? sub.lang),
          source: "SubDL",
          releaseName: sub.release_name || sub.name || "",
          releaseGroup: "",
          releaseFormat: "",
        };
      })
      .filter(Boolean); // entradas malformadas se descartan una a una
    // Caso que antes quedaba mudo: la API devuelve subs pero ninguno con url
    // descargable (p.ej. solo referencias a página web). Sin este log, "SubDL=0"
    // sería indistinguible de "0 resultados".
    if (data.subtitles.length > 0 && out.length === 0 && Object.keys(droppedLang).length === 0) {
      console.error(`[SubDL] ${data.subtitles.length} subs en la respuesta pero ninguno con url descargable`);
    }
    // Propiedad auxiliar de la lista (igual que `nearMiss` en OS-V3).
    out.droppedLang = droppedLang;
    return out;
  } catch (e) {
    // 401/403 en SubDL es clave rechazada/caducada o cuota agotada del
    // usuario, no una caída transitoria del proveedor: igual que con
    // status:false, se devuelve [] en vez de rechazar la promesa, para que
    // las pistas válidas de OS-V3 se cacheen 2 h y no se golpee SubDL cada
    // 60 s con una clave muerta.
    const isAuthOrQuota = /\bHTTP 40[13]\b/.test(e.message);
    const extra = isAuthOrQuota
      ? "(clave rechazada o cuota agotada: se omite SubDL en este título)"
      : "";
    console.error("[SubDL]", e.message, extra);
    if (isAuthOrQuota) return unusableSubDL();
    throw e;
  }
};

// ---------------------------------------------------------------------------
// Motor de análisis léxico
// ---------------------------------------------------------------------------

// 📄 = "analizado sin veredicto" (nunca una variante): distinto de 🇪🇸/🇲🇽/🌎.
//
// FAILED (símbolo): JSON.stringify ignora las claves-símbolo, así que la marca
// distingue "sin clasificar porque hubo un ERROR (red, timeout, página HTML de
// error, bytes que no son texto)" —respuesta degradada, TTL corto— de "sin
// clasificar porque 0 coincidencias léxicas" —resultado estable, TTL normal—,
// sin que el flag llegue nunca a Stremio. (Las pistas sin presupuesto ya no se
// sirven: se descartan en vez de publicarse sin verificar.)
const FAILED = Symbol.for("hispasubs.failed");
const DISCARDED_404 = Symbol.for("hispasubs.discarded404");
const DISCARDED_DUPLICATE = Symbol.for("hispasubs.discardedDuplicate");
const SCORE = Symbol.for("hispasubs.score");
const CONTENT_HASH = Symbol.for("hispasubs.contentHash");

// Detección de pistas SDH (Sordos e hipoacúsicos / Closed Captions).
// Identifica descriptores acústicos inequívocos en español (efectos de sonido,
// ambiente, música o acciones no verbales), descartando etiquetas de hablante
// (`[JUAN]:`), preguntas/diálogo entre paréntesis (`(¿qué?)`) y transcripción
// de letras cantadas (`♪`).
// Detención temprana una vez alcanzado el umbral para no penalizar CPU.
const SDH_MIN_MATCHES = 10;
const SDH_ACOUSTIC_RE =
  /(?<![\p{L}\p{N}_])(?:m[uú]sica|sonidos?|disparos?|pasos|puertas?|gritos?|grita|gritan|gritando|llanto|llora|llorando|suspira|suspiros?|suspirando|aplausos?|motor(?:es)?|truenos?|campanas?|tel[eé]fono|alarma|golpes?|resoplido|risas?|r[ií]e|r[ií]en|riendo|silbido|silba|viento|ladra|ladridos?|maullidos?|respiraci[oó]n|explosi[oó]n|explosiones|murmullos?|ruidos?|silencio|tararea|canta|cantando|jade[oa]|a\s+lo\s+lejos|en\s+off|suena|crujido|timbre|chilla|chillar|ronquidos?|chasquidos?)(?![\p{L}\p{N}_])/iu;
// Las clases excluyen el delimitador de apertura: sin coste O(n·60) con `[[[[…`.
const SDH_BLOCK_RE = /\[([^\[\]\r\n]{2,60})\]|\((?![0-9\s]+\))([^()\r\n]{2,60})\)/g;
// Mismo muestreo que spam/hash: cabeza 48 KB + cola 16 KB.
const SDH_SAMPLE_HEAD = 49152;
const SDH_SAMPLE_TAIL = 16384;

const isSdh = (text, threshold = SDH_MIN_MATCHES) => {
  if (typeof text !== "string" || !text) return false;
  if (text.length > SDH_SAMPLE_HEAD + SDH_SAMPLE_TAIL) {
    text = text.slice(0, SDH_SAMPLE_HEAD) + "\n" + text.slice(-SDH_SAMPLE_TAIL);
  }
  SDH_BLOCK_RE.lastIndex = 0;
  let matches = 0;
  let m;
  while ((m = SDH_BLOCK_RE.exec(text)) !== null) {
    const inner = (m[1] || m[2]).trim();
    // Excluir etiquetas de hablante y preguntas de diálogo (permite exclamaciones acústicas: [¡DISPAROS!])
    if (inner.includes(":") || inner.includes("?") || inner.includes("¿")) continue;
    // Descriptor acústico explícito
    if (SDH_ACOUSTIC_RE.test(inner)) {
      matches++;
      if (matches >= threshold) return true;
    }
  }
  return false;
};

// Hash determinista de 64 bits del contenido textual del subtítulo.
// Normaliza \r\n -> \n, retira BOM si existe, e incluye la longitud normalizada
// junto a un muestreo de cabeza (48 KB) y cola (16 KB) con dos multiplicadores
// primos tipo FNV/Murmur.
//
// Optimización de CPU (v1.4.16): si el archivo no contiene `\r` (el caso más habitual),
// se evita la llamada a replace() con regex. Si contiene `\r`, normaliza a `\n` para que
// variantes CRLF y LF produzcan idéntico hash y longitud sin colisiones.
const hashContent = (text) => {
  if (typeof text !== "string" || !text) return "";
  const noBom = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const normalized = noBom.indexOf("\r") !== -1
    ? noBom.replace(/\r\n/g, "\n").trim()
    : noBom.trim();
  const len = normalized.length;
  const sample = len <= 65536
    ? normalized
    : normalized.slice(0, 49152) + "\n--TAIL--\n" + normalized.slice(-16384);
  let h1 = 0x811c9dc5, h2 = 0x811c9dc5;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ ((c << 5) | (c >>> 27)), 0x5bd1e995);
  }
  return `${len}:${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}`;
};

// Deduplicación determinista de una oleada: descarta pistas cuyo contenido
// textual ya fue procesado en esta u oleadas previas.
const dedupWave = (indices, analyzed, seenHashes) => {
  let duplicates = 0;
  for (const i of indices) {
    const s = analyzed[i];
    if (!s || s[FAILED] || s[DISCARDED_404]) continue;
    const h = s[CONTENT_HASH];
    if (h) {
      if (seenHashes.has(h)) {
        analyzed[i] = { [DISCARDED_DUPLICATE]: true };
        duplicates += 1;
      } else {
        seenHashes.add(h);
      }
    }
  }
  return duplicates;
};

// Identificación de subtítulos de plataforma (v1.4.20, corregida).
// SOLO etiquetas de servicio de streaming (NF, AMZN, DSNP, ATVP, HMAX, HULU, MAX
// junto a WEB) y SOLO sobre campos de release (nombre de fichero / release,
// grupo, formato), nunca sobre el título. WEB-DL, WEBRip, BluRay… indican contra
// qué VÍDEO está sincronizado el subtítulo, no de dónde salió el texto: se
// cuentan aparte (RELEASE_SOURCE) y no como "plataforma".
const IS_PLATFORM = Symbol.for("hispasubs.isPlatform");
const RELEASE_SOURCE = Symbol.for("hispasubs.releaseSource");
const PLATFORM_RELEASE_RE =
  /(?<![\p{L}\p{N}])(?:NF|NETFLIX|AMZN|DSNP|ATVP|HMAX|HULU|MAX(?=[\s._-]*WEB))(?![\p{L}\p{N}])/iu;
const DISC_RELEASE_RE =
  /(?<![\p{L}\p{N}])(?:BLU-?RAY|BD-?RIP|BR-?RIP|BDREMUX|REMUX|UHD)(?![\p{L}\p{N}])/iu;
const WEB_RELEASE_RE =
  /(?<![\p{L}\p{N}])(?:WEB-?DL|WEB-?RIP|WEB)(?![\p{L}\p{N}])/iu;

const releaseText = (sub) =>
  `${sub.releaseName || ""} ${sub.releaseGroup || ""} ${sub.releaseFormat || ""}`;

const isPlatformRelease = (sub) => (sub ? PLATFORM_RELEASE_RE.test(releaseText(sub)) : false);

// "disco" | "web" | "": origen del VÍDEO al que está sincronizado (señal de
// sincronía, no de calidad del subtítulo).
const releaseSourceOf = (sub) => {
  if (!sub) return "";
  const t = releaseText(sub);
  if (DISC_RELEASE_RE.test(t)) return "disco";
  if (WEB_RELEASE_RE.test(t) || PLATFORM_RELEASE_RE.test(t)) return "web";
  return "";
};

const unclassified = (sub, finalUrl, failed = false, sdh = false) => ({
  id: sub.id,
  url: finalUrl,
  lang: LANG_ISO_ES,
  label: `📄 Español (sin clasificar${sdh ? " · SDH" : ""} · ${sub.source})`,
  [IS_PLATFORM]: isPlatformRelease(sub),
  [RELEASE_SOURCE]: releaseSourceOf(sub),
  ...(failed ? { [FAILED]: true } : {}),
});

// Puntuación pura de un texto. Exportada para test_worker.js, que la ejercita
// contra un corpus etiquetado (fronteras Unicode, conjugaciones y términos
// ambiguos). Devuelve null cuando NO hay datos suficientes para afirmar nada
// (📄 "sin clasificar"); nunca decide por defecto.
//
// Puntúa SIEMPRE el texto completo (<= MAX_ANALYZE_BYTES, 300 KiB). Entre v1.4.16 y
// v1.4.31 se muestreaban 48 KB (cabeza+centro+cola) por CPU; los logs de producción
// (209 archivos grandes comparados) mostraron que el texto completo solo convierte
// veredictos Neutro/📄 en dialecto, sin saltos Castellano<->Latino y sin pérdida de
// precisión frente a las etiquetas `spl`/`spn`, a ~0,34 ms de media por archivo grande.
const scoreText = (rawText, diag = {}) => {
  if (typeof rawText !== "string" || !rawText) return null;
  const text = rawText;

  // Guarda contra portugués mal etiquetado como español: ≥10 "ã"/"õ" Y ≥0,2 %
  // de los caracteres (un nombre como "João"/"São Paulo" no debe tumbar un
  // subtítulo español entero).
  const tildes = (text.match(PT_TILDE_RE) || []).length;
  if (tildes >= 10 && tildes * 500 >= text.length) {
    diag.reason = "portugués";
    return null;
  }

  // Los términos ambiguos (WEAK) valen 0,25: "No vale la pena", "el Papa",
  // "ganancia neta" o un "ustedes" formal de España ya no deciden solos.
  const score = (dict, weight) => (text.match(dict) || []).length * weight;
  // Una sola pasada por diccionario fuerte: strongEs/strongLat alimentan tanto
  // las puntuaciones por dialecto como strongTotal (antes se volvían a
  // recorrer, duplicando el coste léxico).
  const strongEs = score(DICT_ES, 1);
  const strongLat = score(DICT_LAT, 1);
  const esMatches = strongEs + score(DICT_ES_WEAK, WEAK_WEIGHT) + score(DICT_ES_WEAK_CS, WEAK_WEIGHT);
  const latMatches = strongLat + score(DICT_LAT_WEAK, WEAK_WEIGHT);
  const strongTotal = strongEs + strongLat;
  const total = esMatches + latMatches;
  diag.es = esMatches;
  diag.lat = latMatches;
  diag.strong = strongTotal;
  if (total === 0) {
    diag.reason = "sin léxico";
    return null;
  }

  // Margen proporcional: con 3 apariciones de "coche" ya no decides un
  // subtítulo entero; hace falta cierta ventaja relativa.
  const margin = Math.max(2, Math.floor(total * 0.15));

  // Sin NINGÚN término fuerte no hay veredicto: los ambiguos (peso 0,25) solo
  // matizan. Evita que una acumulación de "ustedes" (o "vale"/"papa") decida
  // un dialecto por aritmética; en ese caso es 📄 "sin clasificar".
  if (strongTotal === 0) {
    diag.reason = "solo términos débiles";
    return null;
  }

  let flag = "🌎 Neutro";
  // Override sin oposición (v1.4.16): exige al menos 2 términos FUERTES reales
  // y CERO oposición total (ni fuerte ni débil), impidiendo que acumulación de
  // términos débiles (ej. "vale" x4) o ambiguos fuercen un dialecto falso.
  if (esMatches > latMatches + margin || (latMatches === 0 && strongEs >= 2)) flag = "🇪🇸 Castellano";
  else if (latMatches > esMatches + margin || (esMatches === 0 && strongLat >= 2)) flag = "🇲🇽 Latino";
  return { esMatches, latMatches, strongTotal, total, flag };
};

// ---------------------------------------------------------------------------
// Filtro anti-spam
// ---------------------------------------------------------------------------
//
// Los grupos de rippeo incrustan publicidad en el SRT (casas de apuestas,
// canales de Telegram/WhatsApp, "descarga nuestra app"...) que ocupa un hueco
// en la lista y ensucia la reproducción. Se DESCARTA la pista entera en vez de
// limpiar el texto: Stremio descarga el archivo tal cual (o vía proxy) y
// reescribir bloques SRT en Vercel es frágil (timestamps, BOM, codificaciones).
//
// El diccionario va en DOS niveles para no ser una guillotina con los
// catálogos pequeños:
//  - FUERTE: publicidad inequívoca. UNA coincidencia descarta la pista.
//  - DÉBIL: ruido que también aparece en subtítulos legítimos (una URL de
//    crédito, "Traducido por X", el nombre de un sitio). Solo descarta con DOS
//    líneas distintas —"Traducido por Argenteam" se conserva; con una segunda
//    línea ("Entra en nuestra web") cruza la línea—.
//
// Fronteras Unicode (?<![\p{L}\p{N}_]) en vez de \b: \b es ASCII y fallaría
// tras "ú"/"í" ("Únete…"). Sin /g: los .test() no deben arrastrar lastIndex.
// Sin cuantificadores anidados, para no arriesgar backtracking sobre 1 MB.
//
// El análisis se ACOTA a las primeras y últimas EDGE_LINES líneas (donde los
// grupos ponen cabeceras y pies). Eso abarata el filtro (no rastrea 1.000
// líneas), evita falsos positivos de frases que también son diálogo y corta el
// ReDoS de SPAM_WEAK_LINE saltando líneas de más de MAX_SPAM_LINE caracteres
// (una línea "a.a.a…" de 80k tardaba 9,6 s y dejaba el título sin respuesta).
const EDGE_LINES = 30;
const MAX_SPAM_LINE = 300;

// FUERTE global: marcas y URLs que no aparecen en diálogo normal. Se busca en
// el muestreo de cabeza (48 KB) y cola (16 KB) del subtítulo.
// `\d{2,}` cubre marcas numéricas pegadas (888casino, 777slots).
// Para marcas numéricas con espacio ("888 casino", "777 slots"), se exige contexto
// de apuestas en la misma frase/bloque ("online", "en línea", "bonus", "apuestas", "giros"),
// evitando descartar títulos o diálogos legítimos como "007 Casino Royale" o "50 casinos".
const SPAM_STRONG = /(?<![\p{L}\p{N}_])(?:(?:bet\s*365|1xbet|1win|22bet|betway|melbet|bwin|parimatch|betano|betfair)(?![\p{L}\p{N}_])|\d{2,}(?:casino|bingo|poker|ruleta|slots)(?![\p{L}\p{N}_])|(?:casas?\s+de\s+apuestas|apuestas\s+deportivas|bono\s+de\s+bienvenida|giros\s+gratis)(?![\p{L}\p{N}_])|(?:(?:t|telegram|wa)\s*\.\s*me|chat\s*\.\s*whatsapp\s*\.\s*com|whatsapp\s*\.\s*com\s*\/\s*channel)\s*\/\s*[^\s<>"']+|(?:(?<![\p{L}\p{N}_])\d{2,}\s+(?:casino|bingo|poker|ruleta|slots)(?![\p{L}\p{N}_]).{0,60}?(?:online|en\s+l[ií]nea|bonus|bono|apuestas?|registr(?:o|[aá]te)|giros|tragamonedas))|(?:(?:online|en\s+l[ií]nea|bonus|bono|apuestas?|registr(?:o|[aá]te)|giros|tragamonedas).{0,60}?(?<![\p{L}\p{N}_])\d{2,}\s+(?:casino|bingo|poker|ruleta|slots)(?![\p{L}\p{N}_])))/iu;

// FUERTE solo en BORDES: frases que también pueden ser diálogo legítimo
// ("síguenos en Instagram", "instala la aplicación", "tragamonedas en línea").
// En cabecera/pie son publicidad; en mitad del subtítulo, no.
const SPAM_STRONG_EDGE = /(?<![\p{L}\p{N}_])(?:(?:casino|bingo|poker|ruleta|tragamonedas|tragaperras)\s+(?:online|en\s+l[ií]nea|virtual)(?![\p{L}\p{N}_])|[uú]nete(?:te)?\s+(?:a|al)\s+(?:nuestro|nuestra|mi)\s+(?:canal|grupo|comunidad|telegram|whatsapp|servidor)(?![\p{L}\p{N}_])|(?:s[ií]guenos|suscr[ií]bete)\s+(?:en|a)\s+(?:telegram|youtube|instagram|facebook|tiktok|nuestro\s+(?:canal|grupo))(?![\p{L}\p{N}_])|(?:descarga|descargar|instala|instalar)\s+(?:la\s+|nuestra\s+)?(?:app|aplicaci[oó]n|apk)(?![\p{L}\p{N}_])|(?:visita|visitar|entra|entrar)\s+(?:en\s+)?(?:www\.|https?:\/\/|nuestra\s+(?:web|p[aá]gina)))/iu;

// Débiles: se evalúan LÍNEA a LÍNEA (solo en los bordes) y se cuentan líneas
// distintas, no coincidencias ("Traducido por Argenteam" es UNA línea, no dos
// señales). Los TLD "me"/"pro" se han quitado: chocaban con el diálogo
// ("no.Me importa", "todo.Es posible"). `mx`/`yts` cubren el watermark YTS.
const SPAM_WEAK_LINE = /(?<![\p{L}\p{N}_])(?:(?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-z0-9][a-z0-9-]{0,62}\.)+(?:com|net|org|es|mx|tv|info|xyz|top|link|site|online|app|club|cc|io|biz|name|live|vip|bet)(?![\p{L}\p{N}_])|(?:opensubtitles|subdivx|tusubtitulo|argenteam|subtitulamos|elrincondelsub|podnapisi|subs4free|yts)(?![\p{L}\p{N}_])|(?:subt[ií]tulos?|subtitulad[oa]s?|traducci[oó]n|traducid[oa]s?|corregid[oa]s?|sincronizad[oa]s?)\s+(?:por|by)(?![\p{L}\p{N}_])|(?:canal|grupo)\s+de\s+telegram(?![\p{L}\p{N}_])|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/iu;

// Créditos de comunidades de traducción CONOCIDAS (y la fórmula "Subtítulos
// por …"). Una línea débil de este tipo es un crédito, no publicidad: el bloque
// típico "Subtítulos por / www.argenteam.net" son DOS líneas débiles y descartaba
// la pista entera (en producción, 11 de 98 respuestas en frío quedaron con 0
// pistas por esto; 34 de los 38 descartes eran Argenteam, subtitulos.es,
// AllSubs, SubDivX o asia-team). Ahora hacen falta >=2 líneas débiles Y al
// menos una que NO sea crédito (dominio/email desconocido, opensubtitles, yts…).
// OpenSubtitles y YTS siguen fuera de esta lista a propósito: su marca de agua
// SÍ es publicidad.
const SPAM_CREDIT_LINE = /(?<![\p{L}\p{N}_])(?:argenteam|subdivx|tusubtitulo|subtitulamos|elrincondelsub|allsubs|asia-team|subs-team|addic7ed|yyets|forominiseries|subtitulos\.es)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])(?:subt[ií]tulos?|subtitulad[oa]s?|traducci[oó]n|traducid[oa]s?|corregid[oa]s?|sincronizad[oa]s?)\s+(?:por|by)(?![\p{L}\p{N}_])/iu;

// Lista ampliada con créditos reales vistos en producción (27/10): Asia-Team (.tv),
// Subs-Team, Addic7ed, YYeTs y ForoMiniSeries; cada uno solo con su dominio exacto.
// Una línea es "solo crédito" si, quitando las frases de crédito y los tokens
// exactos de una comunidad conocida (su nombre o su dominio oficial, nunca un
// dominio compuesto o query ajena como `www.casino-argenteam.top` o
// `https://bet.top/?ref=argenteam`), ya no queda NINGUNA señal débil.
// Un punto FINAL de frase tras el nombre/dominio ("Traducido por Argenteam.", "www.subtitulos.es.")
// no impide la exención; un punto seguido de letra/número ("www.argenteam.net.bet-win.top") sí.
const SPAM_CREDIT_NAME_TOKEN = /(?<![\p{L}\p{N}_.-])(?:https?:\/\/)?(?:www\.)?(?:argenteam(?:\.net)?|(?:asia-team|subs-team)(?:\.(?:net|tv))?|(?:subdivx|tusubtitulo|elrincondelsub|addic7ed|yyets)(?:\.com)?|forominiseries(?:\.net)?|subtitulamos(?:\.tv)?|allsubs(?:\.org)?|subtitulos\.es)(?:\/[a-z0-9/_-]*)?(?![\p{L}\p{N}_?=&-]|\.[\p{L}\p{N}])/giu;
const SPAM_CREDIT_PHRASE = /(?<![\p{L}\p{N}_])(?:subt[ií]tulos?|subtitulad[oa]s?|traducci[oó]n|traducid[oa]s?|corregid[oa]s?|sincronizad[oa]s?)\s+(?:por|by)(?![\p{L}\p{N}_])/giu;
// Versiones NO globales para .test() (las /g guardan lastIndex entre llamadas).
const SPAM_CREDIT_PHRASE_TEST = new RegExp(SPAM_CREDIT_PHRASE.source, "iu");
// Marca de agua comercial: nunca se exime, ni siquiera dentro de un crédito.
const SPAM_WATERMARK = /(?<![\p{L}\p{N}_])(?:opensubtitles|yts)(?![\p{L}\p{N}_])/iu;
const isCreditOnlyLine = (line) =>
  SPAM_CREDIT_LINE.test(line) &&
  !SPAM_WEAK_LINE.test(line.replace(SPAM_CREDIT_NAME_TOKEN, " ").replace(SPAM_CREDIT_PHRASE, " "));

// Veredicto puro (exportado para tests). Devuelve { discard, reason, match }.
// Si `truncated` es true (el archivo superó MAX_ANALYZE_BYTES y se cortó a
// mitad), solo se extrae la cabeza: las últimas líneas del buffer truncado
// son diálogo de mitad de película, no el pie del subtítulo.
const spamVerdict = (text, truncated = false) => {
  // Marca/URL inequívoca: evaluada sobre cabeza (48 KB) y cola (16 KB) para no
  // ejecutar el regex Unicode sobre 300 KB de texto completo (ahorro de ~1.5 ms CPU).
  const spamSample = text.length <= 65536 ? text : text.slice(0, 49152) + "\n" + text.slice(-16384);
  const mStrong = SPAM_STRONG.exec(spamSample);
  if (mStrong) return { discard: true, reason: "fuerte", match: mStrong[0].slice(0, 60) };

  // Bordes sin partir el archivo entero (v1.4.4): .split(/\r?\n/) sobre un
  // SRT de 1 MB asignaba un array de miles de strings por candidato (0,8 ms
  // medidos); indexOf/lastIndexOf + slice recorre lo mismo con asignaciones
  // mínimas (0,007 ms). Semántica idéntica: primeras EDGE_LINES líneas
  // seguidas de las últimas, sin duplicar en archivos cortos, y saltando
  // líneas de más de MAX_SPAM_LINE caracteres.
  const headEnds = [];
  const headStarts = [0];
  for (let pos = -1; headEnds.length < EDGE_LINES && (pos = text.indexOf("\n", pos + 1)) !== -1;) {
    headEnds.push(pos);
    headStarts.push(pos + 1);
  }
  const edgeLines = [];
  const addLine = (start, end) => {
    // En CRLF el "\r" queda justo antes del "\n": se excluye para medir la
    // longitud real de la línea (el split anterior ya lo hacía).
    if (end < text.length && end > start && text.charCodeAt(end - 1) === 13) end -= 1;
    if (end - start <= MAX_SPAM_LINE) edgeLines.push(text.slice(start, end));
  };
  for (let i = 0; i < headEnds.length; i++) addLine(headStarts[i], headEnds[i]);
  if (headEnds.length < EDGE_LINES) {
    // Sin más saltos: lo que queda es la última línea (ya forma parte de la
    // "cabeza") y no hay cola que añadir.
    addLine(headStarts[headEnds.length], text.length);
  } else if (!truncated) {
    // Cola: últimas líneas completas hacia atrás, sin pisar la cabecera
    // (boundary = inicio de la primera línea que NO es de cabeza).
    const boundary = headStarts[EDGE_LINES];
    const tail = [];
    for (let end = text.length; tail.length < EDGE_LINES;) {
      const p = text.lastIndexOf("\n", end - 1);
      if (p === -1 || p + 1 < boundary) break;
      tail.unshift([p + 1, end]);
      end = p;
    }
    for (const [s, e] of tail) addLine(s, e);
  }

  const mEdge = SPAM_STRONG_EDGE.exec(edgeLines.join("\n"));
  if (mEdge) return { discard: true, reason: "fuerte", match: mEdge[0].slice(0, 60) };

  // Política de líneas débiles (v. datos de producción 27/10, ~1900 descargas en
  // 3 ventanas): casi todos los descartes eran créditos de traductores
  // ("Sincronizado por" + su web o su correo; 21 de 23 en la última ventana,
  // con una cola larga de sitios que ninguna lista de nombres cubre) y solo
  // ~1 de cada 8 parecía publicidad real. Por eso:
  //  - SIN frase de crédito: >=2 líneas débiles y alguna que no sea crédito de
  //    comunidad conocida -> descarta (URL+URL, URL+correo, Instagram, enlaces).
  //  - CON frase de crédito ("Traducido por", "Sincronizado por"…): una sola
  //    línea con sitio/correo ajeno es un crédito normal y se conserva; hacen
  //    falta >=2 líneas ajenas para descartar.
  //  - Marca de agua de OpenSubtitles/YTS: descarta siempre que haya >=2 líneas débiles.
  // Los términos FUERTES (apuestas, Telegram…) se evalúan antes y no cambian.
  const weakMatches = [];
  let adLines = 0; // líneas débiles que NO son solo crédito de comunidad conocida
  let hasCreditPhrase = false;
  let hasWatermark = false;
  for (const line of edgeLines) {
    const mWeak = SPAM_WEAK_LINE.exec(line);
    if (!mWeak) continue;
    weakMatches.push(mWeak[0].slice(0, 40));
    if (!isCreditOnlyLine(line)) adLines += 1;
    if (SPAM_CREDIT_PHRASE_TEST.test(line)) hasCreditPhrase = true;
    if (SPAM_WATERMARK.test(line)) hasWatermark = true;
  }
  if (weakMatches.length >= 2 && (hasWatermark || (hasCreditPhrase ? adLines >= 2 : adLines >= 1))) {
    return {
      discard: true,
      reason: `${weakMatches.length} líneas débiles`,
      match: weakMatches.slice(0, 4).join(" + "),
    };
  }
  return { discard: false, reason: "", match: "" };
};

// Presupuesto de SIRVIDAS por fuente: el tope de la respuesta sigue siendo
// 5+5 = 10 pistas verificadas. Pero se DESCARGAN hasta ANALYSIS_FETCH_PER_SOURCE
// candidatos para poder rellenar el cupo cuando los primeros son spam (ver
// bucle del router). Ver también SPAM_FILTER=log para medir sin descartar.
const ANALYSIS_BUDGET_PER_SOURCE = 5;

// TTL de una respuesta SIN pistas cuando no hubo ningún fallo (ambas fuentes
// respondieron bien y no hay clave rechazada): "no hay subtítulos" es el
// resultado normal para muchos capítulos. En producción (3 h): el 43 % de las
// respuestas en frío estaban vacías y el 48 % de esas eran el mismo título
// recalculado (mediana de 174 s entre repeticiones); además hubo títulos cuyas
// 8 candidatas eran enlaces muertos (404) y se volvían a descargar las 8 en cada
// petición. Con 300 s se evita ~27 % de esos recálculos. Con CUALQUIER fallo se
// mantiene 60 s para recuperarse rápido.
const EMPTY_TTL_S = 300;
const ANALYSIS_FETCH_PER_SOURCE = 8;

// Presupuesto temporal compartido entre las 2 oleadas de clasificación
// (6000 ms, igual al peor caso de una sola oleada con .zip en v1.4.5). La 2ª
// oleada solo se lanza si la 1ª terminó en <= WAVE2_MAX_W1_MS (4000 ms), y su
// timeout por candidato se acota al presupuesto restante. Así el peor caso
// global (fuentes 4,5 s + clasificación 6 s = 10,5 s) nunca se duplica.
const CLASSIFY_BUDGET_MS = 6000;
const WAVE2_MAX_W1_MS = 4000;

// v1.4.21: Escalonado entre peticiones concurrentes a OS-V3 para evitar ráfagas
// de 5 descargas en 0 ms que disparen rate limit HTTP 429 en su origen comunitario.
const DOWNLOAD_STAGGER_MS = 25;

const classifySubtitle = async (
  sub,
  pBase = VERCEL_UNZIPPER,
  spamMode = "drop",
  epSuffix = "",
  maxTimeoutMs = 0
) => {
  // Guard ANTES de cualquier acceso a sub.url (evita el crash en cascada
  // de Promise.all del 1.0.0).
  if (!sub || !isHttpUrl(sub.url)) return null;

  // Los .zip no se pueden analizar en crudo, PERO el proxy de Vercel los
  // descomprime y devuelve el SRT: se clasifican a través de él. El URL que
  // recibe Stremio es también el del proxy (Stremio no descomprime). En
  // series se adjunta &s=<season>&e=<episode> para que el proxy priorice el
  // episodio pedido dentro de los zips de temporada completa.
  const isZip = isCompressed(sub.url);
  const finalUrl = isZip ? `${pBase}${encodeURIComponent(sub.url)}${epSuffix}` : sub.url;

  try {
    // El proxy tarda más (descarga + descomprime): timeout amplio para zips,
    // acotado al presupuesto restante cuando se invoca desde la 2ª oleada.
    const defaultTimeout = isZip ? 6000 : 2000;
    const timeoutMs = maxTimeoutMs > 0 ? Math.min(defaultTimeout, maxTimeoutMs) : defaultTimeout;
    const { text, truncated } = await fetchSubtitle(finalUrl, timeoutMs, !isZip);

    // Validación del CONTENIDO antes de etiquetar. "🌎 Neutro" significaba
    // "vocabulario equilibrado", pero con HTML de error, binario (un zip sin
    // descomprimir), vacío o 0 matches lo que había era CERO datos, y de cero
    // datos no se puede afirmar que nada: eso es 📄 "sin clasificar".
    const sample = text.trim();
    const isHtml = /^\s*<(!doctype|html|head|meta|title|body|div|p|span|table)\b/i.test(sample);
    const looksLikeZip = sample.charCodeAt(0) === 0x50 && sample.charCodeAt(1) === 0x4b;
    if (!sample || looksLikeZip || isHtml) {
      console.error("[classify]", sub.source, "contenido que no es texto de subtítulo");
      // El origen devolvió algo que no es un subtítulo (página de error,
      // binario…): es un FALLO transitorio, no un veredicto léxico.
      return unclassified(sub, finalUrl, true);
    }

    // Pistas de códigos regionales no confirmados (OS-V3 `spl`/`spn`): si el texto
    // no parece español, se descartan en vez de servirlas como "📄 Español".
    if (sub.verifyEs && !looksSpanish(text)) {
      console.log(`[classify] descartado por idioma (no parece español; código ${sub.rawLang}) [${sub.source}]`);
      return null;
    }

    // Anti-spam: se descarta la pista entera con el texto que ya está en
    // memoria (publicidad incrustada). null = fuera de la lista; un descarte
    // deliberado NO es una respuesta degradada, así que no marca FAILED ni
    // baja el TTL. Con SPAM_FILTER=log (modo sombra) se registra el veredicto
    // pero la pista se sirve: sirve para medir en producción qué se perdería.
    const spam = spamVerdict(text, truncated);
    if (spam.discard) {
      const detail = spam.match ? `: "${spam.match}"` : "";
      if (spamMode === "log") {
        console.log(`[classify] SPAM_FILTER=log: se habría descartado (${spam.reason}${detail}) [${sub.source}]`);
      } else {
        console.log(`[classify] descartado por spam (${spam.reason}${detail}) [${sub.source}]`);
        return null;
      }
    }

    const sdh = isSdh(text);
    const sdhTag = sdh ? " (SDH)" : "";
    const isPlatform = isPlatformRelease(sub);

    const diag = {};
    const scored = scoreText(text, diag);
    // len = tamaño del texto analizado en KB (caracteres/1024, redondeado hacia
    // arriba); "+" si se cortó en MAX_ANALYZE_BYTES.
    const lenTag = `${Math.ceil(text.length / 1024)}k${truncated ? "+" : ""}`;
    const contentHash = hashContent(text);
    // `rl=<idioma crudo>` solo si el proveedor declara algo distinto de "spa"/"es":
    // permite cruzar su etiqueta con el veredicto léxico de la misma pista.
    const rawLang = typeof sub.rawLang === "string" ? sub.rawLang : "";
    const rlTag = RAW_LANG_DEFAULTS.has(rawLang) ? "" : ` rl=${rawLang}`;
    // Texto en portugués (guarda de `scoreText`): no es español, se descarta. Antes se
    // servía como "📄 Español (sin clasificar)" (visto: SubDL `br_pt` durante 28 h).
    if (!scored && diag.reason === "portugués") {
      console.log(`[classify] descartado por idioma (portugués) [${sub.source}]`);
      return null;
    }
    const brief = (flag) =>
      `${flag}${isPlatform ? " [PLAT]" : ""}${sdh ? " SDH" : ""} es=${diag.es ?? 0} lat=${diag.lat ?? 0} s=${diag.strong ?? 0} len=${lenTag}${rlTag}${
        diag.reason ? ` (${diag.reason})` : ""
      }`;
    if (!scored) {
      // Ni una sola palabra del léxico (o solo débiles / guarda de portugués):
      // el texto llegó y se analizó sin error → no es fallo transitorio → TTL normal.
      const u = unclassified(sub, finalUrl, false, sdh);
      u[SCORE] = brief("📄");
      u[CONTENT_HASH] = contentHash;
      return u;
    }

    return {
      id: sub.id,
      url: finalUrl,
      lang: LANG_ISO_ES,
      label: `${scored.flag}${sdhTag} (${sub.source})`,
      [SCORE]: brief(scored.flag),
      [CONTENT_HASH]: contentHash,
      [IS_PLATFORM]: isPlatform,
      [RELEASE_SOURCE]: releaseSourceOf(sub),
    };
  } catch (error) {
    // Descarte permanente sin penalizar el TTL:
    //  - En URL directa (!isZip): HTTP 404 o 410 (enlace muerto en el CDN).
    //  - En URL del proxy (isZip): HTTP 410 (origen 404/410 mapeado por el
    //    proxy) o HTTP 422 (el zip no tiene subtítulos válidos / falta el
    //    episodio en el pack). Un HTTP 404 crudo sobre `isZip` significa que
    //    el propio endpoint del proxy no existe (PROXY_URL rota o caída de
    //    enrutamiento) y SÍ debe contar como FAILED (TTL 60 s).
    const isPermanentDiscard = isZip
      ? /\bHTTP 4(?:10|22)\b/.test(error.message)
      : /\bHTTP 4(?:04|10)\b/.test(error.message);
    if (isPermanentDiscard) return { [DISCARDED_404]: true };
    console.error("[classify]", sub.source, error.message);
    // Timeout / red caída / 429 / 5xx / 404 de proxy: fallo transitorio → TTL corto.
    return unclassified(sub, finalUrl, true);
  }
};

// Normalización canónica de la configuración para la clave de caché.
// Si la configuración incluye una clave válida de SubDL (string de >=8 caracteres),
// se normaliza a "k_subdl". Dado que SubDL devuelve los mismos resultados por ID
// independientemente de la clave válida y las URLs de descarga no contienen credenciales,
// colapsar a "k_subdl" unifica la caché, maximiza los Cache HITs y neutraliza
// cualquier intento de cache-busting con tokens arbitrarios.
// Si no hay clave válida o es de tipo no string, se normaliza a "" (caché pública de OS-V3).
const getCanonicalConfigStr = (config) =>
  typeof config?.subdlKey === "string" && config.subdlKey.trim().length >= 8
    ? "k_subdl"
    : "";

// Exportado solo para tests (corpus etiquetado en test_worker.js; el timeout
// de OS-V3 para fijar su valor en una aserción; y el veredicto anti-spam con
// sus dos presupuestos para las aserciones de v1.4.2/1.4.3).
export { looksSpanish, NEAR_ES_LANG_RE, scoreText, subtitleCacheUrl, OS_V3_TIMEOUT_MS, spamVerdict, ANALYSIS_BUDGET_PER_SOURCE, ANALYSIS_FETCH_PER_SOURCE, CLASSIFY_BUDGET_MS, WAVE2_MAX_W1_MS, rateLimitFallback, RATE_MAP_CAP, readCapped, MAX_ANALYZE_BYTES, isSdh, hashContent, SDH_MIN_MATCHES, SDH_ACOUSTIC_RE, dedupWave, getCanonicalConfigStr, isPlatformRelease, PLATFORM_RELEASE_RE, IS_PLATFORM, RELEASE_SOURCE, releaseSourceOf };

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);

    // Logo y favicon propios (antes el logo apuntaba a otro workers.dev: si
    // ese worker muere, el logo se rompía; además el logo del manifest debe
    // ser HTTPS propio).
    //
    // Fallback: desde la v1.3.2 estos ficheros viven en public/ y los sirve
    // el edge de Cloudflare como Workers Static Assets (sin invocar al
    // Worker: requests gratis/ilimitados y sin logs). Este bloque solo se
    // ejecutaría si el asset desapareciera del despliegue; mantiene el
    // comportamiento idéntico (Cache API del borde + x-cache).
    if (pathParts[0] === "logo.svg" || pathParts[0] === "favicon.ico") {
      const cached = await cacheMatch(request);
      if (cached) {
        const hit = new Response(cached.body, cached);
        hit.headers.set("x-cache", "HIT");
        return hit;
      }
      const fresh = new Response(LOGO_SVG, {
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=86400",
        },
      });
      cachePut(ctx, request, fresh.clone());
      const miss = new Response(fresh.body, fresh);
      miss.headers.set("x-cache", "MISS");
      return miss;
    }

    // Página de configuración (con config pre-rellenada si viene en la URL).
    // no-store: la página puede llevar la clave de SubDL del usuario en el
    // input; no debe guardarla el caché del navegador ni del proxy.
    if (pathParts.length === 0 || pathParts[pathParts.length - 1] === "configure") {
      let existingConfig = {};
      if (pathParts.length > 1) existingConfig = parseConfig(pathParts[0]);
      return new Response(getConfigureHTML(existingConfig), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      });
    }

    // Rutas soportadas: /[config]/manifest.json | /manifest.json |
    //                    /[config]/subtitles/<type>/<id>.json
    let configStr = "";
    let actionIndex = 0;
    if (pathParts.length > 1 && (pathParts[1] === "manifest.json" || pathParts[1] === "subtitles")) {
      configStr = pathParts[0];
      actionIndex = 1;
    } else if (pathParts[0] === "manifest.json" || pathParts[0] === "subtitles") {
      actionIndex = 0;
    } else {
      return new Response("Not found", { status: 404 });
    }

    const config = parseConfig(configStr);

    if (pathParts[actionIndex] === "manifest.json") {
      return jsonResponse(getManifest(url.host));
    }

    if (pathParts[actionIndex] === "subtitles") {
      // Clave de caché canónica; se rellena al validar la ruta y se usa también
      // en el catch (si el error llega antes, se cae a la URL cruda).
      let cacheReq = null;
      let canonicalConfigStr = "";
      try {
        const type = pathParts[actionIndex + 1];
        const rawId = (pathParts[actionIndex + 2] || "").replace(".json", "");
        // Algunos clientes de Stremio envían los ":" de las series codificados
        // como %3A (p.ej. /subtitles/series/tt39087958%3A1%3A2.json). Sin
        // decodificar, la validación rechazaba TODAS esas series con 400.
        let fullId = rawId;
        try {
          fullId = decodeURIComponent(rawId);
        } catch {
          /* segmento malformado (% suelto): se valida tal cual abajo */
        }

        // Validación de entrada: type e id van a parar a URLs de terceros.
        if (!["movie", "series"].includes(type) || !/^tt\d+(:\d+:\d+)?$/.test(fullId)) {
          console.error(`[subtitles] id rechazado (type=${type} raw=${rawId} decoded=${fullId})`);
          return new Response("Bad request", { status: 400 });
        }

        let imdbId = fullId;
        let season = null;
        let episode = null;
        if (fullId.includes(":")) {
          const parts = fullId.split(":");
          imdbId = parts[0];
          season = parts[1];
          episode = parts[2];
        }

        // Cache: Stremio repite peticiones; sin cache descargas 5 SRT en cada una.
        //
        // Clave CANÓNICA (config, type, id): la URL de la petición puede traer
        // params de query del cliente y el id en %3A o en ":"; usar la URL
        // cruda fragmentaba la caché en variantes y cada una pagaba las 5
        // descargas. Se normaliza todo a la forma exacta de la ruta.
        // Además, si la config no aporta clave válida de SubDL, se normaliza a "" para
        // compartir la entrada global pública. Si aporta clave válida, se unifica en "k_subdl".
        canonicalConfigStr = getCanonicalConfigStr(config);
        cacheReq = new Request(subtitleCacheUrl(url.origin, canonicalConfigStr, type, fullId));
        let cached = await cacheMatch(cacheReq);
        // Clave rechazada por SubDL: su respuesta (solo OS-V3) vive en un namespace
        // propio de esa clave, no en el compartido `k_subdl` (anti-envenenamiento).
        const keyCacheUrl = canonicalConfigStr
          ? subtitleCacheUrl(url.origin, `k_${hashStr(String(config.subdlKey))}`, type, fullId)
          : null;
        if (!cached && keyCacheUrl) cached = await cacheMatch(new Request(keyCacheUrl));
        if (cached) {
          const hitRes = new Response(cached.body, cached);
          hitRes.headers.set("x-cache", "HIT");
          return hitRes;
        }

        // Límite por IP, solo en peticiones sin caché (las cacheadas no cuestan
        // nada arriba). RATE_LIMIT: peticiones/minuto e IP, 0 = desactivado.
        // Sin cabecera cf-connecting-ip (tests, entornos sin Cloudflare) no se
        // limita, para no bloquear a todos bajo la misma clave vacía.
        const ip = request.headers.get("cf-connecting-ip");
        const limit = Number(env.RATE_LIMIT ?? 120);
        const retryAfter = await checkRateLimit(env, ip, limit);
        if (retryAfter) {
          return new Response(JSON.stringify({ error: "rate limit" }), {
            status: 429,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              "Retry-After": String(retryAfter),
            },
          });
        }

        const tStart = Date.now();
        const [osSubs, sdlSubs] = await Promise.allSettled([
          getOpenSubtitlesV3(type, fullId),
          getSubDL(imdbId, season, episode, config.subdlKey, type),
        ]);

        // Diagnóstico por fuente: permite ver en los logs de Cloudflare
        // cuánto aporta cada una y cuál falla.
        console.log(
          `[subtitles] ${type}/${fullId}: ` +
            `OS-V3=${osSubs.status === "fulfilled" ? osSubs.value.length : "ERROR " + osSubs.reason?.message} ` +
            `SubDL=${sdlSubs.status === "fulfilled" ? sdlSubs.value.length : "ERROR " + sdlSubs.reason?.message}` +
            (config.subdlKey ? "" : " (sin clave)")
        );

        const rawSubs = [
          ...(osSubs.status === "fulfilled" ? osSubs.value : []),
          ...(sdlSubs.status === "fulfilled" ? sdlSubs.value : []),
        ];

        // Telemetría de idiomas: qué declara cada proveedor para sus pistas
        // (`rawLang`) y qué códigos "parecidos a español" descartó el filtro de
        // OS-V3 ("descartados"). Solo se emite si hay pistas o descartes.
        {
          const osList = osSubs.status === "fulfilled" ? osSubs.value : [];
          const sdlList = sdlSubs.status === "fulfilled" ? sdlSubs.value : [];
          const near = tallyToString(osList.nearMiss);
          const sdlDrop = tallyToString(sdlList.droppedLang);
          if (osList.length || sdlList.length || near || sdlDrop) {
            console.log(
              `[subtitles] langs ${type}/${fullId}: OS-V3 ${langTally(osList) || "-"}${near ? ` (descartados: ${near})` : ""}` +
                ` | SubDL ${langTally(sdlList) || "-"}${sdlDrop ? ` (descartados: ${sdlDrop})` : ""}`
            );
          }
        }

        // Descarte de entradas que no se pueden SERVIR: formatos que nadie
        // descomprime (.rar y cía) y .zip cuyo host no está en la allowlist
        // del proxy de Vercel (esa URL acabaría en 403/415: mejor no ofrecerla
        // que ofrecer una entrada que falla al reproducir).
        const serveable = [];
        let dropped = 0;
        for (const sub of rawSubs) {
          if (isUnserveable(sub.url) || (isCompressed(sub.url) && !isProxyable(sub.url))) {
            dropped += 1;
            continue;
          }
          serveable.push(sub);
        }
        if (dropped) {
          console.log(`[subtitles] ${dropped} entradas descartadas (formato o host no servible)`);
        }

        // Deduplicación por URL (OS y SubDL devuelven los mismos títulos).
        const seenUrls = new Set();
        const deduped = [];
        for (const sub of serveable) {
          const key = sub.url.split("#")[0];
          if (seenUrls.has(key)) continue;
          seenUrls.add(key);
          deduped.push(sub);
        }

        // Sin resultados: se devuelve lista vacía real (adiós al "diag_1" de pastebin).
        // Con caché negativa de 60 s: un proveedor caído no se paga en cada
        // petición del mismo título.
        if (deduped.length === 0) {
          console.log(`[subtitles] 0 resultados para ${type}/${fullId}`);
          const emptyUnusable = sdlSubs.status === "fulfilled" && sdlSubs.value?.unusable === true;
          // Vacía "limpia" (ambas fuentes respondieron y SubDL no está rechazado): TTL largo.
          const answeredOk = osSubs.status === "fulfilled" && sdlSubs.status === "fulfilled" && !emptyUnusable;
          const empty = jsonResponse({ subtitles: [] }, answeredOk ? EMPTY_TTL_S : 60);
          // Igual que el `put` final: con SubDL "no utilizable" (clave falsa o
          // rechazada) la lista vacía es culpa de ESA clave; escribirla en el
          // `k_subdl` compartido dejaba sin SubDL a los demás durante 60 s.
          cachePut(ctx, canonicalConfigStr && emptyUnusable ? new Request(keyCacheUrl) : cacheReq, empty);
          return empty;
        }

        // Política estricta: SOLO se publican pistas verificadas.
        // v1.4.6 — Descarga en DOS oleadas por fuente (5 + 3):
        //  - 1ª oleada: hasta ANALYSIS_BUDGET_PER_SOURCE (5) por fuente. Si
        //    las 5 están limpias (el caso más común), no se descargan las 3 de
        //    sobrepaso: ~37 % menos CPU y red, sin saturar el límite de 6
        //    conexiones simultáneas de Cloudflare ni provocar 429 en OS-V3.
        //  - 2ª oleada: solo para las fuentes que tras la 1ª oleada quedaron
        //    con <5 limpias y aún tienen candidatos en la reserva (hasta
        //    ANALYSIS_FETCH_PER_SOURCE = 8 en total por fuente).
        const pBase = proxyBase(env);
        const spamMode = env && env.SPAM_FILTER === "log" ? "log" : "drop";
        const epSuffix =
          season && episode && /^\d+$/.test(season) && /^\d+$/.test(episode)
            ? `&s=${season}&e=${episode}`
            : "";
        const analyzed = new Array(deduped.length).fill(null);
        const wave1Idx = [];
        const wave2BySource = { "OS-V3": [], "SubDL": [] };
        const seenPerSource = { "OS-V3": 0, "SubDL": 0 };
        for (let i = 0; i < deduped.length; i++) {
          const src = deduped[i].source;
          seenPerSource[src] = (seenPerSource[src] || 0) + 1;
          if (seenPerSource[src] <= ANALYSIS_BUDGET_PER_SOURCE) {
            wave1Idx.push(i);
          } else if (seenPerSource[src] <= ANALYSIS_FETCH_PER_SOURCE) {
            wave2BySource[src].push(i);
          }
        }

        const tWave1 = Date.now();
        let osStaggerW1 = 0;
        await Promise.all(
          wave1Idx.map(async (i) => {
            if (deduped[i].source === "OS-V3") {
              const delay = (osStaggerW1++) * DOWNLOAD_STAGGER_MS;
              if (delay > 0) await new Promise((r) => setTimeout(r, delay));
            }
            analyzed[i] = await classifySubtitle(deduped[i], pBase, spamMode, epSuffix);
          })
        );
        const w1Ms = Date.now() - tWave1;

        // Deduplicación por contenido en 1ª oleada: se descartan pistas idénticas
        // (mismo hash de texto) para no saturar el cupo con clones de la misma traducción.
        const seenHashes = new Set();
        let duplicadosContenido = dedupWave(wave1Idx, analyzed, seenHashes);

        const cleanWave1 = { "OS-V3": 0, "SubDL": 0 };
        for (const i of wave1Idx) {
          const s = analyzed[i];
          if (s && !s[FAILED] && !s[DISCARDED_404] && !s[DISCARDED_DUPLICATE]) {
            cleanWave1[deduped[i].source] += 1;
          }
        }

        const wave2Idx = [];
        for (const src of ["OS-V3", "SubDL"]) {
          if (cleanWave1[src] < ANALYSIS_BUDGET_PER_SOURCE && wave2BySource[src].length > 0) {
            wave2Idx.push(...wave2BySource[src]);
          }
        }
        let w2Ms = 0;
        let wave2Ran = false;
        const remainingMs = CLASSIFY_BUDGET_MS - w1Ms;
        if (wave2Idx.length > 0 && w1Ms <= WAVE2_MAX_W1_MS && remainingMs >= 1000) {
          wave2Ran = true;
          const tWave2 = Date.now();
          let osStaggerW2 = 0;
          await Promise.all(
            wave2Idx.map(async (i) => {
              if (deduped[i].source === "OS-V3") {
                const delay = (osStaggerW2++) * DOWNLOAD_STAGGER_MS;
                if (delay > 0) await new Promise((r) => setTimeout(r, delay));
              }
              analyzed[i] = await classifySubtitle(deduped[i], pBase, spamMode, epSuffix, remainingMs);
            })
          );
          w2Ms = Date.now() - tWave2;

          // Deduplicación por contenido en 2ª oleada contra pistas ya vistas
          duplicadosContenido += dedupWave(wave2Idx, analyzed, seenHashes);
        } else if (wave2Idx.length > 0) {
          console.log(`[subtitles] 2ª oleada omitida por presupuesto de tiempo (w1=${w1Ms}ms)`);
        }

        // Los fallos de descarga (FAILED) NO se sirven: no pasaron por el
        // filtro anti-spam, así que no son pistas verificadas. Solo cuentan
        // para degradar el TTL si su fuente no alcanzó el cupo de 5 limpias.
        const kept = { "OS-V3": 0, "SubDL": 0 };
        const failed = { "OS-V3": 0, "SubDL": 0 };
        let descartes404 = 0;
        const scoreLog = [];
        const subtitles = [];
        for (let i = 0; i < analyzed.length; i++) {
          const s = analyzed[i];
          const source = deduped[i].source;
          if (!s) continue;
          if (s[DISCARDED_404]) {
            descartes404 += 1;
            continue;
          }
          if (s[DISCARDED_DUPLICATE]) {
            continue;
          }
          if (s[FAILED]) {
            failed[source] += 1;
            continue;
          }
          if (kept[source] >= ANALYSIS_BUDGET_PER_SOURCE) continue;
          kept[source] += 1;
          subtitles.push(s);
          if (s[SCORE]) scoreLog.push(`${source}:${s[SCORE]}`);
        }

        // Ranking (v1.4.22): SOLO las pistas con etiqueta de servicio
        // de streaming (IS_PLATFORM) van delante; el resto conserva el orden del
        // proveedor (sort estable, no se descarta nada). WEB-DL/BluRay NO ordenan:
        // indican contra qué vídeo está sincronizado el subtítulo, y sin el
        // `filename` del usuario no se sabe cuál le conviene (quien reproduce un
        // BluRay recibía las pistas web primero). Ese ranking necesita el nombre
        // del fichero (extra de Stremio) y una clave de caché que lo contemple.
        subtitles.sort((a, b) => (b[IS_PLATFORM] ? 1 : 0) - (a[IS_PLATFORM] ? 1 : 0));

        // TTL según fiabilidad (v1.4.5/1.4.6, por fuente): una fuente se
        // considera degradada si rechazó entera (`sourceFailed`), si tuvo >=1
        // fallo de descarga Y no alcanzó su cupo de ANALYSIS_BUDGET_PER_SOURCE
        // pistas limpias, o si la respuesta final quedó completamente vacía
        // (`subtitles.length === 0`, p.ej. cuando todos los candidatos eran
        // spam: caché negativa de 60 s en vez de 2 h vacía).
        const anyDegradedSource = Object.keys(failed).some(
          (src) => failed[src] > 0 && kept[src] < ANALYSIS_BUDGET_PER_SOURCE
        );
        const sourceFailed = osSubs.status === "rejected" || sdlSubs.status === "rejected";
        // Sin pistas Y sin fallos (todo descartado por spam/404/duplicado): TTL largo,
        // salvo que SubDL esté "no utilizable" (clave rechazada: puede arreglarse antes).
        const sdlUnusableLate = sdlSubs.status === "fulfilled" && sdlSubs.value?.unusable === true;
        const degraded = anyDegradedSource || sourceFailed;
        const ttl = degraded ? 60 : subtitles.length === 0 ? (sdlUnusableLate ? 60 : EMPTY_TTL_S) : 7200;
        if (ttl === 60) {
          console.log(`[subtitles] respuesta degradada (fallo de clasificación o fuente): TTL ${ttl}s`);
        } else if (ttl !== 7200) {
          console.log(`[subtitles] sin pistas tras analizar y sin fallos: TTL ${ttl}s`);
        }
        const platformCount = subtitles.filter((s) => s[IS_PLATFORM]).length;
        const webCount = subtitles.filter((s) => s[RELEASE_SOURCE] === "web").length;
        const discCount = subtitles.filter((s) => s[RELEASE_SOURCE] === "disco").length;
        console.log(
          `[subtitles] resumen ${type}/${fullId}: total=${Date.now() - tStart}ms w1=${w1Ms}ms w2=${w2Ms}ms ` +
            `descargas=${wave1Idx.length + (wave2Ran ? wave2Idx.length : 0)} ` +
            `servidas=${subtitles.length} (OS-V3=${kept["OS-V3"]},SubDL=${kept["SubDL"]}) ` +
            `plataforma=${platformCount}/${subtitles.length} web=${webCount} disco=${discCount} ` +
            `fallos=${failed["OS-V3"] + failed["SubDL"]} descartes404=${descartes404} duplicados=${duplicadosContenido} ttl=${ttl}s` +
            (scoreLog.length ? ` | ${scoreLog.join(" | ")}` : "")
        );
        const response = jsonResponse({ subtitles }, ttl, { "x-cache": "MISS" });
        // - Sin clave válida: namespace público.
        // - SubDL "no utilizable" (clave falsa/rechazada/cuota): la respuesta es
        //   solo OS-V3 -> namespace de ESA clave (nunca `k_subdl`).
        // - Resto, incluido SubDL caído (ttl 60 s = caché negativa): `k_subdl`.
        const sdlUnusable = sdlSubs.status === "fulfilled" && sdlSubs.value?.unusable === true;
        cachePut(
          ctx,
          canonicalConfigStr && sdlUnusable ? new Request(keyCacheUrl) : cacheReq || request,
          response
        );
        return response;
      } catch (err) {
        // Los errores de una request no deben romper la respuesta de Stremio,
        // pero al menos ahora quedan registrados. Caché negativa corta (60 s)
        // para no repetir el fallo en cada petición del mismo título.
        console.error("[subtitles] error inesperado:", err.message);
        const failed = jsonResponse({ subtitles: [] }, 60, { "x-cache": "MISS" });
        cachePut(ctx, cacheReq || request, failed);
        return failed;
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

// ============================================================================
// RESUMEN DE CAMBIOS vs 1.0.0
// ============================================================================
// 1. [CRÍTICO] XSS: existingConfig.subdlKey se interpolaba sin escapar en el
//    HTML -> inyección arbitraria en el origen del worker. Ahora usa esc().
// 2. [CRÍTICO] Los botones "Instalar/Copiar" no funcionaban: /\//g dentro del
//    template literal se convertía en ///g (comentario de línea) en el
//    navegador -> SyntaxError. Ahora se usa split/join sin regex.
// 3. [CRÍTICO] Crash en cascada: classifySubtitle tocaba sub.url fuera de su
//    try y Promise.all perdía TODAS las subs por una entrada malformada.
//    Ahora hay guard + filtro con filter(Boolean).
// 4. Un sub sin url en getSubDL vaciaba la fuente entera -> filtrado por
//    entrada, no global.
// 5. SubDL nunca se clasificaba (slice(0,5) tras empujar OS primero) ->
//    presupuesto de análisis por fuente (3 OS + 3 SubDL).
// 6. El timeout solo cubría cabeceras -> AbortController activo durante
//    arrayBuffer()/json() (abort corta el stream del body).
// 7. Duplicados OS/SubDL sin dedup + IDs con Math.random -> dedup por URL e
//    IDs deterministas (hash).
// 8. Firma del manifest inválida con descripción dinámica -> descripción estática.
// 9. SRTs Windows-1252 rompían los acentos del diccionario -> fallback de
//    codificación por BOM/caracteres de reemplazo.
// 10. "0 resultados" simulado con pastebin -> lista vacía real + log.
// 11. "(SubDL)" hardcodeado en zips -> usa sub.source.
// 12. Sin caché -> Cache API con TTL implícito y ctx.waitUntil.
// 13. Logo del manifest en otro workers.dev -> /logo.svg propio.
// 14. type/fullId/imdbId sin validar -> whitelist de tipo y regex de ID
//     (reduce superficie de SSRF hacia los hosts de terceros).
// 15. Plurales no detectados por \b...\b -> sufijos (?:es)? / s?.
// 16. Umbral fijo +2 -> margen proporcional al total de matches.
// 17. host no usado en getConfigureHTML -> eliminado; la clave va en type="password".
// 18. Sin logging -> console.error con mensajes (sin exponer la API key).
// 19. [MÓVIL] La app móvil de Stremio agrupa los subtítulos por código de
//     idioma y con `lang` libre ("🇲🇽 Latino (OS-V3)") no mostraba NINGUNO de
//     los resultados en el selector del reproductor (escritorio, más
//     tolerante, sí los listaba). v1.2.0 añadió modos configurables (iso /
//     híbrido "spa 🇲🇽 Latino"); tras probarlo en el dispositivo, el híbrido
//     siguió sin listarse: el formato con el código dentro de `lang` no basta.
// 20. [PROTOCOLO] Formato canónico `lang` + `label` (sin config): `lang` es
//     SIEMPRE el código ISO 639-2 "spa" —lo que agrupa el móvil y con lo que
//     matchea la selección automática de idioma— y `label` lleva la etiqueta
//     visible ("🇲🇽 Latino (OS-V3)"), que el escritorio (stremio-web) muestra
//     tal cual. Retrocompatible: las URLs de config de 1.2.0 (langMode/
//     isoLang) se ignoran y sirven este mismo formato.
//
// v1.3.1 (auditoría de código y de los despliegues en vivo, 18/10/2026):
// 21. [FIRMA] El bloque stremioAddonsConfig estaba generado con el manifest
//     de v1.2.0 (commit f8eff37): desde la v1.3.0 dejaba de validar (la
//     firma cubre el manifest byte a byte, incluido `version` y el `logo`,
//     que además depende del host). Eliminado: una firma inválida es peor
//     que ninguna. Para volver a firmar: publica el manifest actual en
//     stremio-addons.net y pega aquí el bloque que devuelva.
// 22. [PROXY] Entradas que no se pueden SERVIR descartadas al fusionar
//     fuentes: .rar y cía (Stremio no descomprime y el proxy solo hace zip)
//     y .zip cuyo host no está en la allowlist del proxy (terminaría en
//     403/415). Antes se publicaban igual, como entradas irreproducibles.
// 23. [CLASIFICACIÓN] Contenido que no es texto de subtítulo (HTML de error,
//     binario, vacío) o con 0 matches léxicos ya no cae en "🌎 Neutro" por
//     defecto: se etiqueta "📄 sin clasificar". "Neutro" solo se afirma con
//     datos reales.
// 24. [MEMORIA] Análisis acotado a 1 MB (antes arrayBuffer() completo: un
//     fichero enorme cargaba cientos de MB en un isolate de 128 MB).
// 25. [CACHÉ] Cache-Control explícito en las respuestas JSON: 2 h para las
//     listas y 60 s para vacías/error (caché negativa: un proveedor caído ya
//     no cuesta 2,5 s de timeouts por cada petición del mismo título). Antes
//     el TTL era el Edge TTL por defecto de la plataforma (120 min).
// 26. [ABUSO] Rate limit por IP en memoria del isolate: 120 peticiones sin
//     caché por minuto e IP por defecto, configurable con RATE_LIMIT (0 =
//     off), con 429 + Retry-After. Atenuador, no defensa: la regla seria va
//     en el panel de Cloudflare.
// 27. [IDIOMA] Filtro de OpenSubtitles V3 ampliado a variantes del código
//     (es-ES, es-419, esp, span): antes solo "spa" o "es" exacto.
//
// v1.4.2 (19/10/2026):
// 28. [SPAM] Filtro anti-spam en dos niveles durante la clasificación (ver
//     SPAM_STRONG / SPAM_WEAK_LINE): la publicidad incrustada (apuestas,
//     Telegram/WhatsApp, CTAs de app/web) descarta la pista entera sin coste
//     de red, porque se evalúa el texto que ya se descarga para el análisis.
// 29. [CALIDAD] Política estricta: solo se sirven pistas clasificadas. Las
//     entradas sin presupuesto de análisis (no verificables sin descargarlas)
//     ya no se publican como "📄 sin clasificar" — eran un coladero de spam.
// 30. [LÍMITES] Presupuesto de análisis 3 → 5 por fuente: tope de 10 pistas
//     verificadas por título.
// 31. [OS-V3] Timeout de la fuente 2500 → 4500 ms (ver getOpenSubtitlesV3).
//
// v1.4.3 (19/10/2026) — auditoría de la 1.4.2:
// 32. [CPU] scoreText recorría cada diccionario fuerte dos veces (esMatches/
//     latMatches + strongTotal): ahora una sola. ~2× menos coste léxico.
// 33. [CPU] Anti-spam acotado a los bordes (EDGE_LINES=30 por lado) y con
//     corte de líneas patológicas (MAX_SPAM_LINE=300): el rastreo por línea
//     pasa de varios ms a por debajo de 1 ms por SRT de 80 KB.
// 34. [ReDoS] El corte de línea también elimina el backtracking cuadrático de
//     SPAM_WEAK_LINE (20k car. → 0,5 s; 80k → 9,6 s antes).
// 35. [FP] Las frases-CTA ambiguas (síguenos/instala/únete/entra/tragamonedas
//     en línea…) solo descartan en cabecera/pie, no en mitad del diálogo.
// 36. [FUGAS] Una descarga fallida ya no publica un "📄" sin pasar por spam:
//     se descarta y solo degrada el TTL. Un SRT UTF-16 con BOM se decodifica
//     y se filtra (antes el léxico y el anti-spam lo ignoraban).
// 37. [COBERTURA] Se descargan hasta 8 candidatos por fuente y se sirven las
//     5 primeras limpias (antes 5 candidatos: los contaminados vaciaban el
//     título). DESCARTES por spam siguen sin degradar el TTL.
// 38. [OPS] SPAM_FILTER=log (modo sombra) mide sin descartar; sourceFailed ya
//     puede activarse (las fuentes propagan el error) y baja el TTL a 60 s.
// 39. [LÉXICO] Fuera las raíces abiertas que colaban "conducta", "Jodie" o
//     "estacionario": formas explícitas. El dialecto exige ≥1 término fuerte
//     (9× "ustedes" ya no da Latino). PROXY_URL exige https; CI fija wrangler.
