// ============================================================================
// HispaSubs — Cloudflare Worker v1.4.41
// Addon de Stremio: subtítulos en español clasificados por dialecto.
//
// v1.4.41 (07/11/2026):
//  - [CRÉDITOS DE TRADUCTORES OPCIONAL] Nueva variable `SPAM_CREDITS` (`1` o `true`; apagada por
//    defecto): una pista con frase de crédito ("Traducido por", "Subtítulos por"…) y sin marca de agua
//    de OpenSubtitles/YTS ya no se descarta por líneas débiles (créditos de comunidades que no están en
//    la lista de conocidas, p. ej. SupernaturalForo/GrupoTS, TheSubFactory). Los términos fuertes y la
//    marca de agua siguen descartando. Con la variable sin definir el comportamiento es idéntico al 1.4.40.
//
// v1.4.40 (05/11/2026):
//  - [FILTRO DE IDIOMA OPCIONAL] Nueva variable `LANG_VERIFY` (`1`, `true` o `all`; apagada por
//    defecto): aplica `looksSpanish` a TODAS las fuentes (SubDL y OS-V3 `spa`), no solo a OS-V3
//    `spl`/`spn`, y descarta las pistas cuyo texto no parece español (log `descartado por idioma`).
//    Con la variable sin definir el comportamiento es idéntico al de la 1.4.39.
//
// v1.4.39 (01/11/2026):
//  - [SIN CAMBIOS DE CLASIFICACIÓN] `scoreText` base y los diccionarios base (incluido `decís`) son
//    IDÉNTICOS a los de la 1.4.38: esta versión solo añade medición. El blindaje de términos
//    fuertes y el override sin oposición fuerte se evaluarán con los datos de `refnombre=`.
//  - [TELEMETRÍA / REFERENCIA POR NOMBRE] Si el nombre declarado del subtítulo (`sub.releaseName`)
//    indica un dialecto inequívoco (`detectFilenameDialect`), se registra
//    `[classify] refnombre=<lat|es> veredicto=<Castellano|Latino|Neutro|sinclasificar> …` y el
//    contador `refnombre=<n>` en `[subtitles] resumen` (solo si >0).
//  - [LÉXICO / CANDIDATOS EXTRA] Nuevos patrones `ES_VOSOTROS_RE` (terminaciones verbales `-áis`/`-éis`
//    de 2ª persona plural de España), `DICT_ES_EXTRA`, `DICT_LAT_EXTRA`, `DICT_ES_WEAK_EXTRA` y
//    `DICT_LAT_WEAK_EXTRA`, activables con `LEXICON_EXTRA` (`env.LEXICON_EXTRA` o 3er parámetro de
//    `scoreText`, desactivado por defecto) para evaluación A/B sin alterar el léxico base.
//
// v1.4.38 (01/11/2026):
//  - [DIAGNÓSTICO] El resumen añade `err=<fuente>:<causa>×<n>,…` cuando hay fallos de
//    descarga (causa = código HTTP, `timeout` o `red`; `texto` si el contenido no era
//    texto) o una fuente entera caída (`OS-V3:fuente-429`). Antes `fallos=5` no decía qué
//    falló: en el tramo de 30 min tras desplegar la 1.4.37 (36 de 62 respuestas
//    degradadas) no pudo diagnosticarse la causa.
//  - [RELEASE / MODO SOMBRA] Si el nombre del archivo indica web o disco, el resumen añade
//    `rel=<web|disco> match=<k>/<n> [p1=no]`: cuántas pistas servidas están sincronizadas
//    con el mismo origen y si la primera no lo está. NO cambia el orden; sirve para medir
//    si ordenar por release aportaría algo antes de activarlo.
//
// v1.4.37 (01/11/2026):
//  - [TTL / ZIPS GRANDES] Un zip de SubDL que el proxy rechaza con HTTP 413 («Archivo
//    demasiado grande», p. ej. un pack de temporada) se descarta como el 410/422: antes
//    contaba como fallo transitorio y degradaba TODA la respuesta a TTL 60 s. Visto en
//    producción (1.4.36, 1 h): 3 de las 4 respuestas degradadas eran el mismo título
//    (tt2560140, episodios 5-7) con 1 pack >10 MB; cada reproducción repetía 5 descargas
//    y ~1,6 s. Ahora se sirven las demás pistas con TTL 7200 s y el enlace entra en la
//    memoria de enlaces muertos (`descartes404`).
//  - [ORDEN POR NOMBRE] `lat` suelto (p. ej. «…1080p-Dual-Lat.mkv», convención de
//    cinecalidad) cuenta como pista de latino; con límites de palabra, así que «late»,
//    «plate» o «lates» no lo activan. En el tráfico real, 6 de 235 nombres únicos.
//
// v1.4.36 (31/10/2026):
//  - [CONFIGURE / REDISEÑO] Nueva página de configuración: opciones de orden como radios
//    nativos (teclado y lectores de pantalla), vista previa en vivo de la lista de
//    subtítulos con el orden elegido (en «Automático» con tres nombres de archivo de
//    ejemplo), SubDL como paso opcional con aviso de que la clave viaja en la URL, barra
//    fija «Instalar en Stremio» / «Copiar URL» (si no hay portapapeles se muestra la URL
//    para copiarla a mano), tema claro/oscuro según el sistema, móvil primero, foco
//    visible y `prefers-reduced-motion`. Sin versión escrita en el HTML (antes la insignia
//    había que subirla a mano). Mantiene `dialectOrder` (`auto|lat|es|none`) de 1.4.35.
//  - [TELEMETRÍA] `[subtitles] orden=<lat|es> aplicado en HIT` solo cuando el orden cambió
//    (en MISS ya salía `orden=` en el resumen).
//
// v1.4.35 (31/10/2026):
//  - [ORDEN POR ARCHIVO / PREFERENCIA] Reordenación inteligente de la lista de
//    subtítulos según el nombre del archivo de video (`filename` enviado por
//    Stremio en el 76 % de las peticiones en frío) o según la preferencia del
//    usuario en `/configure` (`dialectOrder`: `auto`, `lat`, `es`, `none`).
//    En modo `auto` (por defecto), tokens inequívocos como `LATINO` / `LATAM`
//    priorizan las pistas `🇲🇽 Latino` al principio de la lista, y `CASTELLANO` /
//    `Esp` priorizan las `🇪🇸 Castellano`, manteniendo el orden relativo y la
//    prioridad `[PLAT]` dentro de cada grupo. Se aplica al servir (tanto en HIT
//    como en MISS) sobre el JSON canónico, con fragmentación cero de la caché.
//  - [UX / CONFIGURE] Rediseño integral de la página `/configure` con una
//    interfaz más intuitiva: tarjetas interactivas para elegir el orden de
//    dialecto, insignias visuales de clasificación, botón Mostrar/Ocultar para
//    la clave opcional de SubDL y guía rápida de instalación.
//
// v1.4.34 (31/10/2026):
//  - [LÉXICO / "carajo"] Pasa de término fuerte Latino a débil (0,25). Datos de producción
//    (10 h, 31 archivos únicos con etiqueta `spl`/`spn` en desacuerdo con el texto): 12
//    llevaban "carajo" y 11 de ellos tenían además marcadores exclusivos de España
//    ("vosotros", "sois", "guay", "hostia", "chaval"...); en 4 el término estuvo a menos de
//    3 puntos de empujar un archivo castellano a Neutro. Sigue sumando a Latino, pero ya no
//    decide solo ni con el override de 2 términos.
//  - [TELEMETRÍA] El resumen añade `mem404w=N`: entradas nuevas escritas en la memoria de
//    enlaces muertos de esa respuesta. En producción (v1.4.33) `mem404` fue 0 en 969
//    respuestas porque ningún título con 404 se recalculó en 30 min en el mismo centro de
//    datos; `mem404w>0` confirma que la escritura ocurre y, junto a `mem404>0` más tarde,
//    que persiste.
//
// v1.4.33 (30/10/2026):
//  - [ENLACES MUERTOS / MEMORIA POR TÍTULO] Los enlaces que ya dieron un descarte permanente
//    (HTTP 404/410 en directa, 410/422 vía proxy) se recuerdan 30 min en la Cache API del
//    centro de datos (una sola entrada por título, `/_dead/<tipo>/<id>`: 1 lectura y como
//    mucho 1 escritura por respuesta en frío). Al recalcular el título (caducidad del TTL
//    de 300 s de las vacías, otra clave de configuración) esos enlaces no se vuelven a
//    descargar y la 2ª oleada rellena el cupo sin esperar. Dato de producción: una serie
//    con 22 entradas de SubDL, todas 404, produjo 56 descargas inútiles (2,8 % del total)
//    y 7 de las 12 respuestas con `servidas=0`. El resumen añade `mem404=N` (enlaces
//    omitidos por la memoria) y `descargas=` ya NO los cuenta.
//  - [TELEMETRÍA / DESACUERDO ETIQUETA-TEXTO] Si el proveedor etiqueta `spl` (≈Latino) y el
//    léxico decide Castellano, o `spn` (≈Castellano) y decide Latino, se registra
//    `[classify] desacuerdo rl=… veredicto=… es= lat= s= len= h=… | es: término×n … |
//    lat: … | deb: …` con los términos que decidieron (solo en esos casos, ~9-12 % de los
//    `spl`). Sirve para separar etiquetas erróneas de falsos positivos del léxico.
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
// como Latino—, y "carajo" (v1.4.34: también se usa en España; 12 de 31 archivos `spl`
// clasificados Castellano en producción lo llevaban, 11 con otros marcadores claros de
// España). Cuentan 0,25 en vez de 1 para que una palabra suelta no
// decida la clasificación; solo pesan cuando aparecen muchas veces.
const WEAK_WEIGHT = 0.25;
const DICT_ES = /(?<![\p{L}\p{N}_])(?:vosotros|ordenador(?:es)?|coche[s]?|gilipollas|hostias?|chaval(?:es)?|foll(?:ar|a|an|en|ó|o|ado|ando)|guay|m[oó]vil(?:es)?(?!\s+del\s+(?:crimen|asesinato|delito|robo|ataque)|\s+perpetuo)|patata[s]?|zumo[s]?|aparqu[\p{L}]*|aparc[\p{L}]*|condu(?:cir|zco|zca|zcan|ces|ce|cen|jiste|jeron|jo|cía|cías|cíamos|cían|ciendo|cido)(?!\s+a\s+(?:nada|eso|esto|ninguna\s+parte|la\s+ruina|un\s+desastre|una?\s+conclusi[oó]n))|enfad[\p{L}]*|nevera[s]?|jol[ií]n|mol(?:a|an)|ten[eé]is|sois|est[aá]is|mogoll[oó]n|curr(?:ar|o|as|a|amos|áis|an|ando|ado|ante[s]?)|flip(?:ar|o|as|a|amos|áis|an|é|ó|ando|ado|ante[s]?))(?![\p{L}\p{N}_])/giu;
const DICT_LAT = /(?<![\p{L}\p{N}_])(?:computadora[s]?|carro[s]?(?!\s+de\s+(?:(?:la\s+)?compra|combate)|\s+blindado)|auto(?:s)?|pendej[\p{L}]*|ching(?:ar|a|as|an|o|ó|aron|aba|aban|ado|ada|ando|ón|ones|ue|ues|uen|ué|adera)|platic[\p{L}]*|celular(?:es)?|jugo[s]?|estacion(?:ar|a|as|an|ó|é|aste|aron|aba|abas|ábamos|aban|ado|ada|ando|amiento)|manej[\p{L}]*(?!\s+del?(?![\p{L}\p{N}_]))|enoj[\p{L}]*|refrigerador(?:es)?|chavo(?:s)?|wey|güey|[oó]rale|chido|bacano|bolud[\p{L}]*|pelotud[\p{L}]*|pibe[s]?|quilombo[s]?|tenés|querés|podés|sabés|decís|vení|mirá|we[oó]n(?:es|a|as)?|huev[oó]n(?:es|a|as)?|cachai|polol[oa][s]?|parce(?:ro|ra|ros|ras)?|chimba[s]?|chamo[s]?)(?![\p{L}\p{N}_])/giu;
const DICT_ES_WEAK = /(?<![\p{L}\p{N}_])(?:vale|jod(?:e|es|en|emos|er|a|as|an|ía|ías|íamos|ían|ió|ieron|iendo|ido|ida|idos|idas))(?![\p{L}\p{N}_])/giu;
// Sin flag `i`: "os" / "Os" (inicio de frase) suman 0,25 para España, pero
// "OS" en mayúsculas (Operating System) no casa nunca.
const DICT_ES_WEAK_CS = /(?<![\p{L}\p{N}_])[oO]s(?![\p{L}\p{N}_])/gu;
const DICT_LAT_WEAK = /(?<![\p{L}\p{N}_])(?:papa[s]?|neta[s]?|ustedes|fome[s]?|carajo)(?![\p{L}\p{N}_])/giu;

