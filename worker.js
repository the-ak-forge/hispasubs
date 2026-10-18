// ============================================================================
// HispaSubs — Cloudflare Worker v1.3.3
// Addon de Stremio: subtítulos en español clasificados por dialecto.
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
//  - Se añaden plurales con (?:es)? / s? porque "\bcoche\b" no matchea "coches".
//  - "m[oó]vil" tolera SRTs mal codificados.
//  - String.match(/g/) resetea lastIndex, así que el flag g es seguro aquí
//    (NO cambiar a .test() sin resetear lastIndex a mano).
const DICT_ES = /\b(vosotros|ordenador(?:es)?|coche[s]?|gilipollas|hostias?|chaval(?:es)?|follar|joder|guay|m[oó]vil(?:es)?|patata[s]?|zumo[s]?|aparcar|conducir|enfadar|nevera[s]?|jol[ií]n|mola|vale)\b/gi;
const DICT_LAT = /\b(computadora[s]?|carro[s]?|auto(?:s)?|pendejo(?:s|jas)?|chingar|platicar|celular(?:es)?|jugo[s]?|estacionar|manejar|enojar|refrigerador(?:es)?|ustedes|chavo(?:s)?|wey|güey|neta[s]?|papa[s]?|carajo|[oó]rale|chido|bacano)\b/gi;

// Túnel Node.js en Vercel como motor de extracción de zips.
// IMPORTANTE: el proxy DEBE llevar allowlist de hosts (ver api/proxy.js),
// si no, cualquiera puede usar tu servidor como open proxy/SSRF.
const VERCEL_UNZIPPER = "https://hispasubs.vercel.app/proxy?zipUrl=";

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
// matchear, sesgando todo hacia "Neutro".
//
// La lectura va ACOTADA a 1 MB: con arrayBuffer() completo, un fichero
// enorme (o una respuesta que no es un subtítulo) podía cargar cientos de MB
// en el isolate (128 MB) y tumbar la petición. Para muestrear el léxico,
// 1 MB es un techo más que holgado.
const MAX_ANALYZE_BYTES = 1024 * 1024;

const fetchSubtitleText = async (url, ms = 2000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_ANALYZE_BYTES) throw new Error("subtítulo demasiado grande");
    const buf = await readCapped(res, MAX_ANALYZE_BYTES);
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("\uFFFD")) {
      try { text = new TextDecoder("windows-1252").decode(buf); } catch { /* codec no disponible: nos quedamos con UTF-8 */ }
    }
    return text;
  } finally {
    clearTimeout(timer); // también cubre el body: abort() corta el stream
  }
};

