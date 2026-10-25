# HispaSubs 🇲🇽 🇪🇸

[![CI](https://github.com/the-ak-forge/hispasubs/actions/workflows/ci.yml/badge.svg)](https://github.com/the-ak-forge/hispasubs/actions/workflows/ci.yml)

> Clasificador inteligente de subtítulos en español para Stremio

HispaSubs te ayuda a identificar rápidamente si un subtítulo está orientado a España, Latinoamérica o si es neutral. Evita el problema clásico de activar un archivo marcado como “Español” y descubrir, a mitad de la reproducción, que está escrito con un vocabulario regional muy distinto al que esperabas.

El complemento analiza el texto de los subtítulos, detecta expresiones, pronombres y modismos propios de cada región, y clasifica cada pista de forma clara para que puedas elegir el subtítulo con mejor ajuste a tu audiencia o preferencia.

---

## ✨ Características

- Clasificación léxica inteligente
  - 🇲🇽 Latino: detecta vocabulario, pronombres y expresiones comunes de América Latina (`ustedes`, `celular`, `carro`, `manejar`, `enojar`, etc.).
  - 🇪🇸 Castellano: detecta conjugaciones y giros propios de España (`vosotros`, `ordenador`, `coche`, `conducir`, `enfadar`, etc.).
  - 🌎 Neutro: identifica subtítulos con vocabulario equilibrado o sin localismos marcados (solo se emite cuando el análisis encontró datos reales; un archivo sin ningún match léxico recibe 📄, no 🌎).
  - 🎧 Etiquetado SDH (Sordos e Hipoacúsicos): detecta automáticamente subtítulos adaptados con descripciones de audio, efectos sonoros o música (`[música]`, `(suspira)`, notas musicales `♪`), etiquetándolos explícitamente (`(SDH)`) para que el usuario elija con conocimiento de causa.
  - Filtro anti-spam: descarta las pistas con publicidad incrustada (casas de apuestas, canales de Telegram/WhatsApp, enlaces, CTAs en la cabecera o el pie…) durante el propio análisis, sin coste de red adicional. Las frases que también pueden ser diálogo («síguenos en Instagram») solo cuentan al principio o al final del subtítulo, no a mitad de una conversación.

- Solo pistas verificadas y sin duplicados
  - Por título se **analizan hasta 8 candidatos por fuente** y se muestran **como máximo 5 limpios por fuente** (10 pistas en total). Una pista solo se publica si su contenido se descargó y pasó el filtro anti-spam: las descargas fallidas y las que no se llegan a verificar se descartan en vez de colarse sin revisar.
  - Deduplicación por hash de contenido: identifica y descarta clones idénticos del mismo archivo entre fuentes (OpenSubtitles y SubDL), activando la segunda oleada de descarga para sustituirlos por candidatos alternativos y garantizar la máxima variedad real.
  - 📄 Español (sin clasificar): el texto se analizó correctamente, pero no dio un veredicto léxico fiable (contenido válido sin ninguna palabra del léxico). Las descargas que fallan (red, rate limit, HTML de error) no se muestran.

- Sin configuración obligatoria
  - Incluye soporte predeterminado para OpenSubtitles V3.
  - Instala y usa el complemento casi de inmediato.

- Compatibilidad con todos los clientes (móvil, TV y escritorio)
  - Cada subtítulo se envía con el formato canónico del protocolo: `lang` = código ISO 639-2 (`spa`, con el que la app móvil agrupa y lista los subtítulos y con el que funciona la selección automática de idioma) y `label` = etiqueta visible con la bandera y la variante (`🇲🇽 Latino (OS-V3)`), que el escritorio muestra tal cual. Un único formato, sin configuración, igual en todos los dispositivos de la cuenta.

- Integración opcional con SubDL
  - Añade tu [clave API gratuita de SubDL](https://subdl.com/panel/api) para ampliar el catálogo de subtítulos.
  - Los archivos comprimidos (`.zip`) de SubDL **en hosts permitidos** se descomprimen **y se clasifican automáticamente**: reciben la misma etiqueta de región que los subtítulos sueltos. Las entradas que no se pueden servir (`.rar` y `.zip` de hosts fuera de la lista permitida) se descartan en lugar de ofrecer una pista que fallaría al reproducir.

- Privacidad y rendimiento
  - Ejecuta la lógica en Edge con baja latencia.
  - Caché unificada en el Edge: el Worker emite URLs de descarga canónicas (origen + ruta, sin consultas), permitiendo que Vercel y Cloudflare reutilicen las extracciones de `.zip` en caché durante 24 horas y las sirvan al instante (<30 ms en caso de acierto).
  - No almacena datos ni credenciales del usuario: tu clave de SubDL vive en tu configuración de Stremio, no en una base de datos propia. *Nota de transparencia:* la clave solo se utiliza internamente en el Worker para consultar la API de metadatos de SubDL (`api.subdl.com`). Se descarta toda la consulta y fragmento de los enlaces de descarga de SubDL, por lo que **ninguna clave ni parámetro viaja al proxy de Vercel, no queda registrada en sus logs ni se expone a los reproductores de Stremio**. Como en cualquier addon con configuración, la clave viaja en la URL de instalación de Stremio; los registros de diagnóstico efímeros de Cloudflare pueden conservarla hasta 3 días (solo visibles para el administrador).

---

## 🚀 Instalación

1. Abre la configuración del complemento:
   [Configurar HispaSubs](https://hispasubs.ak-forge.workers.dev)

2. (Opcional) Agrega tu clave API de [SubDL](https://subdl.com/panel/api)

3. Haz clic en:
   - **Instalar en Stremio**, o
   - **Copiar URL del Manifest** para añadirlo manualmente en tu cliente preferido.

### Requisitos

- Un cliente Stremio compatible.
- Acceso a Internet para descargar subtítulos.
- (Opcional) Cuenta en SubDL para ampliar resultados.

---

## 🧠 ¿Cómo funciona?

HispaSubs inspecciona el contenido textual de cada subtítulo e identifica patrones lingüísticos con expresiones regulares optimizadas. A partir de esos patrones, clasifica cada pista en una de estas etiquetas, que verás en la lista de subtítulos de Stremio:

| Etiqueta | Significado |
| --- | --- |
| 🇪🇸 Castellano | Analizado. Vocabulario y giros de España. |
| 🇲🇽 Latino | Analizado. Vocabulario latinoamericano. |
| 🌎 Neutro | Analizado. Sin inclinación regional marcada (solo si hubo coincidencias léxicas reales). |
| *(SDH)* | Marcador adicional si la pista incluye adaptaciones acústicas o musicales (ej. `🇪🇸 Castellano (SDH)`). |
| 📄 Español (sin clasificar) | El texto se analizó (y pasó el filtro anti-spam), pero no dio un veredicto léxico fiable: contenido sin términos fuertes del léxico (0 coincidencias o solo términos ambiguos débiles) o texto en portugués mal etiquetado (detectado por densidad de tildes nasales, tanto en minúsculas como en mayúsculas de TV, sin confundir con mojibake UTF-8). Si contiene anotaciones auditivas, se etiqueta como `📄 Español (sin clasificar · SDH)`. Las descargas que fallan (red, rate limit, HTML de error) no se muestran. |

Esto permite distinguir entre versiones del español con matices regionales sin depender de metadatos ambiguos o genéricos.

---

## 🏗️ Arquitectura técnica

- **Worker en Cloudflare (Edge)** — `worker.js` (+ `wrangler.toml`)
  - Gestiona rutas, resolución de manifiestos, consultas en paralelo a las fuentes y la evaluación léxica.
  - Cachea las respuestas de listas (2 h; 60 s cuando un proveedor falla o no hay resultados) y aplica un rate limit por IP con la API nativa de Cloudflare.

- **Proxy en Vercel (Node.js + `adm-zip`)** — `api/proxy.js` (+ `vercel.json`)
  - Descarga los `.zip` de SubDL y extrae el `.srt` en memoria RAM, sin tocar disco. Máximo 4 MB (límite de respuesta de Vercel).
  - Matcher multiepisodio lineal $O(n)$ con protección anti-ReDoS: localiza con precisión el archivo del episodio pedido dentro de packs complejos (`S01E03-04`, `S01E03+E04`, `1x03x04`). Devuelve `422` si el zip no contiene el episodio pedido o carece de subtítulos válidos, y `410` si el archivo ya no existe en el origen.
  - Solo acepta `https`, únicamente los hosts de la allowlist (`dl.subdl.com` y los CDN de OpenSubtitles), solo puerto 443, y valida cada salto de redirección contra IPs privadas (SSRF). Límite defensivo de 512 caracteres en nombres dentro del zip contra ReDoS y descarte total de parámetros de consulta hacia `dl.subdl.com`.
  - Sirve el subtítulo ya limpio al reproductor **y** canaliza el archivo al Worker para su clasificación.
  - Limita las peticiones por IP (`RATE_LIMIT_PER_MIN`; `0` lo desactiva).

- **Fuentes de subtítulos**
  - [OpenSubtitles V3](https://www.opensubtitles.org) (addon de la comunidad de Stremio, siempre activa).
  - [SubDL API v1](https://subdl.com/api-doc) (opcional, requiere clave gratuita).

- **Protocolo**
  - Stremio Addon Protocol v3

---

## 🧪 Desarrollo

```bash
npm test            # requiere Deno (tests del worker) y Node (tests del proxy)
```

- `test_worker.js` (Deno): suite del Worker; incluye una llamada real a OpenSubtitles opcional (best effort).
- `test_proxy.js` (Node): suite del proxy, con `dns.lookup` y `fetch` simulados, así que no necesita red.
- El CI de GitHub Actions ejecuta ambas suites, valida la configuración de despliegue del Worker y falla si `npm audit` detecta vulnerabilidades *high*/*critical*.

Para levantar tu propia instancia, los ficheros de despliegue ya están configurados en el repo (`wrangler.toml` para el Worker y `vercel.json` + `api/proxy.js` para el proxy); solo hacen falta las cuentas gratuitas de Cloudflare y Vercel y las variables de entorno descritas abajo.

### Variables de entorno

| Variable | Componente | Default | Efecto |
| --- | --- | --- | --- |
| `PROXY_URL` | Worker | proxy de Vercel | URL base del proxy de extracción, para despliegues propios (`https://tu-dominio/proxy`; debe ser **https**). Se le añade `zipUrl=` como parámetro. |
| `SPAM_FILTER` | Worker | vacío | Con `log`, activa el **modo sombra**: registra en los logs qué pistas se descartarían por spam pero las sirve igual (para medir antes de activar el descarte). Cualquier otro valor descarta. |
| `RATE_LIMIT` | Worker | `120` | Peticiones sin caché por minuto e IP. `0` lo desactiva; para subir el tope se edita `wrangler.toml` (`[[ratelimits]] simple.limit`). |
| `RATE_LIMIT_PER_MIN` | Proxy (Vercel) | `120` | Peticiones con descarga por minuto e IP. `0` lo desactiva. |
| `FETCH_TIMEOUT_MS` | Proxy (Vercel) | `8000` | Timeout que cubre descarga de cabeceras **y** cuerpo del zip. |

---

## 🛡️ Protección contra abuso

Para evitar abusos, ambos componentes aplican un límite de peticiones por IP (las respuestas cacheadas no consumen cuota, así que el uso normal no lo notará). Si compartes IP pública con mucha gente (CGNAT de operadora) y ves errores `429`, consulta [Solución de problemas](#-solución-de-problemas).

---

## 📦 Casos de uso

- Ver contenido latino con subtítulos que reflejen vocabulario y expresiones propias del idioma de América Latina.
- Ver contenido español con subtítulos en castellano sin confusiones con variantes americanas.
- Elegir mejor un archivo “Español” cuando el texto del subtítulo es claramente más cercano a una región concreta.

---

## 🛠️ Solución de problemas

### Veo subtítulos con la etiqueta 📄 “Español (sin clasificar)”
El análisis consume recursos, así que por título se **descargan hasta 8 candidatos por fuente** (OpenSubtitles y SubDL) y se muestran **como máximo 5 limpios por fuente**: lo que no se puede verificar se descarta, y lo que falla al descargar (rate limit del proveedor, red, HTML de error) no se muestra como pista. La etiqueta 📄 aparece cuando el análisis **sí** se completó sobre un texto válido pero no encontró términos fuertes suficientes para decidir (0 coincidencias, solo términos débiles ambiguos o archivo en portugués mal etiquetado) — en ese caso no se afirma “🌎 Neutro” porque no hay datos reales que lo respalden. Los subtítulos con publicidad incrustada (casas de apuestas, canales de Telegram/WhatsApp, CTAs de app/web…) se descartan automáticamente; una simple línea de crédito (“Traducido por X”) no basta para eliminarlos. Una clave de SubDL amplía el catálogo disponible.

### No veo subtítulos de SubDL
Comprueba que tu clave es válida probándola directamente:
`https://api.subdl.com/api/v1/subtitles?api_key=TU_CLAVE&imdb_id=tt1375666&type=movie&languages=ES`
Si responde `"status": false`, regenera la clave en [tu panel de SubDL](https://subdl.com/panel/api) y reinstala el complemento desde la página de configuración. *Nota sobre la cuota:* Tu clave solo se utiliza para consultar el catálogo de subtítulos; al descargar y extraer los archivos, HispaSubs no envía la clave al CDN de SubDL para no consumir tu límite diario de descargas.

### La app móvil (Android/iOS) no muestra ningún resultado
La app móvil agrupa los subtítulos por **código de idioma**, así que el complemento envía `lang` como código ISO válido (`spa`) y la etiqueta visible va en `label`. Si aun así no ves ninguna entrada, reinstala el complemento desde la [página de configuración](https://hispasubs.ak-forge.workers.dev) y reinicia la app. Nota: en Android TV hay un bug conocido de Stremio (versiones 1.11.x) en el que los subtítulos de addons aparecen pero no se muestran al elegirlos; se arregla reiniciando la app.

### En el móvil todas las filas ponen «HispaSubs» (no se ve la bandera)
Es una limitación del cliente móvil, no del complemento: la app rellena el título de cada fila con el **nombre del complemento** y no reenvía el campo `label`, así que ahí no se muestra la bandera. Los subtítulos siguen siendo correctos y funcionales: el idioma se agrupa por `spa` y la variante se comprueba al reproducir. En escritorio (stremio-web) sí se muestra `label`, así que ahí las banderas y variantes se ven con normalidad.

### La selección automática de subtítulos en español no funciona
La selección automática compara `lang` con códigos ISO; con texto libre en `lang` nunca coincidía, y por eso antes no funcionaba. Con `lang = spa` el escritorio autoselecciona los subtítulos en español y muestra la variante (`label`) sin perderla.

### La lista de subtítulos tarda un poco en aparecer
Si hay `.zip` de SubDL, se descargan, descomprimen y analizan la primera vez (~1-2 s; el peor caso —fuente lenta + varios zips— puede acercarse a los 10 s, que es el margen que espera Stremio). Stremio cachea la respuesta (y el complemento la cachea 2 h); en peticiones siguientes aparece al instante.

### Recibo errores 429 («Demasiadas peticiones»)
El complemento limita las peticiones sin caché por IP (con un umbral holgado por defecto) para evitar abusos; en uso normal es muy difícil de topar. Solo aparece si compartes IP pública con mucha gente (típico de CGNAT en operadora móvil) y pasa en cuanto la ventana de un minuto se reinicia. Las respuestas cacheadas no consumen cuota, así que el uso normal no lo notará.

---

## 📄 Licencia

Este proyecto está publicado bajo la [Licencia MIT](LICENSE).

---

## 🤝 Contribuciones

Si quieres colaborar, puedes:

- reportar errores,
- sugerir mejoras en la detección léxica,
- proponer nuevos patrones de regionalización,
- mejorar la documentación o la experiencia de instalación.

---

## 🔗 Enlaces útiles

- [Configurar HispaSubs](https://hispasubs.ak-forge.workers.dev)
- [Panel de claves API de SubDL](https://subdl.com/panel/api)
- [Documentación de la API de SubDL](https://subdl.com/api-doc)
- [Repositorio GitHub](https://github.com/the-ak-forge/hispasubs)