// v1.4.39: Candidatos de ampliación léxica (activables con LEXICON_EXTRA para evaluación A/B).
//  - ES_VOSOTROS_RE: desinencias verbales de 2ª persona plural de España (-áis / -éis, más "vais").
//    Excluye los verbos que ya están en DICT_ES (tenéis, estáis, aparcáis, curráis, flipáis,
//    enfadáis) para no puntuar doble, así como préstamos nominales (bonsáis, espráis, jerséis) y
//    palabras con hiato -aí-/-eí- (país, maíz, anís, raíz, seis). No usa -ís genérico.
const ES_VOSOTROS_RE = /(?<![\p{L}\p{N}_])(?!(?:(?:ten[eé]|est[aá]|aparc[aá]|aparqu[eé]|curr[aáeé]|flip[aáeé]|enfad[aáeé]|bons[aá]|espr[aá]|jers[eé])is|(?:pa[ií]|ma[ií]|an[ií]|ra[ií]|se[ií]?)s)(?![\p{L}\p{N}_]))(?:vais|[\p{L}]{2,}(?:áis|éis))(?![\p{L}\p{N}_])/giu;
const DICT_ES_EXTRA = /(?<![\p{L}\p{N}_])(?:cojones|coño|maj[oa]s?|cutres?|pij[oa]s?|chorradas?)(?![\p{L}\p{N}_])/giu;
const DICT_LAT_EXTRA = /(?<![\p{L}\p{N}_])(?:ahorita|chambas?|cuates?|h[ií]jole|nom[aá]s|[aá]ndale|pinches?|culer[oa]s?|nac[oa]s?|popotes?|(?<!(?<![\p{L}\p{N}_])de\s+)panas?(?!\s+de\s)|bac[aá]n(?:es)?|duraznos?|frutillas?|polleras?|remeras?|mij[oa]s?)(?![\p{L}\p{N}_])|[¿¡]\s*mande\s*\?/giu;
const DICT_ES_WEAK_EXTRA = /(?<![\p{L}\p{N}_])(?:colegas?(?!\s+(?:del\s+(?:trabajo|hospital|partido|instituto|senado)|m[eé]dicos?|cient[ií]ficos?))|gafas)(?![\p{L}\p{N}_])/giu;
const DICT_LAT_WEAK_EXTRA = /(?<![\p{L}\p{N}_])(?:boletos?(?!\s+de\s+(?:loter[ií]a|rifa))|lana(?!\s+(?:de\s+(?:oveja|cordero|merino|alpaca|vidrio|roca|acero)|virgen|mineral)))(?![\p{L}\p{N}_])/giu;
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
// Orden de dialecto según filename de Stremio y preferencia de usuario
// ---------------------------------------------------------------------------

