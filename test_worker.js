// Pruebas del Worker HispaSubs (offline + una llamada de red opcional)
import worker from "./worker.js";

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
check("input con type=password", html.includes('type="password"'));
check("logo SVG inline", html.includes("<svg"));
check("selector de modo de idioma (langMode) presente",
  html.includes('id="langMode"') && html.includes('value="hybrid"'));

// 2) XSS reflejado: el payload debe aparecer escapado
const xssPayload = { subdlKey: '"><img src=x onerror=alert(1)>' };
res = await get(`/${b64url(xssPayload)}/configure`);
html = await res.text();
check("XSS escapado (sin <img crudo)", !html.includes("<img src=x"));
check("XSS escapado (entidades presentes)", html.includes("&lt;img") && html.includes("&quot;"));

// 2b) La config existente preselecciona el modo en la página de configure
res = await get(`/${b64url({ isoLang: true })}/configure`);
html = await res.text();
check("configure preselecciona ISO con config isoLang:true (alias retro)",
  html.includes('value="iso" selected'));
res = await get(`/${b64url({ langMode: "hybrid" })}/configure`);
html = await res.text();
check("configure preselecciona híbrido con langMode:'hybrid'",
  html.includes('value="hybrid" selected'));

// 3) El <script> de la pagina parsea sin errores (bug ///g de 1.0.0)
const scriptSrc = html.split("<script>")[1].split("</script>")[0];
let scriptOk = true, scriptErr = "";
try { new Function(scriptSrc); } catch (e) { scriptOk = false; scriptErr = e.message; }
check("script del navegador parsea (fix ///g)", scriptOk, scriptErr);

// ... y genera una URL de config correcta simulando el navegador
const fakeWin = { location: { host: "hispasubs.example.workers.dev" } };
const fakeDoc = (key, langMode) => ({
  getElementById: (id) =>
    id === "subdlKey" ? { value: key } : { value: langMode, checked: false },
});
const runClient = (key, langMode = "label") =>
  new Function("document", "window", "navigator", "btoa", "TextEncoder",
    scriptSrc + "; return getManifestUrl('https');")(
    fakeDoc(key, langMode), fakeWin, { clipboard: {} },
    (s) => btoa(s), TextEncoder
  );
const clientFn = runClient("");
check("URL del manifest sin clave es limpia",
  clientFn === "https://hispasubs.example.workers.dev/manifest.json", clientFn);
const clientFn2 = runClient("abc123");
check("URL del manifest con clave es base64url valido",
  /^https:\/\/hispasubs\.example\.workers\.dev\/[A-Za-z0-9_-]+\/manifest\.json$/.test(clientFn2), clientFn2);

// ...y con cada modo de idioma seleccionado (regresión móvil)
const decodeCfg = (url) => {
  let b64 = url.split("/")[3].replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
};
const isoCfg = decodeCfg(runClient("abc123", "iso"));
check("modo iso: config lleva langMode='iso' y la clave",
  isoCfg.langMode === "iso" && isoCfg.subdlKey === "abc123", JSON.stringify(isoCfg));
const hybCfg = decodeCfg(runClient("", "hybrid"));
check("modo híbrido sin clave genera config solo con langMode",
  hybCfg.langMode === "hybrid" && !("subdlKey" in hybCfg), JSON.stringify(hybCfg));
check("modo etiquetas (default) mantiene la URL limpia",
  runClient("abc123", "label") === clientFn2 && runClient("", "label") === clientFn,
  runClient("", "label"));

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

// 7) Logo
res = await get("/logo.svg");
check("logo.svg content-type correcto",
  (res.headers.get("content-type") || "").includes("image/svg+xml"));

// 8) End-to-end con red (best effort: si no hay red, el worker responde [])
res = await get("/subtitles/movie/tt0111161.json");
const subs = await res.json();
check("ruta subtitles responde JSON con array",
  Array.isArray(subs.subtitles), JSON.stringify(subs).slice(0, 120));