// Lee como mucho `max` bytes y cancela el stream. En entornos sin streaming
// (o si el body ya viene materializado) caemos a arrayBuffer() y cortamos.
async function readCapped(res, max) {
  if (!res.body || typeof res.body.getReader !== "function") {
    const ab = await res.arrayBuffer();
    return ab.byteLength > max ? ab.slice(0, max) : ab;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || total >= max) break;
    const room = max - total;
    const take = value.length > room ? value.subarray(0, room) : value;
    chunks.push(take);
    total += take.length;
  }
  try { await reader.cancel(); } catch { /* stream ya cerrado */ }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
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
const jsonResponse = (obj, cacheSeconds) =>
  new Response(JSON.stringify(obj), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
      ...(cacheSeconds ? { "Cache-Control": `public, max-age=${cacheSeconds}` } : {}),
    },
  });

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
const rateLimitFallback = (ip, limit) => {
  const now = Date.now();
  if (rateHits.size > 5000) {
    for (const [k, v] of rateHits) if (v.reset <= now) rateHits.delete(k);
  }
  let entry = rateHits.get(ip);
  if (!entry || entry.reset <= now) {
    entry = { count: 0, reset: now + 60_000, warned: false };
    rateHits.set(ip, entry);
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
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Configuración | HispaSubs</title><style>body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background-color: #121212; color: #ffffff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; } .container { background-color: #1e1e1e; padding: 40px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); max-width: 500px; width: 100%; text-align: center; } h1 { margin-top: 10px; color: #00d2ff; font-size: 28px; } p { color: #aaaaaa; font-size: 14px; margin-bottom: 24px; line-height: 1.5; } .form-group { text-align: left; margin-bottom: 20px; } label { display: block; margin-bottom: 8px; font-weight: bold; font-size: 14px; } input { width: 100%; padding: 12px; border: 1px solid #333; border-radius: 6px; background-color: #2a2a2a; color: #fff; box-sizing: border-box; font-family: monospace; } input:focus { outline: none; border-color: #00d2ff; } .btn-container { display: flex; flex-direction: column; gap: 10px; margin-top: 15px; } button { font-size: 16px; font-weight: bold; border-radius: 6px; cursor: pointer; width: 100%; padding: 14px 24px; transition: all 0.3s; } .btn-primary { background-color: #00d2ff; color: #121212; border: none; } .btn-primary:hover { background-color: #00a8cc; transform: translateY(-2px); } .btn-secondary { background-color: transparent; color: #00d2ff; border: 2px solid #00d2ff; } </style></head><body><div class="container"><div>${LOGO_SVG}</div><h1>HispaSubs</h1><p>Clasificación léxica en tiempo real para Stremio.<br>Detecta automáticamente modismos en español y los divide en <strong>🇲🇽 Latino</strong>, <strong>🇪🇸 Castellano</strong> y <strong>🌎 Neutro</strong>.</p><div class="form-group"><label>SubDL API Key (Opcional - Expande catálogo)</label><input type="password" id="subdlKey" placeholder="ej: abc123def456..." value="${esc(existingConfig.subdlKey || "")}"></div><div class="btn-container"><button class="btn-primary" onclick="installAddon()">Instalar en Stremio</button><button class="btn-secondary" id="copyBtn" onclick="copyManifest()">Copiar URL del Manifest</button></div></div>
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
  version: "1.3.3",
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
const getOpenSubtitlesV3 = async (type, fullId) => {
  try {
    const data = await fetchJSON(
      `https://opensubtitles-v3.strem.io/subtitles/${type}/${encodeURIComponent(fullId)}.json`,
      2500
    );
    return (data.subtitles || [])
      // Guard por entrada: una sub sin URL ya no invalida toda la fuente.
      .filter((sub) => sub && isHttpUrl(sub.url))
      .filter((sub) => {
        // ISO 639-2 ("spa") y variantes usuales ("es", "es-ES", "es-419",
        // "esp", "span"): el resto de idiomas se descarta. Antes solo
        // aceptaba includes("spa") o "es" exacto.
        const l = (sub.lang || "").toLowerCase().trim();
        return /^(?:spa|esp|span|es)(?:[-_][a-z0-9]{2,8})?$/.test(l);
      })
      .map((sub) => ({
        id: sub.id || `os_${hashStr(sub.url)}`,
        url: sub.url,
        lang: "spa",
        source: "OS-V3",
      }));
  } catch (e) {
    console.error("[OS-V3]", e.message);
    return [];
  }
};

// 2. SubDL
const getSubDL = async (imdbId, season, episode, apiKey, mediaType = "movie") => {
  // Sin clave no se consulta nada (pero se deja constancia en el log para
  // que "SubDL no aparece nunca" sea diagnosticable).
  if (!apiKey) {
    console.log("[SubDL] sin api_key en la config: se omite la fuente");
    return [];
  }
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
    // SubDL responde 200 con status:false (p.ej. key revocada, cuota agotada).
    // Antes esto se tragaba en silencio; ahora queda en los logs.
    if (data.status === false || !Array.isArray(data.subtitles)) {
      console.error("[SubDL] respuesta sin subs:", data.error || "campo subtitles ausente", data.message || "");
      return [];
    }
    if (data.subtitles.length === 0) {
      console.log(`[SubDL] 0 resultados para ${imdbId} (${subdlType}${season ? ` s${season}e${episode}` : ""})`);
    }

    const out = data.subtitles
      .map((sub, i) => {
        if (!sub || typeof sub.url !== "string" || !sub.url.trim()) return null;
        // SubDL devuelve URLs RELATIVAS ("/subtitle/111-222.zip", según la doc
        // oficial). El guard de seguridad iba ANTES de absolutizar, así que
        // descartaba TODAS las entradas de SubDL en silencio. Orden correcto:
        // 1) absolutizar, 2) validar el resultado.
        const raw = sub.url.trim();
        const dlUrl = raw.startsWith("http")
          ? raw
          : raw.startsWith("/") // relativa tipo /subtitle/123.zip (doc oficial)
            ? `https://dl.subdl.com${raw}`
            : null; // cualquier otra cosa (javascript:, datos, basura) se descarta
        if (!dlUrl || !isHttpUrl(dlUrl)) return null; // SSRF: solo http(s)
        return {
          // file_id como fallback: índice determinista, nunca Math.random().
          id: sub.file_id ? `sdl_${sub.file_id}` : `sdl_${hashStr(dlUrl)}_${i}`,
          url: dlUrl,
          lang: "spa",
          source: "SubDL",
        };
      })
      .filter(Boolean); // entradas malformadas se descartan una a una
    // Caso que antes quedaba mudo: la API devuelve subs pero ninguno con url
    // descargable (p.ej. solo referencias a página web). Sin este log, "SubDL=0"
    // sería indistinguible de "0 resultados".
    if (data.subtitles.length > 0 && out.length === 0) {
      console.error(`[SubDL] ${data.subtitles.length} subs en la respuesta pero ninguno con url descargable`);
    }
    return out;
  } catch (e) {
    // 403 en SubDL casi siempre es clave rechazada/caducada o cuota
    // agotada, no un fallo de red: se dice explícitamente para no tener que
    // adivinarlo ante reports de "no veo subs de SubDL".
    const extra = e.message.includes("403")
      ? "(clave rechazada o cuota agotada: se omite SubDL en este título)"
      : "";
    console.error("[SubDL]", e.message, extra);
    return [];
  }
};

// ---------------------------------------------------------------------------
// Motor de análisis léxico
// ---------------------------------------------------------------------------

// 📄 = "no analizado" (nunca una variante): distinto de 🇪🇸/🇲🇽/🌎.
const unclassified = (sub, finalUrl) => ({
  id: sub.id,
  url: finalUrl,
  lang: LANG_ISO_ES,
  label: `📄 Español (sin clasificar · ${sub.source})`,
});

const classifySubtitle = async (sub) => {
  // Guard ANTES de cualquier acceso a sub.url (evita el crash en cascada
  // de Promise.all del 1.0.0).
  if (!sub || !isHttpUrl(sub.url)) return null;

  // Los .zip no se pueden analizar en crudo, PERO el proxy de Vercel los
  // descomprime y devuelve el SRT: se clasifican a través de él. El URL que
  // recibe Stremio es también el del proxy (Stremio no descomprime).
  const isZip = isCompressed(sub.url);
  const finalUrl = isZip ? `${VERCEL_UNZIPPER}${encodeURIComponent(sub.url)}` : sub.url;

  try {
    // El proxy tarda más (descarga + descomprime): timeout amplio para zips.
    const text = await fetchSubtitleText(finalUrl, isZip ? 6000 : 2000);

    // Validación del CONTENIDO antes de etiquetar. "🌎 Neutro" significaba
    // "vocabulario equilibrado", pero con HTML de error, binario (un zip sin
    // descomprimir), vacío o 0 matches lo que había era CERO datos, y de cero
    // datos no se puede afirmar que nada: eso es 📄 "sin clasificar".
    const sample = text.trim();
    const isHtml = /^\s*<(!doctype|html|head|meta|title|body|div|p|span|table)\b/i.test(sample);
    const looksLikeZip = sample.charCodeAt(0) === 0x50 && sample.charCodeAt(1) === 0x4b;
    if (!sample || looksLikeZip || isHtml) {
      console.error("[classify]", sub.source, "contenido que no es texto de subtítulo");
      return unclassified(sub, finalUrl);
    }

    const esMatches = (text.match(DICT_ES) || []).length;
    const latMatches = (text.match(DICT_LAT) || []).length;
    const total = esMatches + latMatches;
    if (total === 0) {
      // Ni una sola palabra del léxico: probablemente no sea un subtítulo en
      // español ni siquiera (idioma erróneo, fichero de créditos...).
      return unclassified(sub, finalUrl);
    }

    // Margen proporcional: con 3 apariciones de "coche" ya no decides un
    // subtítulo entero; hace falta cierta ventaja relativa.
    const margin = Math.max(2, Math.floor(total * 0.15));

    let flag = "🌎 Neutro";
    if (esMatches > latMatches + margin) flag = "🇪🇸 Castellano";
    else if (latMatches > esMatches + margin) flag = "🇲🇽 Latino";

    return { id: sub.id, url: finalUrl, lang: LANG_ISO_ES, label: `${flag} (${sub.source})` };
  } catch (error) {
    console.error("[classify]", sub.source, error.message);
    return unclassified(sub, finalUrl);
  }
};

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
    if (pathParts.length === 0 || pathParts[pathParts.length - 1] === "configure") {
      let existingConfig = {};
      if (pathParts.length > 1) existingConfig = parseConfig(pathParts[0]);
      return new Response(getConfigureHTML(existingConfig), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
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
        const cached = await cacheMatch(request);
        if (cached) return cached;

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

        const [osSubs, sdlSubs] = await Promise.allSettled([
          getOpenSubtitlesV3(type, fullId),
          getSubDL(imdbId, season, episode, config.subdlKey, type),
        ]);

        // Diagnóstico por fuente: permite ver en los logs de Cloudflare
        // cuánto aporta cada una y cuál falla.
        console.log(
          `[subtitles] ${type}/${fullId}: ` +
            `OS-V3=${osSubs.status === "fulfilled" ? osSubs.value.length : "ERROR " + osSubs.reason?.message} ` +
            `SubDL=${sdlSubs.status === "fulfilled" ? sdlSubs.value.length : "ERROR " + sdlSubs.reason?.message}`
        );

        const rawSubs = [
          ...(osSubs.status === "fulfilled" ? osSubs.value : []),
          ...(sdlSubs.status === "fulfilled" ? sdlSubs.value : []),
        ];

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
          const empty = jsonResponse({ subtitles: [] }, 60);
          cachePut(ctx, request, empty);
          return empty;
        }

        // Análisis equilibrado: hasta 3 por fuente. En 1.0.0 las subs de
        // SubDL quedaban siempre sin analizar si OS devolvía ≥5.
        const budget = { "OS-V3": 3, "SubDL": 3 };
        const analyzed = await Promise.all(
          deduped.map((sub) => {
            if (budget[sub.source] > 0) {
              budget[sub.source] -= 1;
              return classifySubtitle(sub);
            }
            // Sin presupuesto de análisis: se enrutan igualmente (los .zip
            // vía proxy) y se etiquetan explícitamente como NO analizados.
            const finalUrl = isCompressed(sub.url)
              ? `${VERCEL_UNZIPPER}${encodeURIComponent(sub.url)}`
              : sub.url;
            return { id: sub.id, url: finalUrl, lang: LANG_ISO_ES, label: `📄 Español (sin clasificar · ${sub.source})` };
          })
        );

        const subtitles = analyzed.filter(Boolean);
        const response = jsonResponse({ subtitles }, 7200);
        cachePut(ctx, request, response);
        return response;
      } catch (err) {
        // Los errores de una request no deben romper la respuesta de Stremio,
        // pero al menos ahora quedan registrados. Caché negativa corta (60 s)
        // para no repetir el fallo en cada petición del mismo título.
        console.error("[subtitles] error inesperado:", err.message);
        const failed = jsonResponse({ subtitles: [] }, 60);
        cachePut(ctx, request, failed);
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