const VALID_DIALECT_ORDERS = new Set(["auto", "lat", "es", "none"]);

const normalizeDialectOrder = (val) => {
  if (typeof val !== "string") return "auto";
  const clean = val.trim().toLowerCase();
  return VALID_DIALECT_ORDERS.has(clean) ? clean : "auto";
};

// Tokens inequívocos de dialecto en nombres de archivo (datos de producción:
// el 76 % de peticiones en frío trae `filename`, y ~15 % contiene tokens
// regionales claros como LATINO, LATAM, CASTELLANO o Esp).
// Se exigen fronteras no alfanuméricas (incluyendo `_`, `.`, `-`, espacios y
// corchetes) para que "ESP" no coincida dentro de "ESPAÑOL", "ESPANOL" o
// "ESPECIAL". Si aparecen ambos bandos a la vez (dual), se considera ambiguo.
const FILENAME_LAT_RE = /(?:^|[^a-z0-9ñáéíóúü])(?:latino|latam|lat|es[-_](?:419|la|mx))(?=[^a-z0-9ñáéíóúü]|$)/i;
const FILENAME_ES_RE = /(?:^|[^a-z0-9ñáéíóúü])(?:castellano|esp|es[-_]es)(?=[^a-z0-9ñáéíóúü]|$)/i;

const detectFilenameDialect = (filename) => {
  if (typeof filename !== "string" || !filename) return null;
  const lat = FILENAME_LAT_RE.test(filename);
  const es = FILENAME_ES_RE.test(filename);
  if (lat && !es) return "lat";
  if (es && !lat) return "es";
  return null;
};

// Extrae `filename` tanto de query string (`?filename=...`) como del segmento
// extra de ruta del protocolo de Stremio (`/subtitles/:type/:id/filename=....json`).
const extractFilename = (url, pathParts = [], actionIndex = 0) => {
  const q = url.searchParams.get("filename");
  if (q && q.trim()) return q.trim();
  const extraSeg = pathParts[actionIndex + 3];
  if (!extraSeg) return "";
  let clean = extraSeg.replace(/\.json$/i, "");
  if (!clean.includes("=") && /%3d/i.test(clean)) {
    try {
      clean = decodeURIComponent(clean);
    } catch {
      /* segmento malformado */
    }
  }
  const fn = new URLSearchParams(clean).get("filename");
  return fn && fn.trim() ? fn.trim() : "";
};

const resolveDialectTarget = (config, filename = "") => {
  const mode = normalizeDialectOrder(config?.dialectOrder ?? config?.order);
  if (mode === "none") return null;
  if (mode === "lat" || mode === "es") return mode;
  return detectFilenameDialect(filename);
};

// Reordena de forma estable poniendo primero el dialecto objetivo (`🇲🇽` o `🇪🇸`)
// y manteniendo intacto el orden relativo del resto (incluyendo la prioridad
// `[PLAT]` dentro de cada bloque). No muta el array original.
const orderSubtitlesByDialect = (subtitles, targetDialect) => {
  if (!Array.isArray(subtitles) || subtitles.length <= 1) return subtitles;
  if (targetDialect !== "lat" && targetDialect !== "es") return subtitles;
  const flag = targetDialect === "lat" ? "🇲🇽" : "🇪🇸";
  const match = (s) => (typeof s?.label === "string" && s.label.startsWith(flag) ? 1 : 0);
  return [...subtitles].sort((a, b) => match(b) - match(a));
};

// ---------------------------------------------------------------------------
// Página de configuración
// ---------------------------------------------------------------------------