console.log(`  (subtitles obtenidas: ${subs.subtitles.length})`);
for (const s of subs.subtitles.slice(0, 6)) console.log(`   - ${s.lang}  [${(s.url || "").slice(0, 60)}...]`);

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

  check("SubDL zip relativa -> proxy y CLASIFICADA como Latino",
    zipEntry?.lang === "🇲🇽 Latino (SubDL)", JSON.stringify(zipEntry).slice(0, 160));
  check("SubDL url absoluta -> Castellano",
    srtEntry?.lang === "🇪🇸 Castellano (SubDL)", JSON.stringify(srtEntry).slice(0, 160));
  check("urls javascript/sin url descartadas", entries.length === 7, `entradas=${entries.length}`);
  check("OS-V3: sub no-española (cze) filtrada", osEntries.length === 5, `os=${osEntries.length}`);
  check("OS-V3: 3 analizadas -> Castellano",
    osEntries.filter((e) => e.lang === "🇪🇸 Castellano (OS-V3)").length === 3,
    JSON.stringify(osEntries.map((e) => e.lang)).slice(0, 200));
  check("OS-V3: fuera de presupuesto -> 'sin clasificar' (no 'Genérico')",
    osEntries.filter((e) => e.lang === "📄 Español (sin clasificar · OS-V3)").length === 2,
    JSON.stringify(osEntries.map((e) => e.lang)).slice(0, 200));

  // 9b) Modo móvil (isoLang): TODOS los lang deben ser el código ISO 639-2,
  // incluidos los clasificados y los "sin clasificar". Es la regresión del
  // bug móvil: con lang libre la app Android no mostraba ningún resultado.
  res = await get(`/${b64url({ subdlKey: "k", isoLang: true })}/subtitles/movie/tt1375666.json`);
  const jIso = await res.json();
  const isoEntries = jIso.subtitles || [];
  check("isoLang: mismas entradas que sin isoLang (7)", isoEntries.length === 7,
    `entradas=${isoEntries.length}`);
  check("isoLang: todos los lang son 'spa'",
    isoEntries.length > 0 && isoEntries.every((e) => e.lang === "spa"),
    JSON.stringify(isoEntries.map((e) => e.lang)).slice(0, 150));
  check("isoLang: urls siguen pasando por el proxy en zips",
    isoEntries.filter((e) => e.url.includes("proxy?zipUrl=")).length === 1,
    JSON.stringify(isoEntries.map((e) => e.url)).slice(0, 150));

  // 9c) Modo híbrido: prefijo ISO "spa" + etiqueta visible, para que el
  // escritorio conserve las banderas y el móvil reconozca el código.
  res = await get(`/${b64url({ subdlKey: "k", langMode: "hybrid" })}/subtitles/movie/tt1375666.json`);
  const jHyb = await res.json();
  const hybEntries = jHyb.subtitles || [];
  check("híbrido: mismas entradas (7)", hybEntries.length === 7, `entradas=${hybEntries.length}`);
  check("híbrido: todos los lang empiezan por 'spa ' y conservan la etiqueta",
    hybEntries.length > 0 &&
      hybEntries.every((e) => /^spa .+/.test(e.lang) && /(OS-V3|SubDL)\)/.test(e.lang)),
    JSON.stringify(hybEntries.map((e) => e.lang)).slice(0, 200));

  // ...y sin langMode, el modo por defecto sigue siendo la etiqueta libre
  res = await get(`/${b64url({ subdlKey: "k" })}/subtitles/movie/tt1375666.json`);
  const jLabel = await res.json();
  check("default: lang con etiqueta libre (sin prefijo ISO)",
    (jLabel.subtitles || []).length === 7 &&
      (jLabel.subtitles || []).every((e) => !e.lang.startsWith("spa ")),
    JSON.stringify((jLabel.subtitles || []).map((e) => e.lang)).slice(0, 150));
} finally {
  globalThis.fetch = origFetch;
}

console.log(`\n${pass} ok, ${fail} fallos`);
if (fail) Deno.exit(1);
