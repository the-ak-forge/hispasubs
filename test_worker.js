// Pruebas del Worker HispaSubs (offline + una llamada de red opcional)
import worker, { scoreText, subtitleCacheUrl } from "./worker.js";

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
// (d) etiquetas "sin clasificar" fuera de presupuesto.
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
  check("OS-V3: 3 analizadas -> label Castellano",
    osEntries.filter((e) => e.label === "🇪🇸 Castellano (OS-V3)").length === 3,
    JSON.stringify(osEntries.map((e) => e.label)).slice(0, 200));
  check("OS-V3: fuera de presupuesto -> label 'sin clasificar' (no 'Genérico')",
    osEntries.filter((e) => e.label === "📄 Español (sin clasificar · OS-V3)").length === 2,
    JSON.stringify(osEntries.map((e) => e.label)).slice(0, 200));

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
  const htmlEntry = e10.find((e) => e.url.includes("html.srt"));
  check("v1.3.1: HTML de error -> 'sin clasificar' (antes caía en Neutro)",
    htmlEntry?.label === "📄 Español (sin clasificar · OS-V3)", JSON.stringify(htmlEntry).slice(0, 160));
  const gibEntry = e10.find((e) => e.url.includes("gibberish.srt"));
  check("v1.3.1: 0 matches léxicos -> 'sin clasificar' (antes caía en Neutro)",
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
  check("manifest version 1.4.0", m10.version === "1.4.0", m10.version);

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

console.log(`\n${pass} ok, ${fail} fallos`);
if (fail) Deno.exit(1);
