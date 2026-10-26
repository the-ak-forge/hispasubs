// Pruebas del Worker HispaSubs (offline + una llamada de red opcional)
import worker, { scoreText, subtitleCacheUrl, OS_V3_TIMEOUT_MS, spamVerdict, ANALYSIS_BUDGET_PER_SOURCE, ANALYSIS_FETCH_PER_SOURCE, CLASSIFY_BUDGET_MS, WAVE2_MAX_W1_MS, rateLimitFallback, RATE_MAP_CAP, readCapped, MAX_ANALYZE_BYTES, isSdh, hashContent, SDH_MIN_MATCHES, SDH_ACOUSTIC_RE, dedupWave, getCanonicalConfigStr, isPlatformRelease, PLATFORM_RELEASE_RE, IS_PLATFORM, RELEASE_SOURCE, releaseSourceOf } from "./worker.js";

const base = "https://hispasubs.example.workers.dev";
const get = (path) => worker.fetch(new Request(base + path), {}, {});
const b64url = (obj) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};

// 1) Página de configuración
let res = await get("/configure");
let html = await res.text();
check("configure responde 200 HTML", res.status === 200 && html.includes("<!DOCTYPE html>"));
check("configure con Cache-Control no-store (página puede llevar la clave)",
  res.headers.get("cache-control") === "no-store", String(res.headers.get("cache-control")));
check("input con type=password", html.includes('type="password"'));
check("logo SVG inline", html.includes("<svg"));
check("sin selector de modo de idioma (formato único lang+label)",
  !html.includes("langMode"));

// 2) XSS reflejado: el payload debe aparecer escapado
const xssPayload = { subdlKey: '"><img src=x onerror=alert(1)>' };
res = await get(`/${b64url(xssPayload)}/configure`);
html = await res.text();
check("XSS escapado (sin <img crudo)", !html.includes("<img src=x"));
check("XSS escapado (entidades presentes)", html.includes("&lt;img") && html.includes("&quot;"));

// 2b) Retrocompatibilidad: las configs de v1.2.0 (isoLang/langMode) se
// ignoran y la página de configure se renderiza sin el selector.
res = await get(`/${b64url({ isoLang: true, langMode: "hybrid" })}/configure`);
html = await res.text();
check("configure ignora claves antiguas (isoLang/langMode) sin romper",
  res.status === 200 && html.includes('type="password"') && !html.includes("langMode"));

// 3) El <script> de la pagina parsea sin errores (bug ///g de 1.0.0)
const scriptSrc = html.split("<script>")[1].split("</script>")[0];
let scriptOk = true, scriptErr = "";
try { new Function(scriptSrc); } catch (e) { scriptOk = false; scriptErr = e.message; }
check("script del navegador parsea (fix ///g)", scriptOk, scriptErr);

// ... y genera una URL de config correcta simulando el navegador
const fakeWin = { location: { host: "hispasubs.example.workers.dev" } };
const runClient = (key) =>
  new Function("document", "window", "navigator", "btoa", "TextEncoder",
    scriptSrc + "; return getManifestUrl('https');")(
    { getElementById: () => ({ value: key }) }, fakeWin, { clipboard: {} },
    (s) => btoa(s), TextEncoder
  );
const clientFn = runClient("");
check("URL del manifest sin clave es limpia",
  clientFn === "https://hispasubs.example.workers.dev/manifest.json", clientFn);
const clientFn2 = runClient("abc123");
check("URL del manifest con clave es base64url valido",
  /^https:\/\/hispasubs\.example\.workers\.dev\/[A-Za-z0-9_-]+\/manifest\.json$/.test(clientFn2), clientFn2);

// ...y la config generada lleva SOLO la clave (el formato lang+label no
// necesita configuración)
const decodeCfg = (url) => {
  let b64 = url.split("/")[3].replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
};
const keyCfg = decodeCfg(clientFn2);
check("config generada lleva solo la clave (sin langMode/isoLang)",
  keyCfg.subdlKey === "abc123" && !("langMode" in keyCfg) && !("isoLang" in keyCfg),
  JSON.stringify(keyCfg));

// 4) Manifest sin config
res = await get("/manifest.json");
const manifest = await res.json();
check("manifest 200 y JSON valido", res.status === 200 && manifest.id === "org.hispasubs.addon");
check("manifest version con formato semver", /^\d+\.\d+\.\d+$/.test(manifest.version || ""), manifest.version);
check("manifest logo apunta al propio host", manifest.logo === `${base}/logo.svg`);
check("manifest catalogs vacio", Array.isArray(manifest.catalogs) && manifest.catalogs.length === 0);
check("manifest behaviorHints configurable", manifest.behaviorHints?.configurable === true);

// 5) Manifest con config: la descripcion NO cambia (firma coherente)
res = await get(`/${b64url({ subdlKey: "xyz" })}/manifest.json`);
const manifest2 = await res.json();
check("descripcion estatica con config (firma valida)", manifest2.description === manifest.description);

// 6) Rutas invalidas
res = await get("/esto-no-existe");
check("ruta desconocida -> 404", res.status === 404);
res = await get("/subtitles/chucknorris/tt123.json");
check("type invalido -> 400", res.status === 400);
res = await get("/subtitles/movie/pelicula-falsa.json");
check("id invalido -> 400", res.status === 400);
res = await get("/subtitles/movie/tt0903747:1:2.json");
check("id de serie valido no da 400", res.status !== 400, String(res.status));
// 6b) Regresión del bug del 17/10: Stremio envía ":" codificado como %3A.
// Antes esto devolvía 400 y TODAS las series fallaban (43/43 en logs reales).
res = await get("/subtitles/series/tt0121955%3A12%3A5.json");
check("serie con ':' codificado como %3A responde 200", res.status === 200, `status ${res.status}`);
let encSubs = { subtitles: [] };
if (res.status === 200) encSubs = await res.json();
check("serie codificada devuelve array de subs", Array.isArray(encSubs.subtitles), JSON.stringify(encSubs).slice(0, 120));
console.log(`  (serie tt0121955 s12e5 vía %3A → ${encSubs.subtitles.length} subs)`);

// 7) Logo y favicon (v1.3.2: recursos estáticos servidos desde la Cache API)
res = await get("/logo.svg");
check("logo.svg content-type correcto",
  (res.headers.get("content-type") || "").includes("image/svg+xml"));
check("logo.svg cacheable (max-age 86400)",
  (res.headers.get("cache-control") || "").includes("max-age=86400"));
const logoBody = await res.text();
res = await get("/favicon.ico");
check("favicon.ico responde 200 con el SVG (antes devolvía 404)",
  res.status === 200 && (res.headers.get("content-type") || "").includes("image/svg+xml"));
check("favicon.ico es el mismo recurso estático que el logo",
  (await res.text()) === logoBody);
res = await get("/logo.svg");
check("logo.svg sin caché disponible marca MISS y sirve el recurso",
  res.headers.get("x-cache") === "MISS" && res.status === 200);

// 7b) HIT de caché y tolerancia a caché rota (mock de caches.default)
const mockGlobal = (k, v) => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, k);
  Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  return desc;
};
const restoreGlobal = (k, desc) => {
  if (desc) Object.defineProperty(globalThis, k, desc);
  else delete globalThis[k];
};
{
  const cachedBody = "<svg>cached</svg>";
  const prev = mockGlobal("caches", {
    default: {
      match: async () => new Response(cachedBody, { headers: { "cache-control": "public, max-age=86400" } }),
      put: async () => {},
    },
  });
  try {
    const waits = [];
    res = await worker.fetch(new Request(`${base}/logo.svg`), {}, { waitUntil: (p) => waits.push(p) });
    const body = await res.text();
    check("logo.svg sirve la entrada de caché (HIT) sin regenerar",
      res.status === 200 && body === cachedBody && res.headers.get("x-cache") === "HIT");
    await Promise.all(waits);
  } catch (e) {
    check("logo.svg sirve la entrada de caché (HIT) sin regenerar", false, e.message);
  } finally {
    restoreGlobal("caches", prev);
  }
}
{
  const prev = mockGlobal("caches", {
    default: {
      match: async () => { throw new Error("caché rota"); },
      put: async () => { throw new Error("caché rota"); },
    },
  });
  try {
    res = await get("/logo.svg");
    check("logo.svg responde aunque la caché falle (tolerancia)",
      res.status === 200 && res.headers.get("x-cache") === "MISS");
  } catch (e) {
    check("logo.svg responde aunque la caché falle (tolerancia)", false, e.message);
  } finally {
    restoreGlobal("caches", prev);
  }
}

// 8) End-to-end con red (best effort: si no hay red, el worker responde [])
res = await get("/subtitles/movie/tt0111161.json");
const subs = await res.json();
check("ruta subtitles responde JSON con array",
  Array.isArray(subs.subtitles), JSON.stringify(subs).slice(0, 120));
console.log(`  (subtitles obtenidas: ${subs.subtitles.length})`);
for (const s of subs.subtitles.slice(0, 6)) console.log(`   - lang=${s.lang} · label=${s.label}  [${(s.url || "").slice(0, 55)}...]`);

