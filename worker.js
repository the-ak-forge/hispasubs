// ============================================================================
// HispaSubs — Cloudflare Worker v1.2.0
// Addon de Stremio: subtítulos en español clasificados por dialecto.
//
// v1.2.0: formatos de `lang` configurables para la app móvil (etiquetas /
//         híbrido "spa 🇲🇽 Latino" / solo ISO 639-2 "spa").
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
const isCompressed = (u) => /\.(zip|rar)(\?|$)/i.test(u);

// Formato del campo `lang`. Tres modos (config.langMode, elegible en
// /configure):
//  - "label"  (por defecto): etiqueta descriptiva "🇲🇽 Latino (OS-V3)".
//  - "iso":    código ISO 639-2 limpio "spa" (máxima compatibilidad móvil).
//  - "hybrid": "spa 🇲🇽 Latino" — código ISO como prefijo + etiqueta visible.
// La app móvil de Stremio (núcleo Rust) agrupa los subtítulos por código de
// idioma y con texto libre no llega a mostrar ninguno en el selector del
// reproductor; "hybrid" busca compatibilidad SIN perder la etiqueta.
// isoLang:true se mantiene como alias retrocompatible de "iso".
const LANG_ISO_ES = "spa";
const subLang = (langMode, label) =>
  langMode === "iso" ? LANG_ISO_ES : langMode === "hybrid" ? `${LANG_ISO_ES} ${label}` : label;
const langModeOf = (config) =>
  config.langMode === "iso" || config.langMode === "hybrid" ? config.langMode : config.isoLang === true ? "iso" : "label";

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
const fetchSubtitleText = async (url, ms = 2000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("\uFFFD")) {
      try { text = new TextDecoder("windows-1252").decode(buf); } catch { /* codec no disponible: nos quedamos con UTF-8 */ }
    }
    return text;
  } finally {
    clearTimeout(timer); // también cubre el body: abort() corta el stream
  }
};

// Cache API tolerante: en algunos entornos caches.default no está disponible.
const cacheMatch = async (request) => {
  try { return await caches.default.match(request); } catch (_) { return undefined; }
};
const cachePut = (ctx, request, response) => {
  try {
    ctx.waitUntil(caches.default.put(request, response.clone()).catch(() => {}));
  } catch { /* caches.default no disponible en este entorno: seguimos sin cache */ }
};

const jsonResponse = (obj) =>
  new Response(JSON.stringify(obj), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    },
  });

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

