// Pruebas del Worker HispaSubs (offline + una llamada de red opcional)
import worker, { scoreText, subtitleCacheUrl, OS_V3_TIMEOUT_MS, spamVerdict, ANALYSIS_BUDGET_PER_SOURCE, ANALYSIS_FETCH_PER_SOURCE, rateLimitFallback, RATE_MAP_CAP, readCapped, MAX_ANALYZE_BYTES } from "./worker.js";

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
        { url: "/subtitle/111-222.zip", release_name: "Rel.ZIP" },
        { url: "https://dl.subdl.com/subtitle/333-444.srt", release_name: "Rel.ABS" },
        { url: "javascript:alert(1)", release_name: "Maliciosa" },
        { release_name: "Sin url" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));
  }
  if (u.includes("proxy?zipUrl=")) return Promise.resolve(textResp(TXT_LAT));   // zip vía proxy
  if (u.includes("dl.subdl.com/subtitle/333-444.srt")) return Promise.resolve(textResp(TXT_CAST));
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
  if (u.includes("subs5.strem.io")) return Promise.resolve(textResp(TXT_CAST));
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

  check("SubDL zip relativa -> proxy, lang 'spa' y label Latino",
    zipEntry?.lang === "spa" && zipEntry?.label === "🇲🇽 Latino (SubDL)",
    JSON.stringify(zipEntry).slice(0, 160));

  // Lote 2: lista SIN fallos de clasificación -> TTL completo de 2 h.
  check("lista limpia (sin fallos) -> Cache-Control 7200",
    res.headers.get("cache-control") === "public, max-age=7200", res.headers.get("cache-control"));
  check("SubDL url absoluta -> lang 'spa' y label Castellano",
    srtEntry?.lang === "spa" && srtEntry?.label === "🇪🇸 Castellano (SubDL)",
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
    if (u.includes("eses.srt") || u.includes("ok.srt")) return Promise.resolve(textResp(TXT_CAST));
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
  check("manifest version 1.4.6", m10.version === "1.4.6", m10.version);

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
    if (/limpia\d\.srt/.test(u)) return Promise.resolve(textResp(TXT_CAST));
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
    if (u.includes("subs5.strem.io/ok")) return Promise.resolve(textResp(TXT_CAST));
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
      return Promise.resolve(textResp(TXT_CAST));
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

console.log(`\n${pass} ok, ${fail} fallos`);
if (fail) Deno.exit(1);