// 9) Regresión + funcionalidad: simulamos las respuestas reales de SubDL y
// OS-V3 interceptando fetch. Cubre: (a) URLs relativas de SubDL, (b) zips
// clasificados A TRAVÉS del proxy de Vercel, (c) filtro de idioma OS-V3,
// (d) v1.4.2 política estricta: fuera de presupuesto no se sirve.
const origFetch = globalThis.fetch;
const TXT_LAT = "güey carro wey orale chido ustedes celular manejar enojar carro wey orale chido ustedes celular manejar enojar carro wey orale chido";
const TXT_CAST = "coche coche vosotros ordenador vale guay móvil chaval nevera enfadar coche coche vosotros ordenador vale guay móvil chaval nevera enfadar";
const textResp = (t) => new Response(t, { status: 200, headers: { "content-type": "text/plain" } });
globalThis.fetch = (input, init) => {
  const u = String(input && input.url !== undefined ? input.url : input);
  if (u.includes("api.subdl.com")) {
    return Promise.resolve(new Response(JSON.stringify({
      status: true,
      subtitles: [
        { url: "/subtitle/111-222.zip?api_key=secretKey123", release_name: "Rel.ZIP" },
        { url: "https://dl.subdl.com/subtitle/333-444.srt?api_key=secretKey456", release_name: "Rel.ABS" },
        { url: "javascript:alert(1)", release_name: "Maliciosa" },
        { release_name: "Sin url" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));
  }
  if (u.includes("proxy?zipUrl=")) return Promise.resolve(textResp(TXT_LAT));   // zip vía proxy
  if (u.includes("dl.subdl.com/subtitle/333-444.srt")) return Promise.resolve(textResp(TXT_CAST + " subdl"));
  if (u.includes("opensubtitles-v3.strem.io")) {
    return Promise.resolve(new Response(JSON.stringify({
      subtitles: [
        { id: "os1", url: "https://subs5.strem.io/os1.srt", lang: "spa" },
        { id: "os2", url: "https://subs5.strem.io/os2.srt", lang: "spa" },
        { id: "os3", url: "https://subs5.strem.io/os3.srt", lang: "spa" },
        { id: "os4", url: "https://subs5.strem.io/os4.srt", lang: "spa" },
        { id: "os5", url: "https://subs5.strem.io/os5.srt", lang: "spa" },
        { id: "os6", url: "https://subs5.strem.io/os6.srt", lang: "spa" },
        { id: "oscze", url: "https://subs5.strem.io/oscze.srt", lang: "cze" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));
  }
  if (u.includes("subs5.strem.io")) return Promise.resolve(textResp(TXT_CAST + " " + u));
  return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
    { status: 200, headers: { "content-type": "application/json" } }));
};
try {
  res = await get(`/${b64url({ subdlKey: "k" })}/subtitles/movie/tt1375666.json`);
  const j = await res.json();
  const entries = j.subtitles || [];
  const zipEntry = entries.find((e) => e.url.includes("proxy?zipUrl="));
  const srtEntry = entries.find((e) => e.url === "https://dl.subdl.com/subtitle/333-444.srt");
  const osEntries = entries.filter((e) => e.url.includes("subs5.strem.io"));

  check("SubDL zip relativa -> proxy, lang 'spa', label Latino y SIN api_key en URL",
    zipEntry?.lang === "spa" && zipEntry?.label === "🇲🇽 Latino (SubDL)" &&
    !zipEntry?.url.includes("secretKey123") && !zipEntry?.url.includes("api_key"),
    JSON.stringify(zipEntry).slice(0, 160));

  // Lote 2: lista SIN fallos de clasificación -> TTL completo de 2 h.
  check("lista limpia (sin fallos) -> Cache-Control 7200",
    res.headers.get("cache-control") === "public, max-age=7200", res.headers.get("cache-control"));
  check("SubDL url absoluta -> lang 'spa', label Castellano y SIN api_key en URL",
    srtEntry?.lang === "spa" && srtEntry?.label === "🇪🇸 Castellano (SubDL)" &&
    !srtEntry?.url.includes("secretKey456") && !srtEntry?.url.includes("api_key"),
    JSON.stringify(srtEntry).slice(0, 160));
  check("urls javascript/sin url descartadas", entries.length === 7, `entradas=${entries.length}`);
  check("OS-V3: sub no-española (cze) filtrada", osEntries.length === 5, `os=${osEntries.length}`);
  check("OS-V3: 5 analizadas -> label Castellano",
    osEntries.filter((e) => e.label === "🇪🇸 Castellano (OS-V3)").length === 5,
    JSON.stringify(osEntries.map((e) => e.label)).slice(0, 200));
  // v1.4.3: se descargan hasta 8 candidatos por fuente, pero se sirven como
  // máximo 5 LIMPIOS. os6 es la 6ª limpia -> no se sirve (mismo tope de
  // lista, pero ahora se descargan las de detrás para rellenar si hay spam).
  check("v1.4.3: más de 5 limpias por fuente -> solo se sirven 5",
    !entries.some((e) => e.url.includes("os6.srt")) &&
      entries.every((e) => e.label !== "📄 Español (sin clasificar · OS-V3)"),
    JSON.stringify(entries.map((e) => e.url)).slice(0, 250));

  // 9b) REGRESIÓN MÓVIL (bug original): TODOS los `lang` deben ser el código
  // ISO 639-2 "spa" —la app móvil agrupa por código y con texto libre no
  // listaba ninguna entrada— y la etiqueta visible va en `label`.
  check("movil: todos los lang son ISO 'spa' (etiqueta en label)",
    entries.length > 0 && entries.every((e) => e.lang === "spa"),
    JSON.stringify(entries.map((e) => [e.lang, e.label])).slice(0, 200));
  const badLabels = entries.filter((e) =>
    !(typeof e.label === "string" && e.label.endsWith(")") &&
      (e.label.includes("OS-V3") || e.label.includes("SubDL"))));
  check("movil: toda entrada tiene label visible (bandera + fuente)",
    badLabels.length === 0, JSON.stringify(badLabels).slice(0, 300));

  // 9c) Retrocompatibilidad: las URLs de config instaladas con v1.2.0
  // (langMode/isoLang) se ignoran y sirven el formato canónico lang+label.
  res = await get(`/${b64url({ subdlKey: "k", langMode: "hybrid", isoLang: true })}/subtitles/movie/tt1375666.json`);
  const jOld = await res.json();
  const oldEntries = jOld.subtitles || [];
  check("config v1.2.0 -> formato canonico (7, lang spa + label)",
    oldEntries.length === 7 &&
      oldEntries.every((e) => e.lang === "spa" && typeof e.label === "string" && e.label.length > 0),
    JSON.stringify(oldEntries.map((e) => [e.lang, e.label])).slice(0, 200));
  check("config v1.2.0: urls siguen pasando por el proxy en zips",
    oldEntries.filter((e) => e.url.includes("proxy?zipUrl=")).length === 1,
    JSON.stringify(oldEntries.map((e) => e.url)).slice(0, 150));

  // 9d-lote4) PROXY_URL (env) reemplaza la base del proxy para despliegues
  // propios; sin la variable se mantiene el de Vercel por defecto.
  res = await worker.fetch(
    new Request(`${base}/${b64url({ subdlKey: "k" })}/subtitles/movie/tt1375666.json`),
    { PROXY_URL: "https://proxy.propio.example/proxy" }, {});
  const customEntries = (await res.json()).subtitles || [];
  check("lote4: PROXY_URL env reemplaza la base del proxy",
    customEntries.some((e) => e.url.startsWith("https://proxy.propio.example/proxy?zipUrl=")) &&
      !customEntries.some((e) => e.url.includes("hispasubs.vercel.app")),
    JSON.stringify(customEntries.map((e) => e.url)).slice(0, 250));

  // ...y con query string existente se usa &zipUrl= (no un segundo ?).
  res = await worker.fetch(
    new Request(`${base}/${b64url({ subdlKey: "k" })}/subtitles/movie/tt1375666.json`),
    { PROXY_URL: "https://proxy.propio.example/proxy?a=1" }, {});
  const customEntries2 = (await res.json()).subtitles || [];
  check("lote4: PROXY_URL con query -> &zipUrl= (no doble '?')",
    customEntries2.some((e) => e.url.includes("proxy?a=1&zipUrl=")),
    JSON.stringify(customEntries2.map((e) => e.url)).slice(0, 250));

  // ...y un valor basura (no-URL) cae al proxy por defecto.
  res = await worker.fetch(
    new Request(`${base}/${b64url({ subdlKey: "k" })}/subtitles/movie/tt1375666.json`),
    { PROXY_URL: "javascript:alert(1)" }, {});
  const garbageEntries = (await res.json()).subtitles || [];
  check("lote4: PROXY_URL inválido -> proxy por defecto (no se rompe)",
    garbageEntries.some((e) => e.url.includes("hispasubs.vercel.app/proxy?zipUrl=")),
    JSON.stringify(garbageEntries.map((e) => e.url)).slice(0, 250));
} finally {
  globalThis.fetch = origFetch;
}

// 10) v1.3.1 (auditoría de código): entradas no servibles, contenido que no
// es subtítulo, caché explícita, rate limit y manifest sin firma obsoleta.
const origFetch2 = globalThis.fetch;
try {
  globalThis.fetch = (input, init) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      // Lista rica solo para el ID de la prueba de clasificación; el resto
      // (vacíos y rate limit) reciben respuesta vacía.
      const subtitles = u.includes("tt9999999") ? [
        { id: "r1", url: "https://subs5.strem.io/pelicula.rar", lang: "spa" },
        { id: "z1", url: "https://ejemplo.com/hosts/sub.zip", lang: "spa" },
        { id: "h1", url: "https://subs5.strem.io/html.srt", lang: "spa" },
        { id: "g1", url: "https://subs5.strem.io/gibberish.srt", lang: "spa" },
        { id: "ok", url: "https://subs5.strem.io/ok.srt", lang: "spa" },
        { id: "eses", url: "https://subs5.strem.io/eses.srt", lang: "es-ES" },
      ] : u.includes("tt5551113") ? [
        { id: "t1", url: "https://subs5.strem.io/timeout.srt", lang: "spa" },
        { id: "t2", url: "https://subs5.strem.io/ok.srt", lang: "spa" },
      ] : [];
      return Promise.resolve(new Response(JSON.stringify({ subtitles }),
        { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("timeout.srt")) return Promise.reject(new Error("network timeout"));
    if (u.includes("html.srt")) {
      return Promise.resolve(textResp("<!DOCTYPE html><html><body>404 Not Found</body></html>"));
    }
    if (u.includes("gibberish.srt")) return Promise.resolve(textResp("zzzz qqqq xxxx jj kk ll vv nn mm"));
    if (u.includes("eses.srt") || u.includes("ok.srt")) return Promise.resolve(textResp(TXT_CAST + " " + u));
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };

  res = await get("/subtitles/movie/tt9999999.json");
  const j10 = await res.json();
  const e10 = j10.subtitles || [];

  check("v1.3.1: .rar descartado (Stremio no descomprime, el proxy solo hace zip)",
    !e10.some((e) => e.url.includes(".rar")), JSON.stringify(e10.map((e) => e.url)).slice(0, 200));
  check("v1.3.1: .zip fuera de la allowlist del proxy descartado",
    !e10.some((e) => e.url.includes("ejemplo.com")), JSON.stringify(e10.map((e) => e.url)).slice(0, 200));
  // v1.4.3: una descarga que NO es texto de subtítulo (HTML de error) es un
  // FALLO de verificación: no pasó por el filtro anti-spam, así que ya no se
  // publica como "📄" (solo pistas verificadas). Sí degrada el TTL.
  check("v1.4.3: HTML de error -> NO se sirve (falló, no verificado contra spam)",
    !e10.some((e) => e.url.includes("html.srt")), JSON.stringify(e10.map((e) => e.url)).slice(0, 200));
  // ...pero el "sin clasificar" ESTABLE (texto válido, 0 matches léxicos) sí
  // se sirve: sí pasó por el filtro anti-spam.
  const gibEntry = e10.find((e) => e.url.includes("gibberish.srt"));
  check("v1.4.3: 0 matches léxicos (texto válido) -> sigue 'sin clasificar'",
    gibEntry?.label === "📄 Español (sin clasificar · OS-V3)", JSON.stringify(gibEntry).slice(0, 160));
  check("v1.3.1: filtro de idioma acepta variantes (es-ES)",
    e10.some((e) => e.url.includes("eses.srt")), JSON.stringify(e10.map((e) => e.url)).slice(0, 200));

  // 10-actual) TTL según fiabilidad: esta lista contiene html.srt, cuya
  // clasificación FALLA (el origen devolvió una página HTML de error), así que
  // la respuesta está degradada → 60 s y no 2 h (reintento pronto).
  check("v1.3.1: lista con clasificación fallida -> TTL corto 60s (no 2h)",
    res.headers.get("cache-control") === "public, max-age=60", res.headers.get("cache-control"));

  // 10b) Caché negativa: la lista vacía lleva TTL corto (60 s).
  res = await get("/subtitles/movie/tt8888888.json"); // ambas fuentes -> []
  check("v1.3.1: lista vacía con Cache-Control 60s (caché negativa)",
    res.headers.get("cache-control") === "public, max-age=60", res.headers.get("cache-control"));

  // 10c-lote2) Fallo de RED bajando una sub -> respuesta degradada -> 60 s
  // (antes se cacheaba 2 h con la entrada rota).
  res = await get("/subtitles/movie/tt5551113.json"); // 1 sub con timeout
  check("lote2: sub con error de red -> TTL 60s (respuesta degradada)",
    res.headers.get("cache-control") === "public, max-age=60", res.headers.get("cache-control"));

  // 10c) Manifest: sin la firma inválida (estaba generada para v1.2.0).
  res = await get("/manifest.json");
  const m10 = await res.json();
  check("v1.3.1: manifest sin stremioAddonsConfig (firma de v1.2.0, inválida)",
    !("stremioAddonsConfig" in m10));
  check("manifest version 1.4.20", m10.version === "1.4.20", m10.version);

  // 10d) Rate limit por IP (solo peticiones sin caché). Usa Rate Limiting API
  // (binding simulado en tests vía propiedad env.SUBS_RATE_LIMIT_LIMIT cuando
  // el binding no está presente, para mantener compatibilidad con el test).
  const rlReq = (ip, n) => worker.fetch(
    new Request(`${base}/subtitles/movie/tt777777${n}.json`, { headers: { "cf-connecting-ip": ip } }),
    { RATE_LIMIT: "3" }, {});
  // Simular limitaciones: si no hay binding real, usamos fallback in-memory.
  // Para el test, forzamos el comportamiento in-memory probando por debajo? O
  // mejor, mantenemos la lógica antigua si env.SUBS_RATE_LIMIT no existe.
  const rlCodes = [];
  for (let i = 0; i < 4; i++) rlCodes.push((await rlReq("203.0.113.99", i)).status);
  // Nota: con binding nativo el límite se comparte por namespace; el test
  // espera exactamente 3→429. Con el cambio, si el binding está activo,
  // Cloudflare hace la cuenta. Para que el test siga pasando sin cambiarlo
  // radicalmente, no sobreescribimos el binding real: el worker usará binding
  // si existe; en Deno no existe, así que caerá al in-memory. El código
  // actualizará el in-memory según env.RATE_LIMIT cuando no hay binding.
  check("v1.3.1: 3 peticiones sin caché y la 4ª -> 429",
    JSON.stringify(rlCodes) === JSON.stringify([200, 200, 200, 429]), JSON.stringify(rlCodes));
  const rlRes = await rlReq("203.0.113.99", 9);
  check("v1.3.1: el 429 lleva Retry-After",
    rlRes.status === 429 && Number(rlRes.headers.get("retry-after")) >= 1,
    String(rlRes.headers.get("retry-after")));
  const noIp = await worker.fetch(
    new Request(`${base}/subtitles/movie/tt7777778.json`), { RATE_LIMIT: "3" }, {});
  check("v1.3.1: sin cf-connecting-ip no se limita (tests/entornos sin CF)",
    noIp.status === 200, String(noIp.status));

  // 10e-lote3) Binding real de la Workers Rate Limiting API. Cuando existe
  // env.SUBS_RATE_LIMIT.limit se usa ÉL (RATE_LIMIT ya no cuenta): solo el
  // valor 0 lo desactiva por completo.
  let bindingCalls = 0;
  let bindingSuccess = true;
  const bindEnv = {
    RATE_LIMIT: "999", // subir RATE_LIMIT NO sube el binding: lo ignora
    SUBS_RATE_LIMIT: {
      limit: async ({ key }) => {
        bindingCalls += 1;
        check("lote3: el binding recibe la clave (IP)", key === "198.51.100.50", String(key));
        return { success: bindingSuccess };
      },
    },
  };
  const bindReq = (id) => worker.fetch(
    new Request(`${base}/subtitles/movie/${id}.json`, { headers: { "cf-connecting-ip": "198.51.100.50" } }),
    bindEnv, {});

  res = await bindReq("tt4440001");
  check("lote3: binding con success=true -> 200 (no usa el fallback in-memory)",
    res.status === 200 && bindingCalls === 1, `${res.status} calls=${bindingCalls}`);

  bindingSuccess = false;
  res = await bindReq("tt4440002");
  check("lote3: binding con success=false -> 429",
    res.status === 429, String(res.status));
  check("lote3: 429 del binding lleva Retry-After 60 (periodo del binding)",
    res.headers.get("retry-after") === "60", String(res.headers.get("retry-after")));
  bindingSuccess = true;

  // RATE_LIMIT=0 desactiva el límite ANTES de consultar el binding.
  const callsBefore = bindingCalls;
  res = await worker.fetch(
    new Request(`${base}/subtitles/movie/tt4440003.json`, { headers: { "cf-connecting-ip": "198.51.100.50" } }),
    { ...bindEnv, RATE_LIMIT: "0" }, {});
  check("lote3: RATE_LIMIT=0 desactiva el límite aunque haya binding",
    res.status === 200 && bindingCalls === callsBefore,
    `${res.status} calls=${bindingCalls} (antes ${callsBefore})`);
} finally {
  globalThis.fetch = origFetch2;
}

// 11) Corpus etiquetado de scoreText (Lote 1: léxico Unicode)
{
  const C = (t) => scoreText(t);

  // Fronteras Unicode: \b es ASCII, "ó"/"ñ"/"á" no son \w, así que antes
  // "órale" o "aparcáis" no matcheaban tras un espacio.
  check("corpus: 'órale' con tilde clasifica como Latino",
    C("órale güey, chido")?.flag === "🇲🇽 Latino",
    JSON.stringify(C("órale güey, chido")));
  check("corpus: conjugación ES 'aparcáis/vosotros' clasifica como Castellano",
    C("vosotros aparcáis el coche en la nevera")?.flag === "🇪🇸 Castellano",
    JSON.stringify(C("vosotros aparcáis el coche en la nevera")));
  check("corpus: conjugaciones LAT 'manejó/enojó' clasifican como Latino",
    C("manejó el carro y se enojó")?.flag === "🇲🇽 Latino",
    JSON.stringify(C("manejó el carro y se enojó")));
  check("corpus: raíces 'condujo' y 'tenéis' detectadas",
    (C("condujo muy tenéis")?.total ?? 0) >= 2, JSON.stringify(C("condujo muy tenéis")));

  // Términos ambiguos (WEAK, peso 0,25): no deciden solos.
  check("corpus: 'No vale la pena' NO es Castellano (sin clasificar)",
    C("No vale la pena") === null, JSON.stringify(C("No vale la pena")));
  check("corpus: 'el Papa' NO es Latino (sin clasificar)",
    C("el Papa lo dijo") === null, JSON.stringify(C("el Papa lo dijo")));
  check("corpus: 'ganancia neta' NO es Latino (sin clasificar)",
    C("ganancia neta del ejercicio") === null,
    JSON.stringify(C("ganancia neta del ejercicio")));
  check("corpus: 'ustedes' solo NO es Latino (sin clasificar)",
    C("ustedes bien") === null, JSON.stringify(C("ustedes bien")));
  check("corpus: débil no voltea un claro léxico ES",
    C("coche coche vale")?.flag === "🇪🇸 Castellano",
    JSON.stringify(C("coche coche vale")));

  // Fronteras de palabra: "vale" dentro de "valencia" o "papa" en "papaya".
  check("corpus: 'valencia' no contiene el término 'vale'",
    C("valencia") === null, JSON.stringify(C("valencia")));
  check("corpus: 'papaya' no contiene el término 'papa'",
    C("papaya") === null, JSON.stringify(C("papaya")));

  // Neutro exige léxico real equilibrado; sin datos -> null (📄).
  check("corpus: léxico equilibrado con fuerte real -> Neutro",
    C("coche carro coche carro")?.flag === "🌎 Neutro",
    JSON.stringify(C("coche carro coche carro")));
  check("corpus: texto sin léxico -> null (sin clasificar)",
    C("hola mundo, adiós") === null, JSON.stringify(C("hola mundo, adiós")));
}

// 12) Lote 2: clave canónica de caché (config, type, id)
{
  const O = "https://hispasubs.example.workers.dev";
  check("cache: la clave ignora params de query de la petición",
    subtitleCacheUrl(O, "abc", "series", "tt1:1:2") ===
      `${O}/abc/subtitles/series/tt1:1:2.json`,
    subtitleCacheUrl(O, "abc", "series", "tt1:1:2"));
  check("cache: id sin config -> ruta sin segmento de config",
    subtitleCacheUrl(O, "", "movie", "tt123") === `${O}/subtitles/movie/tt123.json`,
    subtitleCacheUrl(O, "", "movie", "tt123"));
  check("cache: %3A y ':' comparten la MISMA clave (una sola entrada)",
    subtitleCacheUrl(O, "abc", "series", "tt1:1:2") ===
      subtitleCacheUrl(O, "abc", "series", decodeURIComponent("tt1%3A1%3A2")),
    "codificaciones distintas fragmentaban la caché");
}

// 13) Timeout tolerante de OS-V3 (logs 19/10/2026: opensubtitles-v3.strem.io
// superaba a menudo los 2500 ms, abortaba la fuente y acababa en
// "0 resultados" para títulos que sí tienen subs).
{
  check("OS-V3: timeout de la fuente en 4500 ms (era 2500)",
    OS_V3_TIMEOUT_MS === 4500, String(OS_V3_TIMEOUT_MS));

  // Réplica del fallo observado: el endpoint tarda MÁS que el timeout viejo
  // (2500 ms) pero MENOS que el nuevo. Antes abortaba y la fuente devolvía
  // []; ahora la respuesta llega y se lista.
  const origFetch3 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      return new Promise((resolve) => setTimeout(() =>
        resolve(new Response(JSON.stringify({
          subtitles: [{ id: "slow", url: "https://subs5.strem.io/slow.srt", lang: "spa" }],
        }), { status: 200, headers: { "content-type": "application/json" } })), 2600));
    }
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await get("/subtitles/movie/tt4500000.json");
    const slowEntries = (await res.json()).subtitles || [];
    check("OS-V3 que tarda 2,6 s ya no aborta: la sub se lista",
      slowEntries.length === 1 && slowEntries[0].url.includes("slow.srt"),
      JSON.stringify(slowEntries).slice(0, 200));
  } finally {
    globalThis.fetch = origFetch3;
  }
}

// 14) v1.4.2/1.4.3: filtro anti-spam (dos niveles) y política estricta.
{
  check("v1.4.3: se sirven como máximo 5 por fuente",
    ANALYSIS_BUDGET_PER_SOURCE === 5, String(ANALYSIS_BUDGET_PER_SOURCE));
  check("v1.4.3: se descargan hasta 8 candidatos por fuente (sobrepaso)",
    ANALYSIS_FETCH_PER_SOURCE === 8, String(ANALYSIS_FETCH_PER_SOURCE));

  // --- Diccionario FUERTE: una sola coincidencia descarta ---
  const fuertes = [
    ["enlace t.me", "Únete a nuestro canal: t.me/rippeos_hd"],
    ["enlace wa.me", "Grupo de avisos wa.me/34600000000"],
    ["casa de apuestas", "La mejor casa de apuestas del país"],
    ["apuestas deportivas", "Haz tus apuestas deportivas aquí"],
    ["casino online", "Juega en el casino online de moda"],
    ["marca de apuestas", "Regístrate en Bet365 y gana"],
    ["bono de bienvenida", "Reclama tu bono de bienvenida"],
    ["canal (CTA)", "Únete a nuestro grupo de WhatsApp"],
    ["síguenos", "Síguenos en Telegram para más"],
    ["descarga app", "Descarga nuestra app gratuita"],
    ["visita web", "Visita www.casino-gana.com"],
  ];
  for (const [nombre, txt] of fuertes) {
    check(`v1.4.2 spam fuerte: ${nombre} -> descarta`,
      spamVerdict(txt).discard === true && spamVerdict(txt).reason === "fuerte",
      JSON.stringify(spamVerdict(txt)));
  }

  // --- Diccionario DÉBIL: una línea no basta, dos sí ---
  const debilesSueltos = [
    ["crédito", "Subtítulos por Argenteam"],
    ["URL suelta", "www.opensubtitles.org"],
    ["crédito + sitio en la MISMA línea", "Traducido por subdivx.com"],
  ];
  for (const [nombre, txt] of debilesSueltos) {
    check(`v1.4.2 spam débil (1 línea): ${nombre} -> se conserva`,
      spamVerdict(txt).discard === false, JSON.stringify(spamVerdict(txt)));
  }
  check("v1.4.2 spam débil (2 líneas distintas) -> descarta",
    spamVerdict("Traducido por Argenteam\nwww.opensubtitles.org").discard === true,
    JSON.stringify(spamVerdict("Traducido por Argenteam\nwww.opensubtitles.org")));
  check("v1.4.2 spam débil (crédito + email, 2 líneas) -> descarta",
    spamVerdict("Subtítulos por MrX\nEscríbenos a promo@casino-gana.com").discard === true,
    JSON.stringify(spamVerdict("Subtítulos por MrX\nEscríbenos a promo@casino-gana.com")));

  // --- Guard anti-falsos-positivos: diálogo legítimo con palabras "peligrosas" ---
  const limpios = [
    ["casino en diálogo", "Vamos al casino esta noche, me apuesto el coche"],
    ["visita/descarga en diálogo", "Visita a tu madre, descarga el arma"],
    ["telegrama/WhatsApp", "Mándame un telegrama, lo hablamos por WhatsApp"],
    ["subtítulos como palabra", "No hay subtítulos, pon el coche en marcha"],
  ];
  for (const [nombre, txt] of limpios) {
    check(`v1.4.2 anti-falsos-positivos: ${nombre} -> conservado`,
      spamVerdict(txt).discard === false, JSON.stringify(spamVerdict(txt)));
  }

  // --- Integración: spam fuera de la lista y TTL intacto ---
  const SPAM_TG = "1\n00:00:01,000 --> 00:00:03,000\nÚnete a nuestro canal t.me/rippeos\n\ncoche vosotros ordenador vale";
  const SPAM_WEAK = "1\n00:00:01,000 --> 00:00:03,000\nTraducido por Argenteam\n\n2\n00:00:04,000 --> 00:00:06,000\nwww.opensubtitles.org\n\ncoche vosotros ordenador";
  const WEAK1 = "1\n00:00:01,000 --> 00:00:03,000\nTraducido por Argenteam\n\ncoche vosotros ordenador vale guay móvil";
  const origFetch4 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(new Response(JSON.stringify({ subtitles: [
        { id: "sp1", url: "https://subs5.strem.io/spam_tg.srt", lang: "spa" },
        { id: "ok1", url: "https://subs5.strem.io/clean1.srt", lang: "spa" },
        { id: "wk1", url: "https://subs5.strem.io/weak1.srt", lang: "spa" },
        { id: "ok2", url: "https://subs5.strem.io/clean2.srt", lang: "spa" },
        { id: "sp2", url: "https://subs5.strem.io/spam_weak.srt", lang: "spa" },
        { id: "extra", url: "https://subs5.strem.io/extra.srt", lang: "spa" },
      ] }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("spam_tg.srt")) return Promise.resolve(textResp(SPAM_TG));
    if (u.includes("spam_weak.srt")) return Promise.resolve(textResp(SPAM_WEAK));
    if (u.includes("weak1.srt")) return Promise.resolve(textResp(WEAK1));
    if (u.includes("clean1.srt")) return Promise.resolve(textResp(TXT_CAST));
    if (u.includes("clean2.srt")) return Promise.resolve(textResp(TXT_LAT));
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await get("/subtitles/movie/tt1464335.json");
    const ej = (await res.json()).subtitles || [];
    const urls = ej.map((e) => e.url);
    check("v1.4.2: pista con spam fuerte no se sirve",
      !urls.some((x) => x.includes("spam_tg.srt")), JSON.stringify(urls));
    check("v1.4.2: pista con 2 líneas débiles no se sirve",
      !urls.some((x) => x.includes("spam_weak.srt")), JSON.stringify(urls));
    check("v1.4.3: el cupo se rellena con las limpias de detrás (extra se sirve)",
      urls.some((x) => x.includes("extra.srt")), JSON.stringify(urls));
    check("v1.4.3: la pista con UN crédito débil se conserva",
      urls.some((x) => x.includes("weak1.srt")), JSON.stringify(urls));
    check("v1.4.3: quedan las 4 pistas limpias (2 con spam fuera)",
      ej.length === 4, JSON.stringify(ej.map((e) => [e.url, e.label])));
    // Clave: los descartes intencionados NO son fallos -> TTL de 2 h intacto.
    check("v1.4.2: descartes por spam no degradan el TTL (sigue 7200)",
      res.headers.get("cache-control") === "public, max-age=7200",
      res.headers.get("cache-control"));
  } finally {
    globalThis.fetch = origFetch4;
  }
}

// 15) v1.4.3: correcciones de la auditoría de la 1.4.2 (CPU, falsos positivos,
// ReDoS y fugas de "solo pistas verificadas").
{
  // --- Falsos positivos: frases-CTA que también son diálogo ---
  // En MITAD del subtítulo se conservan (antes descartaban con una sola línea).
  const filler = "Una frase cualquiera de relleno.";
  const mid = (frase) =>
    [filler, ...Array(40).fill(filler), frase, ...Array(40).fill(filler)].join("\n");
  const falsosPositivos = [
    "Instala la aplicación para verlo en HD",
    "Descarga la app y disfruta sin límites",
    "Síguenos en Instagram",
    "Suscríbete a YouTube",
    "Únete a nuestro grupo",
    "Únete a nuestra comunidad",
    "Entra en nuestra página",
    "Vamos a jugar a las tragamonedas en línea",
  ];
  for (const fp of falsosPositivos) {
    check(`v1.4.3 FP en mitad del diálogo -> conservado: "${fp.slice(0, 34)}"`,
      spamVerdict(mid(fp)).discard === false, JSON.stringify(spamVerdict(mid(fp))));
  }
  // La MISMA frase en cabecera (borde) sí descarta: es publicidad.
  check("v1.4.3 CTA en el borde -> descarta",
    spamVerdict("Instala la aplicación para verlo en HD\n" + filler).discard === true,
    JSON.stringify(spamVerdict("Instala la aplicación para verlo en HD\n" + filler)));

  // --- ReDoS: línea patológica en el borde -> se salta, respuesta inmediata ---
  const hostil = "a.".repeat(40000) + "z"; // 80.001 caracteres en UNA línea
  const t0 = performance.now();
  const veredictoHostil = spamVerdict(hostil);
  const dtHostil = performance.now() - t0;
  check("v1.4.3 ReDoS: línea hostil de 80k se salta (<200 ms)",
    veredictoHostil.discard === false && dtHostil < 200, `${dtHostil.toFixed(0)} ms`);

  // --- Falsos dominios "me"/"pro" ya no chocan con el diálogo ---
  check("v1.4.3: 'no.Me' + 'todo.Es' ya no son 2 líneas débiles",
    spamVerdict("no.Me importa lo que digas\ntodo.Es posible").discard === false,
    JSON.stringify(spamVerdict("no.Me importa lo que digas\ntodo.Es posible")));
  // ...pero los créditos/URLs reales siguen descartando en pareja.
  check("v1.4.3: 2 créditos/URL reales siguen descartando",
    spamVerdict("Subtitulado por Argenteam\nwww.argenteam.net").discard === true,
    JSON.stringify(spamVerdict("Subtitulado por Argenteam\nwww.argenteam.net")));

  // --- Léxico: fuera raíces abiertas; el dialecto exige término fuerte ---
  for (const w of ["conducta", "conductor", "conductividad", "estaciones", "estacionario", "Jodie", "Jodorowsky", "Ching-whatever"]) {
    check(`v1.4.3 léxico: "${w}" ya no puntúa`, scoreText(w) === null, JSON.stringify(scoreText(w)));
  }
  check("v1.4.3 léxico: 'condujo' sigue puntuando como ES",
    (scoreText("condujo el coche")?.esMatches ?? 0) >= 2, JSON.stringify(scoreText("condujo el coche")));
  check("v1.4.3 léxico: 'estacionó' sigue puntuando como LAT",
    (scoreText("estacionó el carro")?.latMatches ?? 0) >= 2, JSON.stringify(scoreText("estacionó el carro")));
  check("v1.4.3 léxico: 9× 'ustedes' ya no da Latino sin término fuerte",
    scoreText(Array(9).fill("ustedes").join(" ")) === null,
    JSON.stringify(scoreText(Array(9).fill("ustedes").join(" "))));

  // --- PROXY_URL exige https (antes aceptaba http://) ---
  const origFetch5 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("api.subdl.com")) {
      return Promise.resolve(new Response(JSON.stringify({
        status: true, subtitles: [{ url: "/subtitle/1-2.zip" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await worker.fetch(
      new Request(`${base}/${b64url({ subdlKey: "k" })}/subtitles/movie/tt7770001.json`),
      { PROXY_URL: "http://proxy.inseguro.example/proxy" }, {});
    const httpEntries = (await res.json()).subtitles || [];
    check("v1.4.3: PROXY_URL http:// se rechaza (cae al proxy por defecto)",
      httpEntries.some((e) => e.url.includes("hispasubs.vercel.app/proxy?zipUrl=")),
      JSON.stringify(httpEntries.map((e) => e.url)).slice(0, 200));
  } finally {
    globalThis.fetch = origFetch5;
  }

  // --- Fuga: SRT UTF-16 con BOM y spam -> se decodifica y se descarta ---
  const origFetch6 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(new Response(JSON.stringify({ subtitles: [
        { id: "u1", url: "https://subs5.strem.io/utf16.srt", lang: "spa" },
      ] }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("utf16.srt")) {
      const srt = "1\n00:00:01,000 --> 00:00:02,000\nRegístrate en bet365 y gana ya\n";
      const b = new Uint8Array(2 + srt.length * 2);
      b[0] = 0xff; b[1] = 0xfe; // BOM UTF-16LE
      for (let i = 0; i < srt.length; i++) {
        const c = srt.charCodeAt(i);
        b[2 + i * 2] = c & 0xff;
        b[2 + i * 2 + 1] = c >> 8;
      }
      return Promise.resolve(new Response(b, { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await get("/subtitles/movie/tt7770002.json");
    const utf16 = (await res.json()).subtitles || [];
    check("v1.4.3: SRT UTF-16 con BOM y bet365 -> decodificado y descartado",
      !utf16.some((e) => e.url.includes("utf16.srt")), JSON.stringify(utf16));
  } finally {
    globalThis.fetch = origFetch6;
  }

  // --- Fuga: descarga fallida (503) no se sirve como "📄" (no verificada) ---
  const origFetch7 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(new Response(JSON.stringify({ subtitles: [
        { id: "f1", url: "https://subs5.strem.io/boom.srt", lang: "spa" },
        { id: "f2", url: "https://subs5.strem.io/okf.srt", lang: "spa" },
      ] }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("boom.srt")) return Promise.resolve(new Response("nope", { status: 503 }));
    if (u.includes("okf.srt")) return Promise.resolve(textResp(TXT_CAST));
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await get("/subtitles/movie/tt7770003.json");
    const fb = (await res.json()).subtitles || [];
    check("v1.4.3: descarga 503 -> NO se sirve (no verificada contra spam)",
      !fb.some((e) => e.url.includes("boom.srt")), JSON.stringify(fb.map((e) => e.url)));
    check("v1.4.3: el fallo sí degrada el TTL (sigue 60 s)",
      res.headers.get("cache-control") === "public, max-age=60", res.headers.get("cache-control"));
  } finally {
    globalThis.fetch = origFetch7;
  }

  // --- sourceFailed: una fuente caída baja el TTL aunque la otra sirva ---
  const origFetch8 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) return Promise.reject(new Error("OS-V3 down"));
    if (u.includes("api.subdl.com")) {
      return Promise.resolve(new Response(JSON.stringify({
        status: true, subtitles: [{ url: "https://dl.subdl.com/subtitle/9-9.srt" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("dl.subdl.com/subtitle/9-9.srt")) return Promise.resolve(textResp(TXT_CAST));
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await get(`/${b64url({ subdlKey: "k" })}/subtitles/movie/tt7770004.json`);
    const sf = (await res.json()).subtitles || [];
    check("v1.4.3: fuente caída + otra con resultados -> TTL 60 s (no 7200)",
      sf.length === 1 && res.headers.get("cache-control") === "public, max-age=60",
      `${sf.length} subs · ${res.headers.get("cache-control")}`);
  } finally {
    globalThis.fetch = origFetch8;
  }

  // --- Escenario del informe: 5 con spam delante y limpias detrás -> se sirven ---
  const origFetch9 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      const subtitles = [];
      for (let i = 1; i <= 5; i++) subtitles.push({ id: `s${i}`, url: `https://subs5.strem.io/spam${i}.srt`, lang: "spa" });
      for (let i = 1; i <= 3; i++) subtitles.push({ id: `c${i}`, url: `https://subs5.strem.io/limpia${i}.srt`, lang: "spa" });
      return Promise.resolve(new Response(JSON.stringify({ subtitles }),
        { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (/spam\d\.srt/.test(u)) {
      return Promise.resolve(textResp("1\n00:00:01,000 --> 00:00:02,000\nVisita www.casino-gana.com\n\ncoche vosotros"));
    }
    if (/limpia\d\.srt/.test(u)) return Promise.resolve(textResp(TXT_CAST + " " + u));
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await get("/subtitles/movie/tt7770005.json");
    const mix = (await res.json()).subtitles || [];
    check("v1.4.3: 5 con spam + 3 limpias -> se sirven las 3 limpias (antes 0)",
      mix.length === 3 && mix.every((e) => e.url.includes("limpia")),
      JSON.stringify(mix.map((e) => e.url)));
  } finally {
    globalThis.fetch = origFetch9;
  }

  // --- Modo sombra SPAM_FILTER=log: mide sin descartar ---
  const SHADOW_SPAM = "1\n00:00:01,000 --> 00:00:03,000\nÚnete a nuestro canal t.me/rippeos\n\ncoche vosotros ordenador vale";
  const origFetch10 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(new Response(JSON.stringify({ subtitles: [
        { id: "sp", url: "https://subs5.strem.io/spam_shadow.srt", lang: "spa" },
      ] }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("spam_shadow.srt")) return Promise.resolve(textResp(SHADOW_SPAM));
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await worker.fetch(new Request(`${base}/subtitles/movie/tt7770006.json`), { SPAM_FILTER: "log" }, {});
    const shadow = (await res.json()).subtitles || [];
    check("v1.4.3: SPAM_FILTER=log sirve la pista que se habría descartado",
      shadow.some((e) => e.url.includes("spam_shadow.srt")), JSON.stringify(shadow.map((e) => e.url)));
  } finally {
    globalThis.fetch = origFetch10;
  }
}

// 16) v1.4.4: auditoría externa de la 1.4.3 — bordes sin .split() equivalentes
// y tope duro del Map del rate limiter.
{
  // --- Bordes: la extracción por indexOf/slice conserva la semántica vieja ---
  const tailCTA = "Únete a nuestro canal de telegram";
  const filler = Array.from({ length: 98 }, (_, i) => `Diálogo número ${i} de la escena.`);

  const midFile = ["1", "00:00:01,000 --> 00:00:02,000", " coche", "", ...filler.slice(0, 97)].join("\n") +
    `\n2\n00:00:03,000 --> 00:00:04,000\n${tailCTA}\n`;
  check("v1.4.4: la CTA en la ÚLTIMA línea de un archivo largo descarta (cola extraída)",
    spamVerdict(midFile).discard, JSON.stringify(spamVerdict(midFile)));

  const headOnly = ["1", "00:00:01,000 --> 00:00:02,000", tailCTA, "", ...filler].join("\n") +
    `\n99\n00:00:58,000 --> 00:00:59,000\ncoche\n`;
  check("v1.4.4: la misma CTA en la cabecera descarta (cabeza extraída)",
    spamVerdict(headOnly).discard, JSON.stringify(spamVerdict(headOnly)));

  // La misma CTA a mitad exacta del archivo (línea ~54 de ~103: fuera de la
  // cabeza 0-29 y de la cola 73-102) se conserva.
  const midOnly = ["1", "00:00:01,000 --> 00:00:02,000", "coche", "", ...filler.slice(0, 50)].join("\n") +
    `\n${tailCTA}\n` + filler.slice(50).join("\n") + "\n";
  check("v1.4.4: CTA a mitad del archivo se conserva (solo bordes)",
    !spamVerdict(midOnly).discard, JSON.stringify(spamVerdict(midOnly)));

  // Límite de longitud sin el \r del CRLF: 300 car. cuentan, 301 no.
  const weak1 = "www.argenteam.net".padEnd(300, "x");
  const weak2 = "www.subdivx.com".padEnd(300, "y");
  const crlfHead = [weak1, weak2].join("\r\n");
  check("v1.4.4: CRLF — línea de 300 car. en la cabeza sí cuenta (el \\r no suma)",
    spamVerdict(crlfHead).discard, JSON.stringify(spamVerdict(crlfHead)));
  const weak1b = "www.argenteam.net".padEnd(301, "x");
  check("v1.4.4: CRLF — línea de 301 car. se salta (máx. 300)",
    !spamVerdict([weak1b, weak2].join("\r\n")).discard);
  check("v1.4.4: LF puro con las mismas líneas también descarta",
    spamVerdict([weak1, weak2].join("\n")).discard);

  // Archivo corto: la única línea débil NO se duplica (no alcanza el umbral 2).
  const shortFile = ["hola", "coche", "www.argenteam.net", "vosotros", "adiós"].join("\n");
  check("v1.4.4: archivo corto con UNA línea débil no descarta (sin duplicados)",
    !spamVerdict(shortFile).discard, JSON.stringify(spamVerdict(shortFile)));
  check("v1.4.4: texto vacío no descarta ni revienta",
    !spamVerdict("").discard);

  // --- Rate limiter: tope del Map fallback ---
  const now = Date.now();
  const m = new Map();
  for (let i = 0; i <= RATE_MAP_CAP; i++) m.set(`198.51.100.${i}`, { count: 5, reset: now + 60_000 });
  const r = rateLimitFallback("203.0.113.7", 120, m);
  check("v1.4.4: el Map queda en el tope tras una IP nueva (antes crecía sin límite)",
    m.size === RATE_MAP_CAP && r === null, `size=${m.size}`);
  check("v1.4.4: se expulsa de la cabeza (orden de inserción)",
    !m.has("198.51.100.0") && !m.has("198.51.100.1") && m.has("198.51.100.2") && m.has("203.0.113.7"));

  const m2 = new Map();
  for (let i = 0; i <= RATE_MAP_CAP; i++) m2.set(`10.0.${i >> 8}.${i & 255}`, { count: 1, reset: now - 1000 });
  rateLimitFallback("203.0.113.8", 120, m2);
  check("v1.4.4: las entradas caducadas se barren completas (sin expulsar vivas)",
    m2.size === 1 && m2.has("203.0.113.8"), `size=${m2.size}`);

  const m3 = new Map();
  m3.set("203.0.113.9", { count: 119, reset: now + 60_000 });
  for (let i = 1; i <= RATE_MAP_CAP + 1; i++) m3.set(`198.51.100.${i}`, { count: 1, reset: now + 60_000 });
  const r3 = rateLimitFallback("203.0.113.9", 120, m3);
  check("v1.4.4: la IP actual no se expulsa ni se le reinicia el contador",
    r3 === null && m3.get("203.0.113.9").count === 120 && m3.size <= RATE_MAP_CAP,
    `count=${m3.get("203.0.113.9").count}, size=${m3.size}`);
}

// 17) v1.4.5: auditoría de código (H-01, H-02, H-05, H-06.1)
{
  // --- H-02a: spamVerdict con truncated=true solo evalúa la cabeza (la cola
  // de un archivo cortado en 1 MB es diálogo a mitad de película) ---
  const midCTA = "Síguenos en Instagram para ver la foto";
  const filler = Array.from({ length: 60 }, (_, i) => `Línea limpia de diálogo ${i}.`);
  const truncatedSample = [...filler, midCTA].join("\n");
  check("v1.4.5 H-02: sin truncar, la CTA al final cuenta como pie y descarta",
    spamVerdict(truncatedSample, false).discard === true);
  check("v1.4.5 H-02: con truncated=true, las últimas líneas (mitad del archivo) NO descartan",
    spamVerdict(truncatedSample, true).discard === false,
    JSON.stringify(spamVerdict(truncatedSample, true)));
  check("v1.4.5 H-02: con truncated=true, la cabecera sigue descartando igual",
    spamVerdict([midCTA, ...filler].join("\n"), true).discard === true);

  // --- H-02b: SRT UTF-8 de >1 MB cortado por readCapped a mitad de un
  // carácter multibyte (p.ej. 'ó' = C3 B3 cortado tras C3) NO debe disparar
  // el fallback a windows-1252 ni corromper las tildes previas ---
  const origFetch11 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(new Response(JSON.stringify({ subtitles: [
        { id: "cut1", url: "https://subs5.strem.io/utf8_cut.srt", lang: "spa" },
      ] }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("utf8_cut.srt")) {
      // Cabecera con léxico con tilde ("órale güey") + relleno ASCII hasta
      // MAX_ANALYZE_BYTES - 1 + primer byte huérfano de 'ó' (0xC3) + cola.
      // Sin content-length para que readCapped corte exactamente en 1 MB.
      const headBytes = new TextEncoder().encode(
        "1\n00:00:01,000 --> 00:00:02,000\nórale güey chido carro celular\n\n"
      );
      const big = new Uint8Array(MAX_ANALYZE_BYTES + 32);
      big.set(headBytes, 0);
      big.fill(0x20, headBytes.length, MAX_ANALYZE_BYTES - 1); // espacios
      big[MAX_ANALYZE_BYTES - 1] = 0xc3; // 1ª mitad de 'ó' justo en el corte de 1 MB
      big[MAX_ANALYZE_BYTES] = 0xb3;     // 2ª mitad (queda fuera del corte)
      const stream = new ReadableStream({
        start(c) { c.enqueue(big); c.close(); },
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await get("/subtitles/movie/tt7770010.json");
    const cutSubs = (await res.json()).subtitles || [];
    check("v1.4.5 H-02: corte UTF-8 multibyte en 1 MB conserva UTF-8 ('órale/güey' -> Latino)",
      cutSubs.length === 1 && cutSubs[0].label === "🇲🇽 Latino (OS-V3)",
      JSON.stringify(cutSubs));
  } finally {
    globalThis.fetch = origFetch11;
  }

  // --- H-05: TTL por fuente — 1 enlace roto entre 8 pero la fuente llena su
  // cupo de 5 limpias -> TTL 7200 s (el fallo quedó absorbido por el sobrepaso) ---
  const origFetch12 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(new Response(JSON.stringify({ subtitles: [
        { id: "b1", url: "https://subs5.strem.io/roto.srt", lang: "spa" },
        { id: "g1", url: "https://subs5.strem.io/ok1.srt", lang: "spa" },
        { id: "g2", url: "https://subs5.strem.io/ok2.srt", lang: "spa" },
        { id: "g3", url: "https://subs5.strem.io/ok3.srt", lang: "spa" },
        { id: "g4", url: "https://subs5.strem.io/ok4.srt", lang: "spa" },
        { id: "g5", url: "https://subs5.strem.io/ok5.srt", lang: "spa" },
      ] }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("roto.srt")) return Promise.resolve(new Response("err", { status: 503 }));
    if (u.includes("subs5.strem.io/ok")) return Promise.resolve(textResp(TXT_CAST + " " + u));
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await get("/subtitles/movie/tt7770011.json");
    const fullQuota = (await res.json()).subtitles || [];
    check("v1.4.5 H-05: 1 fallo + 5 limpias (cupo completo) -> sirve 5 y cachea 7200s",
      fullQuota.length === 5 && res.headers.get("cache-control") === "public, max-age=7200",
      `len=${fullQuota.length} cc=${res.headers.get("cache-control")}`);
  } finally {
    globalThis.fetch = origFetch12;
  }

  // --- H-01: en series, la URL del proxy lleva &s=<season>&e=<episode> ---
  const origFetch13 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("api.subdl.com")) {
      return Promise.resolve(new Response(JSON.stringify({
        status: true,
        subtitles: [{ url: "/subtitle/pack-s01.zip" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("proxy?zipUrl=")) return Promise.resolve(textResp(TXT_LAT));
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await get(`/${b64url({ subdlKey: "k" })}/subtitles/series/tt0903747:2:5.json`);
    const serSubs = (await res.json()).subtitles || [];
    check("v1.4.5 H-01: zip de serie pasa &s=2&e=5 al proxy",
      serSubs.length === 1 && serSubs[0].url.endsWith("&s=2&e=5"),
      JSON.stringify(serSubs));
  } finally {
    globalThis.fetch = origFetch13;
  }

  // --- H-06.1: readCapped sin getReader devuelve Uint8Array (con .length) ---
  const fakeRes = {
    body: null,
    arrayBuffer: async () => new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]).buffer,
  };
  const capped = await readCapped(fakeRes, 4);
  check("v1.4.5 H-06.1: readCapped sin getReader devuelve Uint8Array con .length",
    capped instanceof Uint8Array && capped.length === 4 && capped[0] === 0xff && capped[1] === 0xfe,
    `type=${capped?.constructor?.name} len=${capped?.length}`);
}

// 18) v1.4.6: descarga en 2 oleadas (5+3), SubDL 403 sin degradar TTL,
// Content-Length > 1 MB truncado en vez de rechazado, y todos-spam -> TTL 60s.
{
  // --- 18a: 2 oleadas (5 + 3) ---
  // Si las 5 primeras de una fuente están limpias, las candidatas 6, 7 y 8 NO
  // se llegan ni a pedir por red (ahorra CPU y evita 429 en OS-V3).
  let fetchedWave1Clean = [];
  const origFetch14 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(new Response(JSON.stringify({
        subtitles: Array.from({ length: 8 }, (_, i) => ({
          id: `w${i + 1}`,
          url: `https://subs5.strem.io/w${i + 1}.srt`,
          lang: "spa",
        })),
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("subs5.strem.io/w")) {
      fetchedWave1Clean.push(u);
      return Promise.resolve(textResp(TXT_CAST + " " + u));
    }
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await get("/subtitles/movie/tt7770020.json");
    const wSubs = (await res.json()).subtitles || [];
    check("v1.4.6 2-oleadas: si las 5 primeras son limpias, solo hace 5 descargas (no 8)",
      wSubs.length === 5 && fetchedWave1Clean.length === 5,
      `served=${wSubs.length} fetched=${fetchedWave1Clean.length}`);
  } finally {
    globalThis.fetch = origFetch14;
  }

  // --- 18b: SubDL 403 (clave caducada/revocada) no degrada el TTL de OS-V3 ---
  const origFetch15 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("api.subdl.com")) {
      return Promise.resolve(new Response("Forbidden", { status: 403 }));
    }
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(new Response(JSON.stringify({
        subtitles: [{ id: "o1", url: "https://subs5.strem.io/o1.srt", lang: "spa" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("subs5.strem.io/o1.srt")) return Promise.resolve(textResp(TXT_CAST));
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await get(`/${b64url({ subdlKey: "bad_key" })}/subtitles/movie/tt7770021.json`);
    const s403 = (await res.json()).subtitles || [];
    check("v1.4.6 SubDL 403: sirve OS-V3 con TTL 7200s (no degrada por clave inválida)",
      s403.length === 1 && res.headers.get("cache-control") === "public, max-age=7200",
      `len=${s403.length} cc=${res.headers.get("cache-control")}`);
  } finally {
    globalThis.fetch = origFetch15;
  }

  // --- 18c: Content-Length > 1 MB se trunca y clasifica en vez de fallar ---
  const origFetch16 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(new Response(JSON.stringify({
        subtitles: [{ id: "big1", url: "https://subs5.strem.io/big_cl.srt", lang: "spa" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("big_cl.srt")) {
      return Promise.resolve(new Response(TXT_LAT, {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": String(MAX_ANALYZE_BYTES + 50000) },
      }));
    }
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await get("/subtitles/movie/tt7770022.json");
    const bigCl = (await res.json()).subtitles || [];
    check("v1.4.6 Content-Length > 1 MB: trunca con readCapped y clasifica (no rechaza)",
      bigCl.length === 1 && bigCl[0].label === "🇲🇽 Latino (OS-V3)",
      JSON.stringify(bigCl));
  } finally {
    globalThis.fetch = origFetch16;
  }

  // --- 18d: Si todos los candidatos son spam y quedan 0 pistas -> TTL 60s ---
  const origFetch17 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(new Response(JSON.stringify({
        subtitles: [{ id: "sp", url: "https://subs5.strem.io/all_spam.srt", lang: "spa" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("all_spam.srt")) {
      return Promise.resolve(textResp("1\n00:00:01,000 --> 00:00:02,000\nRegístrate en bet365\n"));
    }
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await get("/subtitles/movie/tt7770023.json");
    const allSpam = (await res.json()).subtitles || [];
    check("v1.4.6 todos spam (0 pistas resultantes) -> caché negativa 60s (no 7200s)",
      allSpam.length === 0 && res.headers.get("cache-control") === "public, max-age=60",
      `len=${allSpam.length} cc=${res.headers.get("cache-control")}`);
  } finally {
    globalThis.fetch = origFetch17;
  }
}

// 19) v1.4.7: auditoría externa de 1.4.6 (presupuesto de tiempo en 2ª oleada,
// HTTP 404 sin degradar TTL, snippet en spamVerdict, cobertura regional y
// negative lookaheads en diccionarios).
{
  check("v1.4.7: presupuesto de clasificación compartido 6000 ms (tope 1ª oleada 4000 ms)",
    CLASSIFY_BUDGET_MS === 6000 && WAVE2_MAX_W1_MS === 4000,
    `${CLASSIFY_BUDGET_MS}/${WAVE2_MAX_W1_MS}`);

  // --- 19a: spamVerdict devuelve el fragmento (match) que disparó la regla ---
  const svStrong = spamVerdict("1\n00:00:01,000 --> 00:00:02,000\nEntra en bet365 hoy\n");
  check("v1.4.7 spamVerdict fuerte incluye match ('bet365')",
    svStrong.discard === true && svStrong.match.toLowerCase().includes("bet365"),
    JSON.stringify(svStrong));

  const svEdge = spamVerdict("1\n00:00:01,000 --> 00:00:02,000\nSíguenos en Telegram para más\n");
  check("v1.4.7 spamVerdict borde incluye match ('Síguenos en Telegram')",
    svEdge.discard === true && /s[ií]guenos en telegram/i.test(svEdge.match),
    JSON.stringify(svEdge));

  const svWeak = spamVerdict("Traducido por Argenteam\nwww.opensubtitles.org");
  check("v1.4.7 spamVerdict débil incluye ambos matches unidos por ' + '",
    svWeak.discard === true && svWeak.match.includes("Traducido por") && svWeak.match.includes("opensubtitles"),
    JSON.stringify(svWeak));

  // --- 19b: Diccionarios regionales ampliados y negative lookaheads ---
  check("v1.4.7 léxico Rioplatense (boludo/pibe/tenés/mirá) -> Latino",
    scoreText("Che boludo, mirá al pibe, ¿tenés idea del quilombo?")?.flag === "🇲🇽 Latino",
    JSON.stringify(scoreText("Che boludo, mirá al pibe, ¿tenés idea del quilombo?")));
  check("v1.4.7 léxico Chileno (weón/cachai/fome/polola) -> Latino",
    scoreText("Oye weón cachai que la fiesta estuvo fome con mi polola")?.flag === "🇲🇽 Latino",
    JSON.stringify(scoreText("Oye weón cachai que la fiesta estuvo fome con mi polola")));
  check("v1.4.7 léxico Colombiano/Caribe (parcero/chimba/chamo) -> Latino",
    scoreText("Qué chimba parcero, hablá con el chamo")?.flag === "🇲🇽 Latino",
    JSON.stringify(scoreText("Qué chimba parcero, hablá con el chamo")));
  check("v1.4.7 léxico España (os/currar/flipar/mogollón) -> Castellano",
    scoreText("Os digo que flipo mogollón cuando toca currar")?.flag === "🇪🇸 Castellano",
    JSON.stringify(scoreText("Os digo que flipo mogollón cuando toca currar")));
  check("v1.4.7 'sabes' y 'mira' (llanas sin tilde) NO disparan voseo rioplatense",
    scoreText("Tú sabes que él mira por la ventana") === null,
    JSON.stringify(scoreText("Tú sabes que él mira por la ventana")));
  check("v1.4.7 'joder' pasa a débil (0,25): por sí solo no clasifica un título como ES",
    scoreText("no me jodas, joder, qué jodienda joder") === null,
    JSON.stringify(scoreText("no me jodas, joder, qué jodienda joder")));
  check("v1.4.7 lookahead: 'móvil del crimen / móvil del asesinato' NO puntúa como teléfono móvil ES",
    scoreText("El móvil del crimen y el móvil del asesinato y el móvil del delito") === null,
    JSON.stringify(scoreText("El móvil del crimen y el móvil del asesinato y el móvil del delito")));
  check("v1.4.7 lookahead: 'carro de la compra / carro de combate' NO puntúa como automóvil LAT",
    scoreText("Lleva el carro de la compra y el carro de combate y el carro blindado") === null,
    JSON.stringify(scoreText("Lleva el carro de la compra y el carro de combate y el carro blindado")));
  check("v1.4.7 lookahead: 'conduce a nada / conduce a la ruina' NO puntúa como conducir ES",
    scoreText("Esto conduce a nada, conduce a la ruina y conduce a un desastre") === null,
    JSON.stringify(scoreText("Esto conduce a nada, conduce a la ruina y conduce a un desastre")));
  check("v1.4.7 cine formal sin jerga sigue clasificando por sustantivos/verbos cotidianos",
    scoreText("El coche está aparcado, llámame al móvil cuando termines de conducir")?.flag === "🇪🇸 Castellano" &&
      scoreText("El carro está estacionado, llámame al celular cuando termines de manejar")?.flag === "🇲🇽 Latino");

  // --- 19c: HTTP 404 (pack sin episodio o enlace muerto) NO degrada el TTL a 60s
  // cuando hay pistas válidas, pero sí activa la 2ª oleada para rellenar ---
  let wave2CalledOn404 = false;
  const origFetch18 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(new Response(JSON.stringify({
        subtitles: [
          { id: "dead1", url: "https://subs5.strem.io/dead404.srt", lang: "spa" },
          { id: "ok1", url: "https://subs5.strem.io/ok1.srt", lang: "spa" },
          { id: "ok2", url: "https://subs5.strem.io/ok2.srt", lang: "spa" },
          { id: "ok3", url: "https://subs5.strem.io/ok3.srt", lang: "spa" },
          { id: "ok4", url: "https://subs5.strem.io/ok4.srt", lang: "spa" },
          { id: "w2_6", url: "https://subs5.strem.io/w2_6.srt", lang: "spa" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("dead404.srt")) return Promise.resolve(new Response("Not found", { status: 404 }));
    if (u.includes("w2_6.srt")) {
      wave2CalledOn404 = true;
      return Promise.resolve(textResp(TXT_CAST + " " + u));
    }
    if (u.includes("subs5.strem.io/ok")) return Promise.resolve(textResp(TXT_CAST + " " + u));
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await get("/subtitles/movie/tt7770030.json");
    const s404 = (await res.json()).subtitles || [];
    check("v1.4.7 HTTP 404 en 1ª oleada activa 2ª oleada para rellenar las 5 limpias",
      wave2CalledOn404 && s404.length === 5,
      `wave2=${wave2CalledOn404} len=${s404.length}`);
  } finally {
    globalThis.fetch = origFetch18;
  }

  // Y con <5 candidatos totales (p.ej. 1 pack 404 + 2 válidos), el 404 NO baja
  // el TTL a 60s (es ausencia permanente, no caída transitoria).
  const origFetch19 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(new Response(JSON.stringify({
        subtitles: [
          { id: "dead1", url: "https://subs5.strem.io/dead404.srt", lang: "spa" },
          { id: "ok1", url: "https://subs5.strem.io/ok1.srt", lang: "spa" },
          { id: "ok2", url: "https://subs5.strem.io/ok2.srt", lang: "spa" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("dead404.srt")) return Promise.resolve(new Response("Not found", { status: 404 }));
    if (u.includes("subs5.strem.io/ok")) return Promise.resolve(textResp(TXT_CAST + " " + u));
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await get("/subtitles/movie/tt7770031.json");
    const s404Partial = (await res.json()).subtitles || [];
    check("v1.4.7 HTTP 404 con catálogo corto (1×404 + 2 válidas) -> sirve 2 con TTL 7200s (no 60s)",
      s404Partial.length === 2 && res.headers.get("cache-control") === "public, max-age=7200",
      `len=${s404Partial.length} cc=${res.headers.get("cache-control")}`);
  } finally {
    globalThis.fetch = origFetch19;
  }
}

// 20) v1.4.8: distinción de 410/422 vs 404 de proxy en zips, 'os' sensible a
// mayúsculas y débil, guarda de portugués (ã/õ), lookahead 'manejo de' y
// strongTotal en scoreText.
{
  // --- 20a: 'OS' en mayúsculas (Operating System) no suma para España ---
  const techLat = `${"OS ".repeat(40)}computadora computadora computadora computadora computadora`;
  const scoredTech = scoreText(techLat);
  check("v1.4.8: 40× 'OS' (mayúsculas) + 5× 'computadora' -> 🇲🇽 Latino (es=0)",
    scoredTech?.flag === "🇲🇽 Latino" && scoredTech?.esMatches === 0 && scoredTech?.strongTotal === 5,
    JSON.stringify(scoredTech));

  // 'os' solo (religioso/formal) es débil (0,25): sin término fuerte devuelve null (📄).
  check("v1.4.8: 'os' religioso/formal sin término fuerte -> null (sin clasificar)",
    scoreText("Dios os bendiga, os dejo la paz, os digo") === null,
    JSON.stringify(scoreText("Dios os bendiga, os dejo la paz, os digo")));

  // --- 20b: Guarda de portugués (≥10 apariciones de ã/õ -> null) ---
  const ptSub = "Não tenhão ilusão, o caminhão está no coração da nação, irmão, então atenção ao portão: carro celular estacionamento";
  check("v1.4.8: subtítulo en portugués (≥10 ã/õ) con 'carro/celular' -> null (no da 🇲🇽 Latino)",
    scoreText(ptSub) === null, JSON.stringify(scoreText(ptSub)));

  // --- 20c: Lookahead 'manejo de' excluido ---
  check("v1.4.8: 'manejo de crisis / manejo de datos' NO puntúa como conducir LAT",
    scoreText("El manejo de crisis, el manejo de datos y el manejo de presupuesto") === null,
    JSON.stringify(scoreText("El manejo de crisis, el manejo de datos y el manejo de presupuesto")));

  // --- 20d: En zips proxificados, 410/422 descartan sin degradar TTL, pero un
  // 404 crudo (proxy mal enrutado o caído) SÍ cuenta como FAILED (TTL 60s) ---
  const origFetch20 = globalThis.fetch;
  let proxyStatus = 422;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("api.subdl.com")) {
      return Promise.resolve(new Response(JSON.stringify({
        status: true,
        subtitles: [{ url: "/subtitle/pack-missing.zip" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(new Response(JSON.stringify({
        subtitles: [{ id: "o1", url: "https://subs5.strem.io/o1.srt", lang: "spa" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("proxy?zipUrl=")) {
      return Promise.resolve(new Response("err", { status: proxyStatus }));
    }
    if (u.includes("subs5.strem.io/o1.srt")) return Promise.resolve(textResp(TXT_CAST));
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    proxyStatus = 422;
    res = await get(`/${b64url({ subdlKey: "k" })}/subtitles/series/tt0903747:1:7.json`);
    const s422 = (await res.json()).subtitles || [];
    check("v1.4.8: zip con 422 (pack sin el episodio) se descarta sin degradar TTL (7200s)",
      s422.length === 1 && res.headers.get("cache-control") === "public, max-age=7200",
      `len=${s422.length} cc=${res.headers.get("cache-control")}`);

    proxyStatus = 410;
    res = await get(`/${b64url({ subdlKey: "k" })}/subtitles/series/tt0903747:1:8.json`);
    const s410 = (await res.json()).subtitles || [];
    check("v1.4.8: zip con 410 (enlace muerto en SubDL) se descarta sin degradar TTL (7200s)",
      s410.length === 1 && res.headers.get("cache-control") === "public, max-age=7200",
      `len=${s410.length} cc=${res.headers.get("cache-control")}`);

    proxyStatus = 404;
    res = await get(`/${b64url({ subdlKey: "k" })}/subtitles/series/tt0903747:1:9.json`);
    const sProxy404 = (await res.json()).subtitles || [];
    check("v1.4.8: zip con 404 crudo (proxy caído o PROXY_URL rota) SÍ degrada TTL a 60s",
      sProxy404.length === 1 && res.headers.get("cache-control") === "public, max-age=60",
      `len=${sProxy404.length} cc=${res.headers.get("cache-control")}`);
  } finally {
    globalThis.fetch = origFetch20;
  }

  // --- 21: v1.4.9 (densidad de portugués ≥0,2 %, diag.reason y 'manejo del') ---
  const esWithJoao = "Hola João en São Paulo. ".repeat(12) + "En España conducimos el coche, el ordenador y el móvil. ".repeat(36) + "x".repeat(80000);
  const diagEsJoao = {};
  const scoredEsJoao = scoreText(esWithJoao, diagEsJoao);
  check("v1.4.9: subtítulo español de 84 KB con 24 'ã' ('João/São Paulo', <0,2%) NO cae en portugués -> 🇪🇸 Castellano",
    scoredEsJoao?.flag === "🇪🇸 Castellano",
    JSON.stringify({ scoredEsJoao, diagEsJoao }));

  const diagPt = {};
  scoreText(ptSub, diagPt);
  const diagWeak = {};
  scoreText("vale vale ustedes", diagWeak);
  const diagEmpty = {};
  scoreText("hola mundo sin modismos", diagEmpty);
  // Portugués en MAYÚSCULAS (subtítulos de TV): "NÃO"/"AÇÕES" cuentan; el "Ã" del
  // mojibake UTF-8 ("Ã¡", "Ã©") no, porque nunca va seguido de una letra ASCII.
  const ptCaps = "NÃO SEI, ENTÃO VOU AO CARRO PEGAR O CELULAR. ESTACIONAMENTO CHEIO, NÃO DÁ. ".repeat(60);
  const dPtCaps = {};
  const mojibake = Buffer.from("¿Qué estás haciendo? Vosotros no sabéis nada, tío. El ordenador está ahí. ".repeat(40), "utf8").toString("latin1");
  const dMoji = {};
  check("v1.4.10: portugués en MAYÚSCULAS -> null (guarda); mojibake UTF-8 NO cuenta como portugués",
    scoreText(ptCaps, dPtCaps) === null && dPtCaps.reason === "portugués" &&
      scoreText(mojibake, dMoji)?.flag === "🇪🇸 Castellano",
    JSON.stringify({ dPtCaps, dMoji }));

  check("v1.4.9: diag.reason distingue 'portugués', 'solo términos débiles' y 'sin léxico'",
    diagPt.reason === "portugués" &&
      diagWeak.reason === "solo términos débiles" && diagWeak.es === 0.5 && diagWeak.lat === 0.25 &&
      diagEmpty.reason === "sin léxico",
    JSON.stringify({ diagPt, diagWeak, diagEmpty }));

  check("v1.4.9: 'manejo del presupuesto / manejo del estrés' NO puntúa como conducir LAT",
    scoreText("El manejo del presupuesto, el manejo del estrés y el manejo del tiempo") === null,
    JSON.stringify(scoreText("El manejo del presupuesto, el manejo del estrés y el manejo del tiempo")));
}

// 22) v1.4.12: las URLs de descarga de dl.subdl.com son canónicas (origen + ruta): se
// descarta TODA la consulta y el fragmento, sea cual sea el nombre del parámetro.
{
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("api.subdl.com")) {
      return Promise.resolve(new Response(JSON.stringify({
        status: true,
        subtitles: [
          { url: "/subtitle/901-901.zip?API_KEY=leakA", file_id: 901 },
          { url: "/subtitle/902-902.zip?apikey=leakB&foo=1", file_id: 902 },
          { url: "https://dl.subdl.com/subtitle/903-903.srt?token=leakC#api_key=leakD", file_id: 903 },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    return Promise.resolve(textResp(TXT_CAST + " " + u));
  };
  try {
    const resCanon = await get(`/${b64url({ subdlKey: "k" })}/subtitles/movie/tt7771101.json`);
    const jCanon = await resCanon.json();
    const bodyCanon = decodeURIComponent(JSON.stringify(jCanon));
    check("v1.4.12: URLs de SubDL con API_KEY/apikey/token/fragmento salen sin ninguna clave",
      (jCanon.subtitles || []).length === 3 && !/leak[A-D]/.test(bodyCanon), bodyCanon.slice(0, 220));
  } finally {
    globalThis.fetch = prevFetch;
  }
}

// 23) v1.4.14: Endurecimiento SDH contra falsos positivos + Hash de 64 bits con muestreo de cola
{
  // --- A. Tests unitarios isSdh (descriptores acústicos y anti-falsos-positivos) ---
  const normalDialog = "1\n00:00:10,000 --> 00:00:12,000\nHola Juan (hace tiempo que no te veo).\n\n2\n00:00:13,000 --> 00:00:15,000\nSí, desde el año (1998) en el hospital (Dr. Gómez).\n";
  check("v1.4.14 isSdh: diálogo ordinario con paréntesis y fechas -> false",
    isSdh(normalDialog) === false);

  // Falso positivo 1: Etiquetas de hablante con dos puntos
  const speakerTags = Array.from({ length: 15 }, (_, i) =>
    `${i + 1}\n00:0${i}:00,000 --> 00:0${i}:02,000\n[JUAN ${i}]: ¿Dónde estás? (MARÍA ${i}): Aquí estoy.\n`
  ).join("\n");
  check("v1.4.14 isSdh anti-falsos-positivos: etiquetas de hablante [Nombre]: y preguntas -> false",
    isSdh(speakerTags) === false);

  // Falso positivo 2: Letras de canciones con notas musicales ♪ (musicales / animación)
  const songLyrics = Array.from({ length: 15 }, (_, i) =>
    `${i + 1}\n00:0${i}:00,000 --> 00:0${i}:02,000\n♪ Ayer te vi pasar caminando por la calle bajo el sol ♪\n`
  ).join("\n");
  check("v1.4.14 isSdh anti-falsos-positivos: transcripción de letra con ♪ sin descriptores -> false",
    isSdh(songLyrics) === false);

  // SDH genuino: descriptores acústicos entre corchetes o paréntesis
  const sdhSample = Array.from({ length: SDH_MIN_MATCHES }, (_, i) =>
    `${i + 1}\n00:0${i}:00,000 --> 00:0${i}:02,000\n[música misteriosa ${i}]\n`
  ).join("\n");
  check("v1.4.14 isSdh: anotaciones acústicas entre corchetes >= umbral -> true",
    isSdh(sdhSample) === true);

  const sdhParens = Array.from({ length: SDH_MIN_MATCHES }, (_, i) =>
    `${i + 1}\n00:0${i}:00,000 --> 00:0${i}:02,000\n(suspira hondo ${i})\n`
  ).join("\n");
  check("v1.4.14 isSdh: descriptores de sonido entre paréntesis >= umbral -> true",
    isSdh(sdhParens) === true);

  check("v1.4.14 isSdh: vacíos o falsy -> false",
    isSdh("") === false && isSdh(null) === false && isSdh(undefined) === false);

  const t0Sdh = performance.now();
  const hostileSdh = "[[[[[[[[[[((((((((([[[[[[[a".repeat(3000);
  isSdh(hostileSdh);
  const dtSdh = performance.now() - t0Sdh;
  check("v1.4.14 isSdh anti-ReDoS: texto hostil (80k car.) procesa en <50ms",
    dtSdh < 50, `dt=${dtSdh.toFixed(2)}ms`);

  // --- B. Tests unitarios hashContent ---
  const crlfText = "1\r\n00:00:01,000 --> 00:00:04,000\r\nHola mundo\r\n\r\n";
  const lfText = "1\n00:00:01,000 --> 00:00:04,000\nHola mundo\n";
  const bomText = "\uFEFF1\n00:00:01,000 --> 00:00:04,000\nHola mundo\n";
  const diffTimeText = "1\n00:00:02,000 --> 00:00:05,000\nHola mundo\n";

  check("v1.4.14 hashContent: CRLF vs LF produce idéntico hash",
    hashContent(crlfText) === hashContent(lfText),
    `crlf=${hashContent(crlfText)} lf=${hashContent(lfText)}`);

  check("v1.4.14 hashContent: BOM UTF-8 se descarta y produce idéntico hash",
    hashContent(bomText) === hashContent(lfText),
    `bom=${hashContent(bomText)} lf=${hashContent(lfText)}`);

  check("v1.4.14 hashContent: sincronización diferente (distinto timestamp) da distinto hash",
    hashContent(diffTimeText) !== hashContent(lfText),
    `diff=${hashContent(diffTimeText)} orig=${hashContent(lfText)}`);

  // Muestreo de cola en archivos de más de 64 KB con mismo inicio de 64 KB
  const prefix64k = "1\n00:00:01,000 --> 00:00:02,000\nDiálogo común.\n".repeat(1500);
  const longFileA = prefix64k + "\nFinal alternativo A con resolución.";
  const longFileB = prefix64k + "\nFinal alternativo B con desenlace.";
  check("v1.4.14 hashContent: archivos largos con mismo inicio pero distinta cola -> hashes diferentes",
    hashContent(longFileA) !== hashContent(longFileB),
    `hashA=${hashContent(longFileA)} hashB=${hashContent(longFileB)}`);

  check("v1.4.14 hashContent: texto vacío o no string produce cadena vacía",
    hashContent("") === "" && hashContent(null) === "");

  // --- C. Integración: Etiquetado SDH (clasificado y unclassified) ---
  const sdhCastellano = sdhSample + "\n" + TXT_CAST;
  const sdhUnclassified = sdhSample + "\nzzzz qqqq xxxx jj kk ll vv nn mm";
  const origFetch21 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(new Response(JSON.stringify({
        subtitles: [
          { id: "sdh1", url: "https://subs5.strem.io/sdh_cast.srt", lang: "spa" },
          { id: "sdh2", url: "https://subs5.strem.io/sdh_uncl.srt", lang: "spa" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (u.includes("sdh_cast.srt")) return Promise.resolve(textResp(sdhCastellano));
    if (u.includes("sdh_uncl.srt")) return Promise.resolve(textResp(sdhUnclassified));
    return Promise.resolve(new Response(JSON.stringify({ subtitles: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    res = await get("/subtitles/movie/tt8880001.json");
    const sdhSubs = (await res.json()).subtitles || [];
    const castSdh = sdhSubs.find((e) => e.url.includes("sdh_cast.srt"));
    const unclSdh = sdhSubs.find((e) => e.url.includes("sdh_uncl.srt"));

    check("v1.4.14 SDH clasificado -> etiqueta incluye (SDH)",
      castSdh?.label === "🇪🇸 Castellano (SDH) (OS-V3)",
      `label=${castSdh?.label}`);

    check("v1.4.14 SDH sin clasificar -> etiqueta incluye · SDH ·",
      unclSdh?.label === "📄 Español (sin clasificar · SDH · OS-V3)",
      `label=${unclSdh?.label}`);
  } finally {
    globalThis.fetch = origFetch21;
  }

  // --- D. Integración: Deduplicación por contenido y 2ª oleada ---
  // Subtítulo clonado con URL distinta: se descarta limpiamente sin degradar TTL.
  // Además, si el clon estaba en 1ª oleada, la 2ª oleada debe activarse para completar las 5 limpias.
  let wave2RanForDedup = false;
  const origFetch22 = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(new Response(JSON.stringify({
        subtitles: [
          { id: "d1", url: "https://subs5.strem.io/original.srt", lang: "spa" },
          { id: "d2", url: "https://subs5.strem.io/clon_duplicado.srt", lang: "spa" },
          { id: "d3", url: "https://subs5.strem.io/sub3.srt", lang: "spa" },
          { id: "d4", url: "https://subs5.strem.io/sub4.srt", lang: "spa" },
          { id: "d5", url: "https://subs5.strem.io/sub5.srt", lang: "spa" },
          { id: "d6", url: "https://subs5.strem.io/reserva_wave2.srt", lang: "spa" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    // original y clon_duplicado devuelven exactamente el mismo texto
    if (u.includes("original.srt") || u.includes("clon_duplicado.srt")) {
      return Promise.resolve(textResp(TXT_CAST + "\ntexto_comun_identico"));
    }
    if (u.includes("reserva_wave2.srt")) {
      wave2RanForDedup = true;
      return Promise.resolve(textResp(TXT_CAST + "\nreserva"));
    }
    return Promise.resolve(textResp(TXT_CAST + "\n" + u));
  };
  try {
    res = await get("/subtitles/movie/tt8880002.json");
    const dedupSubs = (await res.json()).subtitles || [];
    const dedupUrls = dedupSubs.map((s) => s.url);

    check("v1.4.14 dedup contenido: original se sirve y clon_duplicado se descarta",
      dedupUrls.some((u) => u.includes("original.srt")) &&
      !dedupUrls.some((u) => u.includes("clon_duplicado.srt")),
      JSON.stringify(dedupUrls));

    check("v1.4.14 dedup contenido: activa 2ª oleada para sustituir al duplicado y llenar cupo de 5",
      wave2RanForDedup && dedupSubs.length === 5,
      `w2Ran=${wave2RanForDedup} len=${dedupSubs.length}`);

    check("v1.4.14 dedup contenido: descarte limpio NO degrada TTL (mantiene 7200s)",
      res.headers.get("cache-control") === "public, max-age=7200",
      `cc=${res.headers.get("cache-control")}`);
  } finally {
    globalThis.fetch = origFetch22;
  }
}

// 24) v1.4.15: Fix falso positivo spam Casino Royale, CPU 300KB, calibración léxica y SDH con exclamación
{
  // A. Anti-spam: títulos y diálogos con casinos legítimos NO se descartan
  check("v1.4.15 spam: '007 Casino Royale (2006)' conservado (no es spam)",
    spamVerdict("007 Casino Royale (2006)").discard === false);
  check("v1.4.15 spam: 'Ocean\\'s Eleven (2001)' conservado",
    spamVerdict("Ocean's Eleven (2001)").discard === false);
  check("v1.4.15 spam: 'más de 50 casinos en la ciudad' conservado",
    spamVerdict("más de 50 casinos en la ciudad").discard === false);
  check("v1.4.15 spam: marca de apuestas '888casino' pegada sí se descarta",
    spamVerdict("entra a 888casino online").discard === true);
  check("v1.4.15 spam: marca de apuestas '777slots' pegada sí se descarta",
    spamVerdict("juega en 777slots y gana").discard === true);

  // B. Calibración léxica de margin: ventajas netas (>=2 vs 0) no caen en falso Neutro
  const scoreEsNeto = scoreText("Llámame al móvil, nos vemos en el aparcamiento");
  check("v1.4.15 léxico: es=2, lat=0 -> Castellano (no falso Neutro)",
    scoreEsNeto?.flag === "🇪🇸 Castellano", JSON.stringify(scoreEsNeto));

  const scoreLatNeto = scoreText("Prende el celular, estacioné en la banqueta");
  check("v1.4.15 léxico: lat=2, es=0 -> Latino (no falso Neutro)",
    scoreLatNeto?.flag === "🇲🇽 Latino", JSON.stringify(scoreLatNeto));

  const scoreMixto = scoreText("coche carro coche carro");
  check("v1.4.15 léxico: es=2, lat=2 equilibrado -> Neutro",
    scoreMixto?.flag === "🌎 Neutro", JSON.stringify(scoreMixto));

  // C. SDH: descriptores acústicos con signos de exclamación son válidos
  const sdhExclamaciones = Array.from({ length: SDH_MIN_MATCHES }, (_, i) =>
    `${i + 1}\n00:0${i}:00,000 --> 00:0${i}:02,000\n[¡DISPAROS! ${i}]\n`
  ).join("\n");
  check("v1.4.15 isSdh: descriptores con [¡DISPAROS!] cuentan para SDH",
    isSdh(sdhExclamaciones) === true);

  // D. CPU & readCapped: tamaño exacto a MAX_ANALYZE_BYTES no es truncated
  const exactRes = {
    body: null,
    arrayBuffer: async () => new Uint8Array(MAX_ANALYZE_BYTES).buffer,
  };
  const exactCapped = await readCapped(exactRes, MAX_ANALYZE_BYTES);
  check("v1.4.15 readCapped: tamaño exacto a MAX_ANALYZE_BYTES tiene truncated=false",
    exactCapped.truncated === false);

  const overflowRes = {
    body: null,
    arrayBuffer: async () => new Uint8Array(MAX_ANALYZE_BYTES + 10).buffer,
  };
  const overflowCapped = await readCapped(overflowRes, MAX_ANALYZE_BYTES);
  check("v1.4.15 readCapped: tamaño > MAX_ANALYZE_BYTES tiene truncated=true",
    overflowCapped.truncated === true && overflowCapped.length === MAX_ANALYZE_BYTES);
}

// 25) v1.4.16: Blindaje de CPU en Free (<5 ms), calibración léxica sin falsos positivos, spam contextual y caché canónica
{
  // A. Calibración léxica: acumulación de términos débiles ("vale" x4) NO dispara Castellano
  const scoreVale = scoreText("coche vale vale vale vale");
  check("v1.4.16 léxico: 1 fuerte + 4 débiles ('coche vale x4') queda en Neutro (no sobrecorrige a Castellano)",
    scoreVale?.flag === "🌎 Neutro", JSON.stringify(scoreVale));

  const scoreVale3 = scoreText("coche vale vale vale");
  check("v1.4.16 léxico: 1 fuerte + 3 débiles queda en Neutro",
    scoreVale3?.flag === "🌎 Neutro", JSON.stringify(scoreVale3));

  const scoreEsFuerte = scoreText("Llámame al móvil, nos vemos en el aparcamiento");
  check("v1.4.16 léxico: 2 fuertes reales (móvil, aparcamiento) -> Castellano",
    scoreEsFuerte?.flag === "🇪🇸 Castellano", JSON.stringify(scoreEsFuerte));

  const scoreLatFuerte = scoreText("Prende el celular, estacioné el carro");
  check("v1.4.16 léxico: 2 fuertes reales (celular, carro) -> Latino",
    scoreLatFuerte?.flag === "🇲🇽 Latino", JSON.stringify(scoreLatFuerte));

  // B. Anti-spam contextual: marcas numéricas con espacio ("888 casino") se detectan si hay contexto de apuestas
  check("v1.4.16 spam contextual: 'entra a 888 casino online y gana' se descarta",
    spamVerdict("entra a 888 casino online y gana").discard === true);
  check("v1.4.16 spam contextual: 'bono de 100 en 777 casino' se descarta",
    spamVerdict("bono de 100 en 777 casino").discard === true);
  check("v1.4.16 spam contextual: '007 Casino Royale (2006)' se conserva intacto",
    spamVerdict("007 Casino Royale (2006)").discard === false);
  check("v1.4.16 spam contextual: 'más de 50 casinos en la ciudad' se conserva intacto",
    spamVerdict("más de 50 casinos en la ciudad").discard === false);

  // C. Normalización canónica de caché (getCanonicalConfigStr)
  check("v1.4.16 cache: config vacía colapsa a ''",
    getCanonicalConfigStr({}) === "");
  check("v1.4.16 cache: config con subdlKey no string colapsa a ''",
    getCanonicalConfigStr({ subdlKey: 12345678 }) === "" &&
    getCanonicalConfigStr({ subdlKey: { foo: "bar" } }) === "");
  check("v1.4.16 cache: config con subdlKey corta o vacía colapsa a ''",
    getCanonicalConfigStr({ subdlKey: "   " }) === "" &&
    getCanonicalConfigStr({ subdlKey: "short" }) === "");
  check("v1.4.16 cache: dos claves de SubDL válidas comparten el namespace unificado 'k_subdl'",
    getCanonicalConfigStr({ subdlKey: "key_88c_d5iw2o5i" }) === "k_subdl" &&
    getCanonicalConfigStr({ subdlKey: "key_q1i_4aln61h4" }) === "k_subdl");

  // D. readCapped con ReadableStream real (cobertura de streaming)
  const streamExact = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(100));
      controller.close();
    }
  }));
  const cappedExactStream = await readCapped(streamExact, 100);
  check("v1.4.16 readCapped stream: tamaño exacto al tope -> truncated=false",
    cappedExactStream.truncated === false && cappedExactStream.length === 100);

  const streamOverSingle = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(150));
      controller.close();
    }
  }));
  const cappedOverSingle = await readCapped(streamOverSingle, 100);
  check("v1.4.16 readCapped stream: chunk único excedido -> truncated=true y longitud cortada",
    cappedOverSingle.truncated === true && cappedOverSingle.length === 100);

  const streamOverMulti = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(60));
      controller.enqueue(new Uint8Array(60));
      controller.close();
    }
  }));
  const cappedOverMulti = await readCapped(streamOverMulti, 100);
  check("v1.4.16 readCapped stream: chunks múltiples excedidos -> truncated=true y longitud cortada",
    cappedOverMulti.truncated === true && cappedOverMulti.length === 100);

  // E. hashContent en archivos grandes: rápido y consistente CRLF vs LF
  const bigCRLF = "1\r\n00:00:01,000 --> 00:00:02,000\r\nDiálogo de prueba.\r\n\r\n".repeat(2500); // ~150KB
  const bigLF = "1\n00:00:01,000 --> 00:00:02,000\nDiálogo de prueba.\n\n".repeat(2500);
  const t0Hash = performance.now();
  const hashCRLF = hashContent(bigCRLF);
  const hashLF = hashContent(bigLF);
  const dtHash = performance.now() - t0Hash;
  check("v1.4.16 hashContent: archivo 150KB CRLF vs LF produce hash idéntico",
    hashCRLF === hashLF, `hashCRLF=${hashCRLF} hashLF=${hashLF}`);
  check("v1.4.16 hashContent: hashing de 2x 150KB toma <10ms en total",
    dtHash < 10, `dt=${dtHash.toFixed(2)}ms`);

  // F. Cabecera x-cache en respuesta de subtítulos
  const resSub = await get("/subtitles/movie/tt1375666.json");
  check("v1.4.16 x-cache: respuesta de subtítulos incluye cabecera x-cache",
    resSub.headers.has("x-cache"), resSub.headers.get("x-cache"));
}

// 24) v1.4.17: catch con ámbito correcto y anti-envenenamiento de k_subdl
{
  const jsonR = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });

  // A. Un error inesperado dentro del try NO debe romper el catch (ReferenceError -> 500)
  {
    const prevC = mockGlobal("caches", {
      default: { match: async () => ({ body: "x", status: 99 }), put: async () => {} },
    });
    const origErr = console.error;
    console.error = () => {};
    try {
      let resErr, thrown = null;
      try {
        resErr = await worker.fetch(
          new Request(`${base}/${b64url({ subdlKey: "clave_valida_123" })}/subtitles/movie/tt7780001.json`),
          {}, { waitUntil: () => {} });
      } catch (e) { thrown = e; }
      const jErr = resErr ? await resErr.json() : null;
      check("v1.4.17 catch: error inesperado devuelve 200 {subtitles:[]} (sin ReferenceError)",
        !thrown && resErr.status === 200 && Array.isArray(jErr.subtitles) && jErr.subtitles.length === 0
          && resErr.headers.get("cache-control") === "public, max-age=60",
        thrown ? thrown.message : `status=${resErr?.status}`);
    } finally {
      console.error = origErr;
      restoreGlobal("caches", prevC);
    }
  }

  // B. SubDL no utilizable (status:false / 403) -> NO se cachea en k_subdl, sí en el público
  for (const [label, subdlResp] of [
    ["status:false", () => jsonR({ status: false, error: "invalid api key" })],
    ["HTTP 403", () => new Response("forbidden", { status: 403 })],
  ]) {
    const puts = [];
    const prevC = mockGlobal("caches", {
      default: { match: async () => undefined, put: async (req) => { puts.push(req.url); } },
    });
    const prevF = globalThis.fetch;
    globalThis.fetch = (input) => {
      const u = String(input && input.url !== undefined ? input.url : input);
      if (u.includes("opensubtitles-v3.strem.io")) {
        return Promise.resolve(jsonR({ subtitles: [{ id: "p1", url: "https://subs5.strem.io/p1.srt", lang: "spa" }] }));
      }
      if (u.includes("api.subdl.com")) return Promise.resolve(subdlResp());
      return Promise.resolve(textResp(TXT_CAST));
    };
    const origErr = console.error;
    console.error = () => {};
    try {
      const waits = [];
      const r = await worker.fetch(
        new Request(`${base}/${b64url({ subdlKey: "clave_falsa_999" })}/subtitles/movie/tt7780002.json`),
        {}, { waitUntil: (p) => waits.push(p) });
      const j = await r.json();
      await Promise.all(waits);
      check(`v1.4.17 caché (${label}): sirve OS-V3 con TTL 7200s`,
        j.subtitles.length === 1 && r.headers.get("cache-control") === "public, max-age=7200");
      check(`v1.4.17 caché (${label}): nunca escribe en k_subdl (sin envenenamiento)`,
        puts.length === 1 && !puts.some((u) => u.includes("k_subdl")), JSON.stringify(puts));
      check(`v1.4.18 caché (${label}): la respuesta solo-OS-V3 va al namespace de esa clave (k_<hash>)`,
        /\/k_[a-z0-9]+\/subtitles\/movie\/tt7780002\.json$/.test(puts[0] || ""), JSON.stringify(puts));
    } finally {
      console.error = origErr;
      globalThis.fetch = prevF;
      restoreGlobal("caches", prevC);
    }
  }

  // C. SubDL sano con clave válida -> sí usa k_subdl
  {
    const puts = [];
    const prevC = mockGlobal("caches", {
      default: { match: async () => undefined, put: async (req) => { puts.push(req.url); } },
    });
    const prevF = globalThis.fetch;
    globalThis.fetch = (input) => {
      const u = String(input && input.url !== undefined ? input.url : input);
      if (u.includes("opensubtitles-v3.strem.io")) return Promise.resolve(jsonR({ subtitles: [] }));
      if (u.includes("api.subdl.com")) {
        return Promise.resolve(jsonR({ status: true, subtitles: [{ url: "/subtitle/1-2.zip", file_id: 1 }] }));
      }
      return Promise.resolve(textResp(TXT_CAST));
    };
    try {
      const waits = [];
      await worker.fetch(
        new Request(`${base}/${b64url({ subdlKey: "clave_valida_123" })}/subtitles/movie/tt7780003.json`),
        {}, { waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
      check("v1.4.17 caché: SubDL sano con clave válida cachea en k_subdl",
        puts.length === 1 && puts[0] === `${base}/k_subdl/subtitles/movie/tt7780003.json`, JSON.stringify(puts));
    } finally {
      globalThis.fetch = prevF;
      restoreGlobal("caches", prevC);
    }
  }
}

// 25) v1.4.18: regresión de caché, CPU de isSdh y falsos positivos SDH
{
  const jsonR = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
  const memCache = () => {
    const m = new Map();
    return {
      m,
      default: {
        match: async (req) => { const r = m.get(req.url); return r ? r.clone() : undefined; },
        put: async (req, r) => { m.set(req.url, r); },
      },
    };
  };
  const mkFetch = (counter, subdl) => (input) => {
    const u = String(input && input.url !== undefined ? input.url : input);
    if (u.includes("opensubtitles-v3.strem.io")) {
      return Promise.resolve(jsonR({ subtitles: [{ id: "q1", url: "https://subs5.strem.io/q1.srt", lang: "spa" }] }));
    }
    if (u.includes("api.subdl.com")) { counter.subdl++; return Promise.resolve(subdl()); }
    counter.dl++;
    return Promise.resolve(textResp(TXT_CAST));
  };
  const run = async (key, id, waits) =>
    worker.fetch(new Request(`${base}/${b64url({ subdlKey: key })}/subtitles/movie/${id}.json`), {},
      { waitUntil: (p) => waits.push(p) });

  const scenarios = [
    ["clave rechazada (403)", () => new Response("no", { status: 403 }), 7200],
    ["clave rechazada (status:false)", () => jsonR({ status: false }), 7200],
    ["SubDL caído (500) con clave válida", () => new Response("boom", { status: 500 }), 60],
  ];
  for (const [label, subdl, ttl] of scenarios) {
    const cache = memCache();
    const prevC = mockGlobal("caches", cache);
    const prevF = globalThis.fetch;
    const counter = { subdl: 0, dl: 0 };
    globalThis.fetch = mkFetch(counter, subdl);
    const origErr = console.error, origLog = console.log;
    console.error = () => {}; console.log = () => {};
    try {
      const waits = [];
      const r1 = await run("clave_probada_123", "tt7790001", waits);
      await Promise.all(waits);
      const after1 = { ...counter };
      const r2 = await run("clave_probada_123", "tt7790001", waits);
      await Promise.all(waits);
      console.log = origLog;
      check(`v1.4.18 caché (${label}): TTL ${ttl}s`,
        r1.headers.get("cache-control") === `public, max-age=${ttl}`, r1.headers.get("cache-control"));
      check(`v1.4.18 caché (${label}): la 2ª petición es HIT sin repetir descargas ni búsqueda`,
        r2.headers.get("x-cache") === "HIT" && counter.dl === after1.dl && counter.subdl === after1.subdl,
        `x-cache=${r2.headers.get("x-cache")} dl=${after1.dl}->${counter.dl} subdl=${after1.subdl}->${counter.subdl}`);
      check(`v1.4.18 caché (${label}): ${ttl === 60 ? "en k_subdl (caché negativa)" : "nunca en k_subdl"}`,
        ttl === 60
          ? [...cache.m.keys()].every((u) => u.includes("/k_subdl/"))
          : ![...cache.m.keys()].some((u) => u.includes("/k_subdl/")),
        JSON.stringify([...cache.m.keys()]));
      if (ttl === 7200) {
        // otro usuario con clave válida NO recibe la respuesta de la clave mala
        const waits2 = [];
        const rOther = await run("otra_clave_ok_456", "tt7790001", waits2);
        check(`v1.4.18 caché (${label}): otro usuario no hereda la entrada de la clave rechazada`,
          rOther.headers.get("x-cache") === "MISS", String(rOther.headers.get("x-cache")));
      }
    } finally {
      console.error = origErr; console.log = origLog;
      globalThis.fetch = prevF;
      restoreGlobal("caches", prevC);
    }
  }

  // catch: la caché negativa de 60 s también se escribe para clave válida
  {
    const puts = [];
    const prevC = mockGlobal("caches", {
      default: {
        match: async (req) => (req.url.includes("/k_subdl/") ? { body: "x", status: 99 } : undefined),
        put: async (req) => { puts.push(req.url); },
      },
    });
    const origErr = console.error; console.error = () => {};
    try {
      const waits = [];
      const r = await run("clave_valida_123", "tt7790002", waits);
      await Promise.all(waits);
      check("v1.4.18 catch: la caché negativa de 60 s se escribe también con clave válida (k_subdl)",
        r.status === 200 && puts.length === 1 && puts[0].includes("/k_subdl/"), JSON.stringify(puts));
    } finally {
      console.error = origErr;
      restoreGlobal("caches", prevC);
    }
  }

  // CPU de isSdh con ficheros hostiles
  for (const [label, ch] of [["[", "["], ["(", "("], ["[x", "[x"], ["(x", "(x"]]) {
    const hostile = ch.repeat(Math.ceil(300000 / ch.length));
    const t0 = performance.now();
    const r = isSdh(hostile);
    const dt = performance.now() - t0;
    check(`v1.4.18 isSdh: 300 KB hostiles de '${label}' no disparan SDH y tardan <10 ms`,
      r === false && dt < 10, `dt=${dt.toFixed(1)}ms r=${r}`);
  }
  check("v1.4.18 isSdh: una muestra (cabeza+cola) sigue detectando SDH real en ficheros grandes",
    isSdh("[música]\n".repeat(20) + "Diálogo normal.\n".repeat(40000)) === true);

  // Falsos positivos por subcadena y casos reales
  const rep12 = (w) => `${w}\n`.repeat(12);
  for (const fp of ["(Marie)", "[CARRIE]", "(Cantabria)", "(Golpeado)", "[Marielle]"]) {
    check(`v1.4.18 isSdh: 12× ${fp} NO es SDH`, isSdh(rep12(fp)) === false);
  }
  for (const ok of ["[GRITA]", "[música]", "(suspira)", "[Risas]", "(ríe)", "[¡DISPAROS!]"]) {
    check(`v1.4.18 isSdh: 12× ${ok} SÍ es SDH`, isSdh(rep12(ok)) === true);
  }
}

// 26) v1.4.19: Detección y observación de subtítulos de plataforma oficial / retail
{
  // A. Coincidencias positivas de plataformas oficiales (streaming y discos físicos)
  const officialRips = [
    { releaseName: "Stranger.Things.S04E01.720p.NF.WEB-DL.DDP5.1.x264-NTb" },
    { releaseName: "The.Boys.S03E01.1080p.AMZN.WEBRip.DDP5.1.x264-FLUX" },
    { releaseName: "Loki.S02E01.720p.DSNP.WEB-DL.DDP5.1.x264-CMRG" },
    { releaseName: "Ted.Lasso.S03E01.1080p.ATVP.WEB-DL.DDP5.1.x264-GLHF" },
    { releaseName: "House.of.the.Dragon.S01E01.1080p.HMAX.WEB-DL" },
    { releaseName: "The.Bear.S02E01.1080p.HULU.WEB-DL.DDP5.1.H.264" },
  ];

  for (const sub of officialRips) {
    check(`v1.4.19 isPlatformRelease: detecta '${sub.releaseName.slice(0, 30)}...'`,
      isPlatformRelease(sub) === true);
  }

  // B. Falsos negativos evitados (grabaciones de cine, ripeos caseros o títulos sin metadatos)
  const nonOfficial = [
    { releaseName: "Inception 2010.CAM. XviD-MAGNET", releaseFormat: "Cam" },
    { releaseName: "Inception iNTERNAL TELESYNC 720p x264-ORC", releaseFormat: "Telesync" },
    { releaseName: "Deadpool.HDCAM.x264-TITAN" },
    { releaseName: "Inception.srt" },
    { releaseName: "Subtítulo aficionado" },
    // v1.4.20: etiquetas de VÍDEO (sincronía), no de plataforma
    { releaseName: "Inception.2010.1080p.BluRay.DTS.dxva.x264.D-Z0N3" },
    { releaseName: "Oppenheimer.2023.2160p.UHD.BDRip.x265" },
    { releaseName: "Dune.Part.Two.2024.1080p.WEB-DL.DDP5.1.Atmos" },
    { releaseName: "Movie.2020.WEBRip.x265" },
    {},
    null,
  ];

  for (const sub of nonOfficial) {
    check(`v1.4.19 isPlatformRelease: rechaza '${(sub?.releaseName || "vacío").slice(0, 25)}'`,
      isPlatformRelease(sub) === false);
  }

  // C. Metadata en símbolo IS_PLATFORM no se filtra al JSON final de Stremio
  const subCandidate = {
    id: "test_sub_1",
    url: "https://example.com/sub.srt",
    lang: "spa",
    label: "🇪🇸 Castellano (OS-V3)",
    [IS_PLATFORM]: true,
  };
  const jsonStr = JSON.stringify(subCandidate);
  const parsed = JSON.parse(jsonStr);
  check("v1.4.19 IS_PLATFORM: símbolo interno se omite del JSON final",
    !("isPlatform" in parsed) && Object.keys(parsed).length === 4);
}

// 27) v1.4.20: métrica de plataforma sin falsos positivos por título; precedencia
//     de campos de OS-V3; rama "sin resultados" sin envenenar k_subdl
{
  const jsonR = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });

  // A. Títulos de película NO son plataforma (regresión: "Mad Max" -> MAX)
  for (const n of ["Mad Max: Fury Road (2015)", "Max (2015)", "Prime (2005)", "The Apple (1980)",
                   "Apple of My Eye", "Disney Princess", "UHD Review", "Maxwell.srt"]) {
    check(`v1.4.20 plataforma: título '${n}' no es plataforma`, isPlatformRelease({ releaseName: n }) === false);
  }
  // B. Etiquetas de servicio sí, con cualquier separador (incluido '_')
  for (const n of ["Movie.2020.1080p.AMZN.WEB-DL", "Movie_2020_NF_WEB-DL", "Movie 2020 [DSNP] WEB",
                   "Show.S01E01.1080p.MAX.WEB-DL.DDP5.1", "Show.S01E01.NETFLIX.srt"]) {
    check(`v1.4.20 plataforma: detecta '${n}'`, isPlatformRelease({ releaseName: n }) === true);
  }
  check("v1.4.20 plataforma: 'MAX' sin WEB a continuación no cuenta",
    isPlatformRelease({ releaseName: "Movie.2020.MAX.Quality.srt" }) === false);
  // C. Origen del vídeo, aparte de plataforma
  check("v1.4.20 origen: BluRay -> disco", releaseSourceOf({ releaseName: "A.2010.1080p.BluRay.x264" }) === "disco");
  check("v1.4.20 origen: UHD BDRip -> disco", releaseSourceOf({ releaseName: "A.2023.2160p.UHD.BDRip" }) === "disco");
  check("v1.4.20 origen: WEB-DL -> web", releaseSourceOf({ releaseName: "A.2010.1080p.WEB-DL" }) === "web");
  check("v1.4.20 origen: plataforma implica web", releaseSourceOf({ releaseName: "A.2010.1080p.NF" }) === "web");
  check("v1.4.20 origen: sin etiquetas -> ''", releaseSourceOf({ releaseName: "madmax_esp.srt" }) === "" && releaseSourceOf(null) === "");

  // D. Extremo a extremo: OS-V3 envía título en movieReleaseName y el release en subtitleFileName
  {
    const prevC = mockGlobal("caches", { default: { match: async () => undefined, put: async () => {} } });
    const prevF = globalThis.fetch;
    globalThis.fetch = (input) => {
      const u = String(input && input.url !== undefined ? input.url : input);
      if (u.includes("opensubtitles-v3.strem.io")) {
        return Promise.resolve(jsonR({ subtitles: [
          { id: "1", url: "https://subs5.strem.io/a.srt", lang: "spa", movieReleaseName: "Inception (2010)", subtitleFileName: "Inception.2010.1080p.AMZN.WEB-DL.DDP5.1.srt" },
          { id: "2", url: "https://subs5.strem.io/b.srt", lang: "spa", movieReleaseName: "Mad Max: Fury Road (2015)", subtitleFileName: "madmax_esp.srt" },
          { id: "3", url: "https://subs5.strem.io/c.srt", lang: "spa", movieReleaseName: "Inception (2010)", subtitleFileName: "x.srt", releaseFormat: "BluRay" },
        ] }));
      }
      return Promise.resolve(textResp(TXT_CAST + " " + u));
    };
    const lines = [];
    const origLog = console.log;
    console.log = (...a) => { lines.push(a.join(" ")); };
    try {
      const r = await worker.fetch(new Request(`${base}/subtitles/movie/tt7770001.json`), {}, { waitUntil: () => {} });
      await r.text();
    } finally {
      console.log = origLog;
      globalThis.fetch = prevF;
      restoreGlobal("caches", prevC);
    }
    const resumen = lines.find((l) => l.includes("resumen")) || "";
    check("v1.4.20 log: plataforma=1/3 (solo AMZN; 'Mad Max' y BluRay no cuentan)",
      resumen.includes("plataforma=1/3"), resumen.slice(0, 220));
    check("v1.4.20 log: web=1 disco=1", resumen.includes("web=1 disco=1"), resumen.slice(0, 220));
  }

  // E. Rama "sin resultados": clave falsa -> NO escribe la lista vacía en k_subdl
  {
    const store = new Map();
    const prevC = mockGlobal("caches", {
      default: {
        match: async (r) => { const v = store.get(r.url); return v ? v.clone() : undefined; },
        put: async (r, res) => { store.set(r.url, res.clone()); },
      },
    });
    const prevF = globalThis.fetch;
    globalThis.fetch = (input) => {
      const u = String(input && input.url !== undefined ? input.url : input);
      if (u.includes("opensubtitles-v3.strem.io")) return Promise.resolve(jsonR({ subtitles: [] }));
      if (u.includes("api.subdl.com")) {
        return Promise.resolve(u.includes("api_key=CLAVE_BUENA_123")
          ? jsonR({ status: true, subtitles: [{ url: "/subtitle/1-2.zip", file_id: 1 }] })
          : new Response("forbidden", { status: 403 }));
      }
      return Promise.resolve(textResp(TXT_CAST));
    };
    const origErr = console.error, origLog = console.log;
    let atacante, atacante2, legitimo, keysAfterFirst;
    console.error = () => {}; console.log = () => {};
    try {
      const get = async (key) => {
        const w = [];
        const r = await worker.fetch(
          new Request(`${base}/${b64url({ subdlKey: key })}/subtitles/movie/tt5550001.json`),
          {}, { waitUntil: (p) => w.push(p) });
        await Promise.all(w);
        return { hit: r.headers.get("x-cache"), n: (await r.json()).subtitles.length };
      };
      atacante = await get("CLAVE_FALSA_9999");
      keysAfterFirst = [...store.keys()];
      atacante2 = await get("CLAVE_FALSA_9999");
      legitimo = await get("CLAVE_BUENA_123");
    } finally {
      console.error = origErr; console.log = origLog;
      globalThis.fetch = prevF;
      restoreGlobal("caches", prevC);
    }
    check("v1.4.20 vacío: la clave falsa no escribe en k_subdl",
      !keysAfterFirst.some((k) => k.includes("/k_subdl/")), JSON.stringify(keysAfterFirst));
    check("v1.4.20 vacío: la clave falsa sí cachea en su namespace propio",
      keysAfterFirst.some((k) => /\/k_[0-9a-z]+\/subtitles\/movie\/tt5550001\.json$/.test(k) && !k.includes("/k_subdl/")));
    check("v1.4.20 vacío: la clave falsa repetida da HIT (sin recomputar)", atacante2.hit === "HIT" && atacante.n === 0);
    check("v1.4.20 vacío: el usuario legítimo NO recibe la lista vacía del atacante",
      legitimo.hit === "MISS" && legitimo.n === 1, JSON.stringify(legitimo));
  }
}

console.log(`\n${pass} ok, ${fail} fallos`);
if (fail) Deno.exit(1);