const getConfigureHTML = (existingConfig = {}) => {
  // langMode preseleccionado en el <select> (ver langModeOf).
  const mode = langModeOf(existingConfig);
  return `
<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Configuración | HispaSubs</title><style>body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background-color: #121212; color: #ffffff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; } .container { background-color: #1e1e1e; padding: 40px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); max-width: 500px; width: 100%; text-align: center; } h1 { margin-top: 10px; color: #00d2ff; font-size: 28px; } p { color: #aaaaaa; font-size: 14px; margin-bottom: 24px; line-height: 1.5; } .form-group { text-align: left; margin-bottom: 20px; } label { display: block; margin-bottom: 8px; font-weight: bold; font-size: 14px; } input { width: 100%; padding: 12px; border: 1px solid #333; border-radius: 6px; background-color: #2a2a2a; color: #fff; box-sizing: border-box; font-family: monospace; } input:focus { outline: none; border-color: #00d2ff; } .btn-container { display: flex; flex-direction: column; gap: 10px; margin-top: 15px; } button { font-size: 16px; font-weight: bold; border-radius: 6px; cursor: pointer; width: 100%; padding: 14px 24px; transition: all 0.3s; } .btn-primary { background-color: #00d2ff; color: #121212; border: none; } .btn-primary:hover { background-color: #00a8cc; transform: translateY(-2px); } .btn-secondary { background-color: transparent; color: #00d2ff; border: 2px solid #00d2ff; } select { width: 100%; padding: 12px; border: 1px solid #333; border-radius: 6px; background-color: #2a2a2a; color: #fff; box-sizing: border-box; font-family: monospace; } select:focus { outline: none; border-color: #00d2ff; } .hint { color: #777; font-size: 12px; margin-top: 4px; line-height: 1.4; }</style></head><body><div class="container"><div>${LOGO_SVG}</div><h1>HispaSubs</h1><p>Clasificación léxica en tiempo real para Stremio.<br>Detecta automáticamente modismos en español y los divide en <strong>🇲🇽 Latino</strong>, <strong>🇪🇸 Castellano</strong> y <strong>🌎 Neutro</strong>.</p><div class="form-group"><label>SubDL API Key (Opcional - Expande catálogo)</label><input type="password" id="subdlKey" placeholder="ej: abc123def456..." value="${esc(existingConfig.subdlKey || "")}"></div><div class="form-group"><label for="langMode">Formato de idioma (compatibilidad móvil)</label><select id="langMode"><option value="label"${mode === "label" ? " selected" : ""}>Etiquetas (🇲🇽 Latino / 🇪🇸 Castellano / 🌎 Neutro)</option><option value="hybrid"${mode === "hybrid" ? " selected" : ""}>Híbrido: ISO + etiqueta (recomendado con app móvil)</option><option value="iso"${mode === "iso" ? " selected" : ""}>Solo ISO "spa" (máxima compatibilidad)</option></select><p class="hint">La app móvil de Stremio agrupa los subtítulos por código de idioma: con "Etiquetas" puede no mostrarlos en el selector del reproductor de Android/iOS.</p></div><div class="btn-container"><button class="btn-primary" onclick="installAddon()">Instalar en Stremio</button><button class="btn-secondary" id="copyBtn" onclick="copyManifest()">Copiar URL del Manifest</button></div></div>
<script>
// NOTA: se usa split/join en vez de .replace(/.../) para no depender de
// escapes anidados dentro del template literal del Worker (el bug ///g de 1.0.0).
function getManifestUrl(protocol) {
  var key = document.getElementById('subdlKey').value.trim();
  var langMode = document.getElementById('langMode').value;
  var origin = protocol + '://' + window.location.host;
  if (!key && langMode === 'label') return origin + '/manifest.json';
  var config = {};
  if (key) config.subdlKey = key;
  if (langMode !== 'label') config.langMode = langMode;
  var bytes = new TextEncoder().encode(JSON.stringify(config));
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
};

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const getManifest = (host) => ({
  id: "org.hispasubs.addon",
  version: "1.2.0",
  name: "HispaSubs",
  // Descripción ESTÁTICA: si varía con la config, la firma de abajo deja de
  // coincidir con el manifest registrado en stremio-addons.net.
  description:
    "Filtro inteligente de dialectos en español (🇲🇽 Latino / 🇪🇸 Castellano / 🌎 Neutro). OpenSubtitles V3 nativo + soporte SubDL.",
  logo: `https://${host}/logo.svg`,
  resources: ["subtitles"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: true },
  // La firma solo es válida para un manifest byte a byte idéntico al
  // registrado. Regenera este bloque con stremio-addons.net o elimínalo.
  stremioAddonsConfig: {
    issuer: "https://stremio-addons.net",
    signature:
      "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..I_TfY_MkwEz6JZ4Dz_iheA.lQvOABYkxbWdyl0gtUIAkRNqV44rLUY_kIlflyxXSxHKgii-IbQGkMmA19NxUlqLI9vJGbUq9mrKo8fYbfcJ8aRrOdIoSKqq0ACZhEh67nAXPrH_F2dAAcIXBsF-frME.sp-1lBwTFqkf4CPaQgMEbw",
  },
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
        const l = (sub.lang || "").toLowerCase();
        return l.includes("spa") || l === "es";
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
    console.error("[SubDL]", e.message);
    return [];
  }
};

