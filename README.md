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
  - 📄 Español (sin clasificar): subtítulos que no llegaron a analizarse o cuyo contenido no resultó ser texto de subtítulo (HTML de error, binario, vacío o sin coincidencias léxicas; ver [Solución de problemas](#-solución-de-problemas)).

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
  - No almacena datos ni credenciales del usuario: tu clave de SubDL vive en tu configuración de Stremio, no en servidores propios. *Nota de transparencia:* esa clave viaja codificada en la URL de instalación (formato base64url del propio protocolo de configuración de Stremio) y se envía como parámetro de consulta `api_key` en las llamadas a la API de SubDL; no se registra en ningún servidor propio, pero cualquiera que intercepte la petición a `api.subdl.com` podría leerla (igual que con cualquier addon que use esta API).

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
| 📄 Español (sin clasificar) | En español, pero sin analizar: se analizan hasta 3 subtítulos por fuente por título, el análisis falló (p. ej. rate limit del proveedor) o el contenido no era texto de subtítulo (HTML de error, binario, vacío o sin ninguna palabra del léxico). |

Esto permite distinguir entre versiones del español con matices regionales sin depender de metadatos ambiguos o genéricos.

---

## 🏗️ Arquitectura técnica

- **Worker en Cloudflare (Edge)** — `worker.js` (+ `wrangler.toml`)
  - Gestiona rutas, resolución de manifiestos, consultas en paralelo a las fuentes y la evaluación léxica.
  - Cachea respuestas de listas (2 h; resultados vacíos o con fallos 60 s) y aplica un rate limit por IP (Workers Rate Limiting API; el tope vive en `wrangler.toml` → `[[ratelimits]] simple.limit`, y `RATE_LIMIT = "0"` lo desactiva).

- **Proxy en Vercel (Node.js + `adm-zip`)** — `api/proxy.js` (+ `vercel.json`)
  - Descarga los `.zip` de SubDL y extrae el `.srt` en memoria RAM, sin tocar disco. Máximo 4 MB (límite de respuesta de Vercel).
  - Solo acepta `https`, únicamente los hosts de la allowlist (`dl.subdl.com` y los CDN de OpenSubtitles), solo puerto 443, y valida cada salto de redirección contra IPs privadas (SSRF).
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
- El CI de GitHub Actions ejecuta ambas suites en cada *push*, valida `wrangler.toml` con `wrangler deploy --dry-run` y falla si `npm audit` detecta vulnerabilidades *high*/*critical*.

Para levantar tu propia instancia, los ficheros de despliegue ya están configurados en el repo (`wrangler.toml` para el Worker y `vercel.json` + `api/proxy.js` para el proxy); solo hacen falta las cuentas gratuitas de Cloudflare y Vercel y las variables de entorno descritas abajo.

### Variables de entorno

| Variable | Componente | Default | Efecto |
| --- | --- | --- | --- |
| `RATE_LIMIT` | Worker (env var) | `120` | Solo el fallback in-memory (tests/entornos sin binding). `0` desactiva el rate limit por completo. **No** sube el tope en producción: para eso se edita `[[ratelimits]] simple.limit` en `wrangler.toml`. |
| `PROXY_URL` | Worker (env var) | proxy de Vercel | URL base del proxy de extracción, para despliegues propios (`https://tu-dominio/proxy`). Se le añade `zipUrl=` como parámetro. |
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
El análisis consume recursos, así que por título se analizan hasta **3 subtítulos por fuente** (OpenSubtitles y SubDL); el resto se muestra sin analizar para mantener la respuesta rápida — en la práctica, los primeros de la lista suelen estar clasificados. También aparece 📄 si la descarga del archivo para analizarlo falló (p. ej. límite de peticiones del proveedor), o si el contenido descargado no resultó ser texto de subtítulo (una página HTML de error, un binario, un archivo vacío o uno sin ninguna palabra del léxico): en esos casos no se afirma “🌎 Neutro” porque no hay datos reales que lo respalden. Una clave de SubDL amplía el catálogo disponible.

### No veo subtítulos de SubDL
Comprueba que tu clave es válida probándola directamente:
`https://api.subdl.com/api/v1/subtitles?api_key=TU_CLAVE&imdb_id=tt1375666&type=movie&languages=ES`
Si responde `"status": false`, regenera la clave en [tu panel de SubDL](https://subdl.com/panel/api) y reinstala el complemento desde la página de configuración.

### La app móvil (Android/iOS) no muestra ningún resultado
La app móvil agrupa los subtítulos por **código de idioma**, así que `lang` debe ser un código ISO válido (`spa`) y la etiqueta visible va en `label`; ese es el formato que devuelve el complemento desde la v1.3.0 (sin configuración). Si aun así no ves ninguna entrada, reinstala el complemento desde la [página de configuración](https://hispasubs.ak-forge.workers.dev) (el formato ya no depende de la URL de instalación) y reinicia la app. Nota: en Android TV hay un bug conocido de Stremio (versiones 1.11.x) en el que los subtítulos de addons aparecen pero no se muestran al elegirlos, por el servidor local (`127.0.0.1:11470`); se arregla reiniciando la app o desde Stremio.

### En el móvil todas las filas ponen «HispaSubs» (no se ve la bandera)
No es configurable desde el complemento: es una limitación del cliente móvil. La app de Android habla con el núcleo (Rust) por protobuf y el puente `stremio-core-kotlin` no reenvía el campo `label`; en su lugar rellena `name` con el **nombre del complemento**:

```proto
message Subtitle { required string id = 1; required string lang = 2; required string url = 3; optional string name = 4; }
```
```rust
types::Subtitle { id, lang, url, name: addon_name.cloned() }   // name = nombre del addon
```

Por eso cada fila móvil se titula con el nombre del addon y no con `label`. Los subtítulos siguen siendo correctos y funcionales: el idioma se agrupa por `spa` y la variante se comprueba al reproducir. En escritorio (stremio-web) sí se muestra `label`, así que ahí las banderas y variantes se ven con normalidad.

### La selección automática de subtítulos en español no funciona
Estaba relacionado con lo anterior: la selección automática compara `lang` con códigos ISO (`languages.find()`), y con texto libre (`🇲🇽 Latino (OS-V3)`) nunca coincidía. Desde la v1.3.0 `lang` es `spa`, así que el escritorio ya autoselecciona los subtítulos en español y muestra la variante (`label`) sin perderla.

### La lista de subtítulos tarda un poco en aparecer
Si hay `.zip` de SubDL, se descargan, descomprimen y analizan la primera vez (~1-2 s; el peor caso con varios zips ronda los 8 s, que es el tiempo máximo que el proxy espera por archivo). Stremio cachea la respuesta (y el complemento la cachea 2 h); en peticiones siguientes aparece al instante.

### Recibo errores 429 («Demasiadas peticiones»)
El complemento limita las peticiones sin caché por IP (con un umbral holgado por defecto) para evitar abusos. Es muy difícil de tocar en uso normal, pero si compartes IP pública con mucha gente (CGNAT de operadora), el propietario del addon puede subir el límite sin necesidad de desactivarlo: en el Worker editando `[[ratelimits]] simple.limit` de `wrangler.toml` y redesplegando (la variable `RATE_LIMIT` solo sirve para ponerlo a `0`; no cambia el tope del binding), y en el Vercel con `RATE_LIMIT_PER_MIN`.

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
