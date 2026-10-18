# HispaSubs 🇲🇽 🇪🇸

> Clasificador inteligente de subtítulos en español para Stremio

HispaSubs te ayuda a identificar rápidamente si un subtítulo está orientado a España, Latinoamérica o si es neutral. Evita el problema clásico de activar un archivo marcado como “Español” y descubrir, a mitad de la reproducción, que está escrito con un vocabulario regional muy distinto al que esperabas.

El complemento analiza el texto de los subtítulos, detecta expresiones, pronombres y modismos propios de cada región, y clasifica cada pista de forma clara para que puedas elegir el subtítulo con mejor ajuste a tu audiencia o preferencia.

---

## ✨ Características

- Clasificación léxica inteligente
  - 🇲🇽 Latino: detecta vocabulario, pronombres y expresiones comunes de América Latina (`ustedes`, `celular`, `carro`, `manejar`, `enojar`, etc.).
  - 🇪🇸 Castellano: detecta conjugaciones y giros propios de España (`vosotros`, `ordenador`, `coche`, `conducir`, `enfadar`, etc.).
  - 🌎 Neutro: identifica subtítulos con vocabulario equilibrado o sin localismos marcados.
  - 📄 Español (sin clasificar): subtítulos en español que no llegaron a analizarse (ver [Solución de problemas](#-solución-de-problemas)).

- Sin configuración obligatoria
  - Incluye soporte predeterminado para OpenSubtitles V3.
  - Instala y usa el complemento casi de inmediato.

- Compatibilidad con todos los clientes (móvil, TV y escritorio)
  - Cada subtítulo se envía con el formato canónico del protocolo: `lang` = código ISO 639-2 (`spa`, con el que la app móvil agrupa y lista los subtítulos y con el que funciona la selección automática de idioma) y `label` = etiqueta visible con la bandera y la variante (`🇲🇽 Latino (OS-V3)`), que el escritorio muestra tal cual. Un único formato, sin configuración, igual en todos los dispositivos de la cuenta.

- Integración opcional con SubDL
  - Añade tu [clave API gratuita de SubDL](https://subdl.com/panel/api) para ampliar el catálogo de subtítulos.
  - Los archivos comprimidos (`.zip`) de SubDL se descomprimen **y se clasifican automáticamente**: reciben la misma etiqueta de región que los subtítulos sueltos.

- Privacidad y rendimiento
  - Ejecuta la lógica en Edge con baja latencia.
  - No almacena datos ni credenciales del usuario: tu clave de SubDL vive en tu configuración de Stremio, no en servidores propios.

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
| 🌎 Neutro | Analizado. Sin inclinación regional marcada. |
| 📄 Español (sin clasificar) | En español, pero sin analizar: se analizan hasta 3 subtítulos por fuente por título, o el análisis falló (p. ej. rate limit del proveedor). |

Esto permite distinguir entre versiones del español con matices regionales sin depender de metadatos ambiguos o genéricos.

---

## 🏗️ Arquitectura técnica

- **Worker en Cloudflare (Edge)**
  - Gestiona rutas, resolución de manifiestos, consultas en paralelo a las fuentes y la evaluación léxica.
  - Cachea respuestas de listas para no repetir análisis.

- **Proxy en Vercel (Node.js + `adm-zip`)**
  - Descarga los `.zip` de SubDL y extrae el `.srt` en memoria RAM, sin tocar disco.
  - Sirve el subtítulo ya limpio al reproductor **y** canaliza el archivo al Worker para su clasificación.

- **Fuentes de subtítulos**
  - [OpenSubtitles V3](https://www.opensubtitles.org) (addon de la comunidad de Stremio, siempre activa).
  - [SubDL API v1](https://subdl.com/api-doc) (opcional, requiere clave gratuita).

- **Protocolo**
  - Stremio Addon Protocol v3

---

## 📦 Casos de uso

- Ver contenido latino con subtítulos que reflejen vocabulario y expresiones propias del idioma de América Latina.
- Ver contenido español con subtítulos en castellano sin confusiones con variantes americanas.
- Elegir mejor un archivo “Español” cuando el texto del subtítulo es claramente más cercano a una región concreta.

---

## 🛠️ Solución de problemas

### Veo subtítulos con la etiqueta 📄 “Español (sin clasificar)”
El análisis consume recursos, así que por título se analizan hasta **3 subtítulos por fuente** (OpenSubtitles y SubDL); el resto se muestra sin analizar para mantener la respuesta rápida — en la práctica, los primeros de la lista suelen estar clasificados. También aparece 📄 si la descarga del archivo para analizarlo falló (p. ej. límite de peticiones del proveedor). Una clave de SubDL amplía el catálogo disponible.

### No veo subtítulos de SubDL
Comprueba que tu clave es válida probándola directamente:
`https://api.subdl.com/api/v1/subtitles?api_key=TU_CLAVE&imdb_id=tt1375666&type=movie&languages=ES`
Si responde `"status": false`, regenera la clave en [tu panel de SubDL](https://subdl.com/panel/api) y reinstala el complemento desde la página de configuración.

### La app móvil (Android/iOS) no muestra ningún resultado
La app móvil agrupa los subtítulos por **código de idioma**, así que `lang` debe ser un código ISO válido (`spa`) y la etiqueta visible va en `label`; ese es el formato que devuelve el complemento desde la v1.3.0 (sin configuración). Si aun así no ves ninguna entrada, reinstala el complemento desde la [página de configuración](https://hispasubs.ak-forge.workers.dev) (el formato ya no depende de la URL de instalación) y reinicia la app. Nota: en Android TV hay un bug conocido de Stremio (versiones 1.11.x) en el que los subtítulos de addons aparecen pero no se muestran al elegirlos, por el servidor local (`127.0.0.1:11470`); se arregla reiniciando la app o desde Stremio.

### La selección automática de subtítulos en español no funciona
Estaba relacionado con lo anterior: la selección automática compara `lang` con códigos ISO (`languages.find()`), y con texto libre (`🇲🇽 Latino (OS-V3)`) nunca coincidía. Desde la v1.3.0 `lang` es `spa`, así que el escritorio ya autoselecciona los subtítulos en español y muestra la variante (`label`) sin perderla.

### La lista de subtítulos tarda un poco en aparecer
Si hay `.zip` de SubDL, se descargan, descomprimen y analizan la primera vez (~1-2 s). Stremio cachea la respuesta; en peticiones siguientes aparece al instante.

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