// ---------------------------------------------------------------------------
// Motor de análisis léxico
// ---------------------------------------------------------------------------

const classifySubtitle = async (sub, langMode = "label") => {
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
    const esMatches = (text.match(DICT_ES) || []).length;
    const latMatches = (text.match(DICT_LAT) || []).length;
    const total = esMatches + latMatches;

    // Margen proporcional: con 3 apariciones de "coche" ya no decides un
    // subtítulo entero; hace falta cierta ventaja relativa.
    const margin = Math.max(2, Math.floor(total * 0.15));

    let flag = "🌎 Neutro";
    if (esMatches > latMatches + margin) flag = "🇪🇸 Castellano";
    else if (latMatches > esMatches + margin) flag = "🇲🇽 Latino";

    return { id: sub.id, url: finalUrl, lang: subLang(langMode, `${flag} (${sub.source})`) };
  } catch (error) {
    console.error("[classify]", sub.source, error.message);
    // 📄 = "no analizado" (nunca una variante): distinto de 🇪🇸/🇲🇽/🌎.
    return { id: sub.id, url: finalUrl, lang: subLang(langMode, `📄 Español (sin clasificar · ${sub.source})`) };
  }
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request, _env, ctx) {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);

    // Logo propio (antes apuntaba a otro workers.dev: si ese worker muere,
    // el logo se rompía; además el logo del manifest debe ser HTTPS propio).
    if (pathParts[0] === "logo.svg") {
      return new Response(LOGO_SVG, {
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=86400",
        },
      });
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

        // Deduplicación por URL (OS y SubDL devuelven los mismos títulos).
        const seenUrls = new Set();
        const deduped = [];
        for (const sub of rawSubs) {
          const key = sub.url.split("#")[0];
          if (seenUrls.has(key)) continue;
          seenUrls.add(key);
          deduped.push(sub);
        }

        // Sin resultados: se devuelve lista vacía real (adiós al "diag_1" de pastebin).
        if (deduped.length === 0) {
          console.log(`[subtitles] 0 resultados para ${type}/${fullId}`);
          return jsonResponse({ subtitles: [] });
        }

        // Análisis equilibrado: hasta 3 por fuente. En 1.0.0 las subs de
        // SubDL quedaban siempre sin analizar si OS devolvía ≥5.
        // langMode (config): formato del campo `lang` — "label" por defecto,
        // "hybrid" ("spa 🇲🇽 Latino") o "iso" ("spa") para la app móvil.
        const langMode = langModeOf(config);
        const budget = { "OS-V3": 3, "SubDL": 3 };
        const analyzed = await Promise.all(
          deduped.map((sub) => {
            if (budget[sub.source] > 0) {
              budget[sub.source] -= 1;
              return classifySubtitle(sub, langMode);
            }
            // Sin presupuesto de análisis: se enrutan igualmente (los .zip
            // vía proxy) y se etiquetan explícitamente como NO analizados.
            const finalUrl = isCompressed(sub.url)
              ? `${VERCEL_UNZIPPER}${encodeURIComponent(sub.url)}`
              : sub.url;
            return { id: sub.id, url: finalUrl, lang: subLang(langMode, `📄 Español (sin clasificar · ${sub.source})`) };
          })
        );

        const subtitles = analyzed.filter(Boolean);
        const response = jsonResponse({ subtitles });
        cachePut(ctx, request, response);
        return response;
      } catch (err) {
        // Los errores de una request no deben romper la respuesta de Stremio,
        // pero al menos ahora quedan registrados.
        console.error("[subtitles] error inesperado:", err.message);
        return jsonResponse({ subtitles: [] });
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
//     tolerante, sí los listaba). Nuevos modos configurables en /configure:
//     "hybrid" ("spa 🇲🇽 Latino", etiqueta visible + prefijo ISO) e "iso"
//     (ISO 639-2 "spa", máxima compatibilidad); isoLang:true sigue funcionando
//     como alias de "iso".