const getConfigureHTML = (existingConfig = {}) => {
  const dialect = normalizeDialectOrder(existingConfig.dialectOrder ?? existingConfig.order);
  const chk = (m) => (dialect === m ? " checked" : "");
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light dark"><title>Configuración | HispaSubs</title>
<style>
:root{--bg:#eef2f5;--surface:#ffffff;--ink:#14202b;--muted:#566676;--line:#d3dce4;--accent:#0a6c8c;--on-accent:#ffffff;--hl:#dff3fa;--focus:#0a6c8c;--stage:#0f1a24;--stage-ink:#e8eff5;--stage-muted:#93a5b6;--stage-line:#263647;--stage-hl:#12384a;--stage-accent:#22c5ee;--serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--stage:#080e14;--bg:#0d151d;--surface:#15202b;--ink:#e8eff5;--muted:#9aabbb;--line:#263647;--accent:#22c5ee;--on-accent:#04222c;--hl:#12384a;--focus:#22c5ee}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--sans)}
main{max-width:48rem;margin:0 auto;padding:2rem 1rem 0}
.top{display:flex;align-items:center;gap:1rem;margin-bottom:1.75rem}
.mark{flex:none;width:4rem;height:4rem;border-radius:1rem;background:var(--stage);border:1px solid var(--stage-line);display:flex;align-items:center;justify-content:center}
.mark svg{width:2.75rem;height:2.75rem}
h1{font:700 clamp(2rem,6vw,2.6rem)/1.05 var(--serif);letter-spacing:-.01em;margin:0 0 .3rem}
.lead{margin:0;color:var(--muted);max-width:34rem}
h2{font:700 1.35rem/1.25 var(--serif);margin:2.25rem 0 .3rem}
.hint{margin:0 0 1rem;color:var(--muted);max-width:38rem}
.note{margin:.6rem 0 0;color:var(--muted);font-size:.9rem;max-width:38rem}
a{color:var(--accent)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.order{display:grid;gap:1.25rem;grid-template-columns:minmax(0,1fr)}
@media (min-width:50rem){.order{grid-template-columns:minmax(0,1fr) minmax(0,.95fr);align-items:start}}
.opts{margin:0;padding:0;min-width:0;border:1px solid var(--line);border-radius:.75rem;background:var(--surface);overflow:hidden}
.opt{display:flex;align-items:flex-start;gap:.75rem;padding:.9rem 1rem;cursor:pointer}
.opt+.opt{border-top:1px solid var(--line)}
.opt input{flex:none;margin:.3rem 0 0;accent-color:var(--accent)}
.opt:has(input:checked){background:var(--hl)}
.opt:focus-within{outline:2px solid var(--focus);outline-offset:-2px}
.opt-title{display:block;font-weight:600}
.opt-title small{margin-left:.45rem;font-size:.8rem;font-weight:500;color:var(--accent)}
.opt-desc{display:block;margin-top:.15rem;color:var(--muted);font-size:.9rem}
.stage{background:var(--stage);color:var(--stage-ink);border:1px solid var(--stage-line);border-radius:.9rem;padding:1rem}
.stage-title{margin:0 0 .65rem;font-size:.9rem;color:var(--stage-muted)}
.chips{display:flex;flex-wrap:wrap;gap:.4rem;margin:0 0 .75rem}
.chips[hidden]{display:none}
.chips button{font:inherit;font-size:.8rem;line-height:1.2;color:var(--stage-muted);background:transparent;border:1px solid var(--stage-line);border-radius:999px;padding:.35rem .75rem;cursor:pointer}
.chips button[aria-pressed="true"]{color:var(--stage-ink);background:var(--stage-hl);border-color:var(--stage-accent)}
.tracks{list-style:none;margin:0;padding:0;display:grid;gap:.35rem}
.tracks li{display:flex;align-items:center;gap:.6rem;padding:.55rem .7rem;border-radius:.5rem;border-left:3px solid transparent;background:rgba(255,255,255,.05)}
.tracks li.on{background:var(--stage-hl);border-left-color:var(--stage-accent)}
.flag{font-size:1.1rem;line-height:1}
.tname{flex:1;min-width:0}
.src{font-size:.75rem;color:var(--stage-muted)}
.stage-note{margin:.75rem 0 0;min-height:2.6em;font-size:.85rem;color:var(--stage-muted)}
.field label{display:block;margin-bottom:.35rem;font-weight:600}
.pw{display:flex;gap:.5rem;max-width:30rem}
.pw input{flex:1;min-width:0;padding:.7rem .8rem;font:.95rem var(--mono);color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:.6rem}
button{font:inherit;cursor:pointer}
.ghost{color:var(--ink);background:transparent;border:1px solid var(--line);border-radius:.6rem;padding:0 1rem}
details{margin-top:1.5rem;padding-top:.8rem;border-top:1px solid var(--line)}
details+details{margin-top:.8rem}
summary{font-weight:600;cursor:pointer}
details p{margin:.6rem 0 0;color:var(--muted);max-width:38rem}
details input{width:100%;margin-top:.6rem;padding:.6rem .7rem;font:.85rem var(--mono);color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:.6rem}
.legend{margin:.6rem 0 0;display:grid;gap:.5rem}
.legend dt{font-weight:600}
.legend dd{margin:0;color:var(--muted);font-size:.95rem}
.bar{position:sticky;bottom:0;margin-top:2rem;background:var(--bg);border-top:1px solid var(--line)}
.bar-in{max-width:48rem;margin:0 auto;padding:.75rem 1rem max(.75rem,env(safe-area-inset-bottom));display:flex;flex-wrap:wrap;align-items:center;gap:.6rem}
.primary{min-height:2.75rem;padding:0 1.5rem;font-weight:700;color:var(--on-accent);background:var(--accent);border:0;border-radius:.6rem}
.primary:hover{filter:brightness(.94)}
.secondary{min-height:2.75rem;padding:0 1.1rem;color:var(--ink);background:transparent;border:1px solid var(--line);border-radius:.6rem}
.status{font-size:.9rem;color:var(--muted)}
button:focus-visible,input:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head>
<body onload="initPage()">
<main>
<header class="top"><div class="mark">${LOGO_SVG}</div><div><h1>HispaSubs</h1><p class="lead">Cada subtítulo en español se lee y se etiqueta como castellano, latino o neutro, para que elijas el que suena a ti.</p></div></header>

<section aria-labelledby="h-order">
<h2 id="h-order">Orden de los subtítulos</h2>
<p class="hint">Elige qué dialecto aparece primero en la lista del reproductor.</p>
<div class="order">
<fieldset class="opts"><legend class="sr">Dialecto que va primero</legend>
<label class="opt"><input type="radio" name="dialect-choice" value="auto"${chk("auto")} onchange="setDialect('auto')"><span><span class="opt-title">Automático<small>recomendado</small></span><span class="opt-desc">Sigue el nombre del archivo que reproduces: con «LATINO» pone primero los latinos; con «CASTELLANO» o «Esp», los de España.</span></span></label>
<label class="opt"><input type="radio" name="dialect-choice" value="lat"${chk("lat")} onchange="setDialect('lat')"><span><span class="opt-title">Latino primero</span><span class="opt-desc">Los 🇲🇽 latinos arriba; el resto, en su orden.</span></span></label>
<label class="opt"><input type="radio" name="dialect-choice" value="es"${chk("es")} onchange="setDialect('es')"><span><span class="opt-title">Castellano primero</span><span class="opt-desc">Los 🇪🇸 de España arriba; el resto, en su orden.</span></span></label>
<label class="opt"><input type="radio" name="dialect-choice" value="none"${chk("none")} onchange="setDialect('none')"><span><span class="opt-title">Sin ordenar</span><span class="opt-desc">Respeta el orden en que llegan de las fuentes.</span></span></label>
</fieldset>
<div class="stage">
<p class="stage-title">Así se verá la lista</p>
<div class="chips" id="chips" role="group" aria-label="Nombre de archivo de ejemplo"><button type="button" id="s-lat" aria-pressed="true" onclick="setSample('lat')">Coco.2017.LATINO.mkv</button><button type="button" id="s-es" aria-pressed="false" onclick="setSample('es')">Oppenheimer.Castellano.mkv</button><button type="button" id="s-none" aria-pressed="false" onclick="setSample('none')">Dune.2021.1080p.mkv</button></div>
<ol class="tracks" id="tracks">
<li id="t0" data-i="0" data-k="es"><span class="flag">🇪🇸</span><span class="tname">Castellano</span><span class="src">OS-V3</span></li>
<li id="t1" data-i="1" data-k="la"><span class="flag">🇲🇽</span><span class="tname">Latino</span><span class="src">SubDL</span></li>
<li id="t2" data-i="2" data-k="ne"><span class="flag">🌎</span><span class="tname">Neutro</span><span class="src">OS-V3</span></li>
<li id="t3" data-i="3" data-k="la"><span class="flag">🇲🇽</span><span class="tname">Latino (SDH)</span><span class="src">OS-V3</span></li>
<li id="t4" data-i="4" data-k="un"><span class="flag">📄</span><span class="tname">Español (sin clasificar)</span><span class="src">OS-V3</span></li>
</ol>
<p class="stage-note" id="stageNote" aria-live="polite"></p>
</div>
</div>
</section>

<section aria-labelledby="h-key">
<h2 id="h-key">Más subtítulos con SubDL (opcional)</h2>
<p class="hint">Suma el catálogo de SubDL al de OpenSubtitles. Consigue una clave gratis en <a href="https://subdl.com" target="_blank" rel="noopener">subdl.com</a>.</p>
<div class="field"><label for="subdlKey">Clave de API</label><div class="pw"><input type="password" id="subdlKey" autocomplete="off" spellcheck="false" placeholder="Pega tu clave aquí" value="${esc(existingConfig.subdlKey || "")}" oninput="refreshUrl()"><button type="button" class="ghost" id="showKey" aria-pressed="false" onclick="toggleKey()">Mostrar</button></div></div>
<p class="note">La clave viaja dentro de la URL de instalación: no compartas esa URL.</p>
</section>

<input type="hidden" id="dialectOrder" value="${dialect}">

<details id="legend"><summary>¿Qué significan las etiquetas?</summary>
<dl class="legend">
<div><dt>🇪🇸 Castellano</dt><dd>Vocabulario de España: coche, vosotros, ordenador, vale…</dd></div>
<div><dt>🇲🇽 Latino</dt><dd>Vocabulario latinoamericano: carro, celular, ustedes, órale…</dd></div>
<div><dt>🌎 Neutro</dt><dd>Sin rasgos claros de un dialecto, o con rasgos de los dos.</dd></div>
<div><dt>📄 Sin clasificar</dt><dd>El texto no tiene vocabulario suficiente para decidir.</dd></div>
</dl>
<p>La etiqueta sale de leer el propio subtítulo, no de lo que declare la fuente.</p>
</details>
<details id="manual"><summary>¿No se abre Stremio?</summary>
<p>Copia esta URL e instálala a mano: en Stremio abre Complementos, pulsa «Añadir complemento» y pégala.</p>
<input type="text" id="manifestUrl" readonly value="" aria-label="URL del complemento" onfocus="this.select()">
</details>
</main>

<div class="bar"><div class="bar-in"><button type="button" class="primary" onclick="installAddon()">Instalar en Stremio</button><button type="button" class="secondary" id="copyBtn" onclick="copyManifest()">Copiar URL</button><span class="status" id="status" role="status" aria-live="polite"></span></div></div>

<script>
// NOTA: se usa split/join en vez de .replace(/.../) para no depender de
// escapes anidados dentro del template literal del Worker (el bug ///g de 1.0.0).
// El script solo declara funciones (sin código suelto): los tests lo evalúan con un
// document simulado que únicamente tiene getElementById.
var DIALECTS = ['auto', 'lat', 'es', 'none'];
var sample = 'lat';
function currentDialect() {
  var el = document.getElementById('dialectOrder');
  var v = el && el.value ? String(el.value) : 'auto';
  return DIALECTS.indexOf(v) >= 0 ? v : 'auto';
}
function getManifestUrl(protocol) {
  var key = document.getElementById('subdlKey').value.trim();
  var dialect = currentDialect();
  var origin = protocol + '://' + window.location.host;
  if (!key && dialect === 'auto') return origin + '/manifest.json';
  var cfg = {};
  if (key) cfg.subdlKey = key;
  if (dialect !== 'auto') cfg.dialectOrder = dialect;
  var bytes = new TextEncoder().encode(JSON.stringify(cfg));
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  var b64 = btoa(bin).split('+').join('-').split('/').join('_');
  while (b64.charAt(b64.length - 1) === '=') b64 = b64.slice(0, -1);
  return origin + '/' + b64 + '/manifest.json';
}
function installAddon() { window.location.href = getManifestUrl('stremio'); }
function setStatus(text) {
  var el = document.getElementById('status');
  if (el) el.textContent = text;
}
function copyManifest() {
  var btn = document.getElementById('copyBtn');
  var url = getManifestUrl('https');
  function fallback() {
    var box = document.getElementById('manifestUrl');
    document.getElementById('manual').open = true;
    box.focus();
    box.select();
    setStatus('Selecciona la URL y cópiala con Ctrl+C.');
  }
  if (!navigator.clipboard) { fallback(); return; }
  navigator.clipboard.writeText(url).then(function () {
    btn.textContent = 'Copiada';
    setStatus('URL copiada. Pégala en Stremio.');
    setTimeout(function () { btn.textContent = 'Copiar URL'; }, 2000);
  }).catch(fallback);
}
function refreshUrl() {
  var box = document.getElementById('manifestUrl');
  if (box) box.value = getManifestUrl('https');
}
function toggleKey() {
  var input = document.getElementById('subdlKey');
  var btn = document.getElementById('showKey');
  var show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? 'Ocultar' : 'Mostrar';
  btn.setAttribute('aria-pressed', show ? 'true' : 'false');
}
// Vista previa: reproduce en pequeño el orden que aplica el servidor
// (solo sube el dialecto elegido; el resto conserva su orden: sort estable).
function stagePref() {
  var d = currentDialect();
  if (d === 'none') return null;
  if (d === 'auto') return sample === 'none' ? null : sample;
  return d;
}
function rankOf(k, pref) {
  var mine = pref === 'lat' ? 'la' : 'es';
  return k === mine ? 0 : 1;
}
function stageNote(d, pref) {
  if (d === 'none') return 'Se mantiene el orden en que llegan de las fuentes.';
  if (d === 'lat') return 'Los latinos van primero; el resto conserva su orden.';
  if (d === 'es') return 'Los de España van primero; el resto conserva su orden.';
  if (pref === 'lat') return 'El nombre incluye «LATINO»: los latinos van primero.';
  if (pref === 'es') return 'El nombre incluye «Castellano»: los de España van primero.';
  return 'El nombre no dice nada del dialecto: se mantiene el orden de las fuentes.';
}
function renderStage(animate) {
  var list = document.getElementById('tracks');
  var items = Array.prototype.slice.call(list.children);
  var d = currentDialect();
  var pref = stagePref();
  var before = {};
  items.forEach(function (li) { before[li.id] = li.getBoundingClientRect().top; });
  items.sort(function (a, b) {
    var ra = pref ? rankOf(a.getAttribute('data-k'), pref) : 0;
    var rb = pref ? rankOf(b.getAttribute('data-k'), pref) : 0;
    return ra - rb || Number(a.getAttribute('data-i')) - Number(b.getAttribute('data-i'));
  });
  items.forEach(function (li) {
    list.appendChild(li);
    li.className = pref && rankOf(li.getAttribute('data-k'), pref) === 0 ? 'on' : '';
  });
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (animate && !calm) {
    items.forEach(function (li) {
      var dy = before[li.id] - li.getBoundingClientRect().top;
      if (!dy) return;
      li.style.transition = 'none';
      li.style.transform = 'translateY(' + dy + 'px)';
    });
    void list.offsetHeight;
    items.forEach(function (li) {
      li.style.transition = 'transform .3s ease';
      li.style.transform = '';
    });
  }
  document.getElementById('chips').hidden = d !== 'auto';
  document.getElementById('stageNote').textContent = stageNote(d, pref);
}
function setDialect(v) {
  document.getElementById('dialectOrder').value = v;
  renderStage(true);
  refreshUrl();
}
function setSample(k) {
  sample = k;
  ['lat', 'es', 'none'].forEach(function (n) {
    document.getElementById('s-' + n).setAttribute('aria-pressed', n === k ? 'true' : 'false');
  });
  renderStage(true);
}
function initPage() {
  renderStage(false);
  refreshUrl();
}
</script></body></html>`;
};

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const getManifest = (host) => ({
  id: "org.hispasubs.addon",
  version: "1.4.41",
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
const REF_NAME = Symbol.for("hispasubs.refName");
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

// Causa del fallo de descarga (v1.4.38), solo para el log `err=`: código HTTP,
// "timeout" (abort/tiempo agotado) o "red". Sin URLs ni texto del error.
const ERR_KIND = Symbol.for("hispasubs.errKind");
const errKind = (msg) => {
  const m = /\bHTTP (\d{3})\b/.exec(String(msg || ""));
  if (m) return m[1];
  return /abort|timeout|timed out|tiempo/i.test(String(msg || "")) ? "timeout" : "red";
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
const scoreText = (rawText, diag = {}, useExtra = false) => {
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
  const extra = Boolean(useExtra);
  // Una sola pasada por diccionario fuerte: strongEs/strongLat alimentan tanto
  // las puntuaciones por dialecto como strongTotal (antes se volvían a
  // recorrer, duplicando el coste léxico).
  const strongEs = score(DICT_ES, 1) + (extra ? score(DICT_ES_EXTRA, 1) + score(ES_VOSOTROS_RE, 1) : 0);
  const strongLat = score(DICT_LAT, 1) + (extra ? score(DICT_LAT_EXTRA, 1) : 0);
  const esMatches =
    strongEs +
    score(DICT_ES_WEAK, WEAK_WEIGHT) +
    score(DICT_ES_WEAK_CS, WEAK_WEIGHT) +
    (extra ? score(DICT_ES_WEAK_EXTRA, WEAK_WEIGHT) : 0);
  const latMatches =
    strongLat +
    score(DICT_LAT_WEAK, WEAK_WEIGHT) +
    (extra ? score(DICT_LAT_WEAK_EXTRA, WEAK_WEIGHT) : 0);
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
// `spamCredits` (SPAM_CREDITS=1, apagado por defecto): una pista con frase de crédito
// ("Traducido por", "Subtítulos por"…) y SIN marca de agua de OpenSubtitles/YTS no se
// descarta por líneas débiles (créditos de comunidades/uploaders que la lista de
// comunidades conocidas no cubre). Los términos fuertes se evalúan antes y no cambian.
const spamVerdict = (text, truncated = false, spamCredits = false) => {
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
  if (weakMatches.length >= 2 && (hasWatermark || (hasCreditPhrase ? !spamCredits && adLines >= 2 : adLines >= 1))) {
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

// v1.4.33: memoria de enlaces muertos (descartes permanentes 404/410/422) por título.
// Una entrada de la Cache API del centro de datos por título (no por URL: así el coste
// es 1 lectura + como mucho 1 escritura por respuesta en frío, sin acercarse al tope de
// subrequests). Guarda las huellas (`hashContent` de la URL final, con &s=&e= en los zips)
// de los enlaces muertos con su instante de registro: cada enlace caduca a los 30 min de
// SU descarte (la entrada se reescribe al añadir otro, pero los antiguos no se prorrogan).
const DEAD_LINK_TTL_S = 1800;
const DEAD_LINK_MAX = 64;
const deadLinkKey = (origin, type, fullId) =>
  `${origin}/_dead/${type}/${encodeURIComponent(fullId)}`;
const loadDeadLinks = async (keyUrl) => {
  const mem = { key: keyUrl, known: new Map(), added: new Set(), hits: 0 };
  try {
    const r = await cacheMatch(new Request(keyUrl));
    const arr = r ? await r.json() : null;
    if (Array.isArray(arr)) {
      const now = Math.floor(Date.now() / 1000);
      for (const e of arr.slice(-DEAD_LINK_MAX)) {
        if (Array.isArray(e) && typeof e[0] === "string" && e[0] && Number.isFinite(e[1]) && now - e[1] < DEAD_LINK_TTL_S) {
          mem.known.set(e[0], e[1]);
        }
      }
    }
  } catch { /* caché no disponible o entrada ilegible: sin memoria */ }
  return mem;
};
const saveDeadLinks = (ctx, mem) => {
  if (!mem || mem.added.size === 0) return 0;
  const now = Math.floor(Date.now() / 1000);
  const merged = new Map(mem.known);
  for (const h of mem.added) merged.set(h, now);
  const all = [...merged].slice(-DEAD_LINK_MAX);
  cachePut(
    ctx,
    new Request(mem.key),
    new Response(JSON.stringify(all), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${DEAD_LINK_TTL_S}` },
    })
  );
  return mem.added.size;
};
const FROM_MEM = Symbol.for("hispasubs.fromDeadMemory");

// v1.4.33: términos que más pesaron en un veredicto (para el log de desacuerdo).
const topTerms = (text, dict, n = 4) => {
  const counts = new Map();
  for (const m of text.matchAll(dict)) {
    const t = m[0].toLowerCase();
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t, c]) => `${t}×${c}`).join(" ") || "-";
};
// Etiqueta regional del proveedor -> veredicto que se espera del léxico (supuesto medido).
const RAW_LANG_EXPECTED = { spl: "🇲🇽 Latino", spn: "🇪🇸 Castellano" };

const classifySubtitle = async (
  sub,
  pBase = VERCEL_UNZIPPER,
  spamMode = "drop",
  epSuffix = "",
  maxTimeoutMs = 0,
  deadMem = null,
  lexiconExtra = false,
  verifyAll = false,
  spamCredits = false
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

  // Enlace ya descartado de forma permanente hace poco: no se vuelve a descargar.
  const deadHash = deadMem ? hashContent(finalUrl) : "";
  if (deadMem && deadMem.known.has(deadHash)) {
    deadMem.hits += 1;
    return { [DISCARDED_404]: true, [FROM_MEM]: true };
  }

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
    if ((sub.verifyEs || verifyAll) && !looksSpanish(text)) {
      console.log(`[classify] descartado por idioma (no parece español; código ${sub.rawLang}) [${sub.source}]`);
      return null;
    }

    // Anti-spam: se descarta la pista entera con el texto que ya está en
    // memoria (publicidad incrustada). null = fuera de la lista; un descarte
    // deliberado NO es una respuesta degradada, así que no marca FAILED ni
    // baja el TTL. Con SPAM_FILTER=log (modo sombra) se registra el veredicto
    // pero la pista se sirve: sirve para medir en producción qué se perdería.
    const spam = spamVerdict(text, truncated, spamCredits);
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
    const scored = scoreText(text, diag, lexiconExtra);
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
    // v1.4.39: Referencia de dialecto por nombre declarado de la pista (`sub.releaseName`).
    const refDialect = detectFilenameDialect(sub.releaseName);
    if (refDialect) {
      const refVerdict = !scored
        ? "sinclasificar"
        : scored.flag.includes("Castellano")
        ? "Castellano"
        : scored.flag.includes("Latino")
        ? "Latino"
        : "Neutro";
      console.log(
        `[classify] refnombre=${refDialect} veredicto=${refVerdict} es=${diag.es ?? 0} lat=${diag.lat ?? 0} s=${diag.strong ?? 0} len=${lenTag} h=${contentHash} [${sub.source}]`
      );
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
      u[REF_NAME] = Boolean(refDialect);
      return u;
    }

    // Desacuerdo entre la etiqueta regional del proveedor y el léxico: se registran los
    // términos que decidieron (solo en estos casos, para no pagar la pasada extra siempre).
    const expectedFlag = RAW_LANG_EXPECTED[rawLang];
    if (expectedFlag && scored.flag !== expectedFlag && scored.flag !== "🌎 Neutro") {
      console.log(
        `[classify] desacuerdo rl=${rawLang} veredicto=${scored.flag} es=${diag.es} lat=${diag.lat} s=${diag.strong} ` +
          `len=${lenTag} h=${contentHash} | es: ${topTerms(text, DICT_ES)} | lat: ${topTerms(text, DICT_LAT)} | ` +
          `deb: ${topTerms(text, DICT_ES_WEAK)} ${topTerms(text, DICT_LAT_WEAK)} [${sub.source}]`
      );
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
      [REF_NAME]: Boolean(refDialect),
    };
  } catch (error) {
    // Descarte permanente sin penalizar el TTL:
    //  - En URL directa (!isZip): HTTP 404 o 410 (enlace muerto en el CDN).
    //  - En URL del proxy (isZip): HTTP 410 (origen 404/410 mapeado por el
    //    proxy) o HTTP 422 (el zip no tiene subtítulos válidos / falta el
    //    episodio en el pack). Un HTTP 404 crudo sobre `isZip` significa que
    //    el propio endpoint del proxy no existe (PROXY_URL rota o caída de
    //    enrutamiento) y SÍ debe contar como FAILED (TTL 60 s).
    //    v1.4.37: HTTP 413 del proxy (zip por encima de MAX_BYTES, típico de un
    //    pack de temporada) también es permanente: reintentar no lo encoge.
    const isPermanentDiscard = isZip
      ? /\bHTTP 4(?:10|13|22)\b/.test(error.message)
      : /\bHTTP 4(?:04|10)\b/.test(error.message);
    if (isPermanentDiscard) {
      if (deadMem) deadMem.added.add(deadHash);
      return { [DISCARDED_404]: true };
    }
    console.error("[classify]", sub.source, error.message);
    // Timeout / red caída / 429 / 5xx / 404 de proxy: fallo transitorio → TTL corto.
    const failedTrack = unclassified(sub, finalUrl, true);
    failedTrack[ERR_KIND] = errKind(error.message);
    return failedTrack;
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
export { errKind, looksSpanish, NEAR_ES_LANG_RE, scoreText, subtitleCacheUrl, OS_V3_TIMEOUT_MS, spamVerdict, ANALYSIS_BUDGET_PER_SOURCE, ANALYSIS_FETCH_PER_SOURCE, CLASSIFY_BUDGET_MS, WAVE2_MAX_W1_MS, rateLimitFallback, RATE_MAP_CAP, readCapped, MAX_ANALYZE_BYTES, isSdh, hashContent, SDH_MIN_MATCHES, SDH_ACOUSTIC_RE, dedupWave, getCanonicalConfigStr, isPlatformRelease, PLATFORM_RELEASE_RE, IS_PLATFORM, RELEASE_SOURCE, REF_NAME, releaseSourceOf, normalizeDialectOrder, detectFilenameDialect, extractFilename, resolveDialectTarget, orderSubtitlesByDialect, ES_VOSOTROS_RE, DICT_ES_EXTRA, DICT_LAT_EXTRA, DICT_ES_WEAK_EXTRA, DICT_LAT_WEAK_EXTRA };

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
        const filename = extractFilename(url, pathParts, actionIndex);
        const fnDialect = detectFilenameDialect(filename);
        const targetDialect = resolveDialectTarget(config, filename);

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
          if (targetDialect) {
            try {
              const data = await cached.clone().json();
              if (Array.isArray(data?.subtitles) && data.subtitles.length > 1) {
                const ordered = orderSubtitlesByDialect(data.subtitles, targetDialect);
                // Log solo si el orden realmente cambió (permite medir el uso en HIT).
                if (ordered.some((x, i) => x !== data.subtitles[i])) {
                  console.log(`[subtitles] orden=${targetDialect} aplicado en HIT`);
                }
                const hitRes = new Response(JSON.stringify({ ...data, subtitles: ordered }), cached);
                hitRes.headers.set("x-cache", "HIT");
                return hitRes;
              }
            } catch {
              /* cuerpo no JSON: se sirve tal cual */
            }
          }
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
        const lexiconExtra = Boolean(
          env && (env.LEXICON_EXTRA === "1" || env.LEXICON_EXTRA === "true" || env.LEXICON_EXTRA === true)
        );
        // LANG_VERIFY=1|true|all: aplica `looksSpanish` a TODAS las fuentes (SubDL y OS-V3 `spa`),
        // no solo a OS-V3 `spl`/`spn`. Apagado por defecto: comportamiento idéntico al 1.4.39.
        const verifyAll = Boolean(
          env && (env.LANG_VERIFY === "1" || env.LANG_VERIFY === "true" || env.LANG_VERIFY === "all" || env.LANG_VERIFY === true)
        );
        // SPAM_CREDITS=1|true: las pistas con frase de crédito y sin marca de agua de
        // OpenSubtitles/YTS no se descartan por líneas débiles. Apagado por defecto: idéntico a la 1.4.40.
        const spamCredits = Boolean(
          env && (env.SPAM_CREDITS === "1" || env.SPAM_CREDITS === "true" || env.SPAM_CREDITS === true)
        );
        const epSuffix =
          season && episode && /^\d+$/.test(season) && /^\d+$/.test(episode)
            ? `&s=${season}&e=${episode}`
            : "";
        const analyzed = new Array(deduped.length).fill(null);
        const deadMem = await loadDeadLinks(deadLinkKey(url.origin, type, fullId));
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
            analyzed[i] = await classifySubtitle(deduped[i], pBase, spamMode, epSuffix, 0, deadMem, lexiconExtra, verifyAll, spamCredits);
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
              analyzed[i] = await classifySubtitle(deduped[i], pBase, spamMode, epSuffix, remainingMs, deadMem, lexiconExtra, verifyAll, spamCredits);
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
        const deadWritten = saveDeadLinks(ctx, deadMem);
        const kept = { "OS-V3": 0, "SubDL": 0 };
        const failed = { "OS-V3": 0, "SubDL": 0 };
        let descartes404 = 0;
        const errCount = {};
        const addErr = (key) => { errCount[key] = (errCount[key] || 0) + 1; };
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
            addErr(`${source}:${s[ERR_KIND] || "texto"}`);
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
        // Fuente entera caída (promesa rechazada): también deja su causa en `err=`.
        if (osSubs.status === "rejected") addErr(`OS-V3:fuente-${errKind(osSubs.reason?.message)}`);
        if (sdlSubs.status === "rejected") addErr(`SubDL:fuente-${errKind(sdlSubs.reason?.message)}`);
        const errTag = Object.keys(errCount).length
          ? ` err=${Object.entries(errCount).map(([k, n]) => `${k}×${n}`).join(",")}`
          : "";
        // Modo SOMBRA (v1.4.38): ¿el release del archivo (web/disco) coincide con el de las
        // pistas servidas? Solo se registra; NO cambia el orden. `p1=no` = hay alguna pista
        // que coincide pero la primera no (ganancia potencial de un ordenado por release).
        const fileRel = filename ? releaseSourceOf({ releaseName: filename }) : "";
        const relMatch = fileRel ? subtitles.filter((s) => s[RELEASE_SOURCE] === fileRel).length : 0;
        const relTag = fileRel
          ? ` rel=${fileRel} match=${relMatch}/${subtitles.length}${relMatch > 0 && subtitles[0]?.[RELEASE_SOURCE] !== fileRel ? " p1=no" : ""}`
          : "";
        const platformCount = subtitles.filter((s) => s[IS_PLATFORM]).length;
        const webCount = subtitles.filter((s) => s[RELEASE_SOURCE] === "web").length;
        const discCount = subtitles.filter((s) => s[RELEASE_SOURCE] === "disco").length;
        const refNameCount = subtitles.filter((s) => s[REF_NAME]).length;
        console.log(
          `[subtitles] resumen ${type}/${fullId}: total=${Date.now() - tStart}ms w1=${w1Ms}ms w2=${w2Ms}ms ` +
            `descargas=${wave1Idx.length + (wave2Ran ? wave2Idx.length : 0) - deadMem.hits} ` +
            `servidas=${subtitles.length} (OS-V3=${kept["OS-V3"]},SubDL=${kept["SubDL"]}) ` +
            `plataforma=${platformCount}/${subtitles.length} web=${webCount} disco=${discCount} ` +
            `fallos=${failed["OS-V3"] + failed["SubDL"]} descartes404=${descartes404} mem404=${deadMem.hits} mem404w=${deadWritten} duplicados=${duplicadosContenido} ttl=${ttl}s` +
            errTag + relTag +
            (refNameCount > 0 ? ` refnombre=${refNameCount}` : "") +
            (fnDialect ? ` fn=${fnDialect}` : "") +
            (targetDialect ? ` orden=${targetDialect}` : "") +
            (scoreLog.length ? ` | ${scoreLog.join(" | ")}` : "")
        );
        // En la caché se guarda SIEMPRE el orden canónico (sin aplicar `targetDialect`),
        // de modo que todas las variantes de `filename` y de `dialectOrder` compartan una
        // única entrada por título y se reordenen en memoria al servir (HIT o MISS).
        const canonicalResponse = jsonResponse({ subtitles }, ttl, { "x-cache": "MISS" });
        // - Sin clave válida: namespace público.
        // - SubDL "no utilizable" (clave falsa/rechazada/cuota): la respuesta es
        //   solo OS-V3 -> namespace de ESA clave (nunca `k_subdl`).
        // - Resto, incluido SubDL caído (ttl 60 s = caché negativa): `k_subdl`.
        const sdlUnusable = sdlSubs.status === "fulfilled" && sdlSubs.value?.unusable === true;
        cachePut(
          ctx,
          canonicalConfigStr && sdlUnusable ? new Request(keyCacheUrl) : cacheReq || request,
          canonicalResponse
        );
        if (targetDialect && subtitles.length > 1) {
          return jsonResponse(
            { subtitles: orderSubtitlesByDialect(subtitles, targetDialect) },
            ttl,
            { "x-cache": "MISS" }
          );
        }
        return canonicalResponse;
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
