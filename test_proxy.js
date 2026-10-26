// ============================================================================
// test_proxy.js — tests del proxy de Vercel (api/proxy.js)
//
// Sin red: dns.lookup y el fetch global se sustituyen por stubs, así que la
// suite es determinista y corre igual en local que en CI.
//   node test_proxy.js
// ============================================================================

import AdmZip from "adm-zip";
import dns from "node:dns/promises";
import handler, { ALLOWED_HOSTS, MAX_BYTES, isPublicIP, readCapped, rateLimit, RATE_MAP_CAP } from "./api/proxy.js";

let pass = 0;
let fail = 0;

const section = (title) => console.log(`\n== ${title}`);
const check = (name, cond, extra = "") => {
  if (cond) {
    pass += 1;
    console.log(`  ✔ ${name}`);
  } else {
    fail += 1;
    console.error(`  ✘ ${name}${extra ? ` -> ${extra}` : ""}`);
  }
};

// ---------------------------------------------------------------------------
// Stubs: DNS y fetch (el handler importa "node:dns/promises" como default,
// que es el objeto mutable del módulo builtin: se puede sustituir su lookup)
// ---------------------------------------------------------------------------
const dnsTable = new Map();
dns.lookup = async (hostname) => {
  const addrs = dnsTable.get(hostname);
  if (!addrs) {
    throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
  }
  return addrs.map((a) => ({ address: a, family: a.includes(":") ? 6 : 4 }));
};

dnsTable.set("dl.subdl.com", ["104.20.1.1"]);

let fetchLog = [];
let fetchImpl = () => {
  throw new Error("fetchImpl no preparado para esta prueba");
};
globalThis.fetch = async (url, init) => {
  fetchLog.push({ url: String(url), init });
  return fetchImpl(url, init);
};

// ---------------------------------------------------------------------------
// Mocks de req/res estilo Vercel
// ---------------------------------------------------------------------------
const mkRes = () => ({
  headers: {},
  statusCode: 200,
  body: undefined,
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
  status(c) { this.statusCode = c; return this; },
  json(o) { this.body = JSON.stringify(o); return this; },
  send(d) { this.body = d; return this; },
  end() { return this; },
});

const call = async (url, { ip = "203.0.113.7", headers = {} } = {}) => {
  const req = {
    url,
    method: "GET",
    headers: {
      "user-agent": "test",
      ...(ip ? { "x-real-ip": ip } : {}),
      ...headers,
    },
    query: Object.fromEntries(new URL(url, "http://local").searchParams),
  };
  const res = mkRes();
  await handler(req, res);
  return res;
};

const bodyJson = (res) => {
  try { return JSON.parse(String(res.body)); } catch { return null; }
};

const buildZip = (files) => {
  const zip = new AdmZip();
  for (const [name, content] of files) zip.addFile(name, Buffer.from(content));
  return zip.toBuffer();
};

const okZip = buildZip([["pista.srt", "1\n00:00:01,000 --> 00:00:02,000\nhola\n"], ["nota.txt", "x"]]);

// ===========================================================================
// 1. isPublicIP (SSRF: la lista blanca es el control principal, esto es la
//    defensa en profundidad para IPs literales y para hosts que resuelvan
//    a rangos privados)
// ===========================================================================
section("1. isPublicIP: rangos privados bloqueados");
for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.5.5", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "192.0.0.1", "198.18.0.1", "224.0.0.1", "240.0.0.1", "255.255.255.255"]) {
  check(`IPv4 ${ip} es privada`, isPublicIP(ip) === false);
}
check("IPv4 8.8.8.8 es pública", isPublicIP("8.8.8.8") === true);
check("IPv4 172.32.5.5 es pública (fuera de 172.16/12)", isPublicIP("172.32.5.5") === true);
check("IPv4 100.128.0.1 es pública (fuera de CGNAT 100.64/10)", isPublicIP("100.128.0.1") === true);
for (const ip of ["::1", "::", "fe80::1", "fec0::1", "fc00::1", "fd12::1", "ff02::1", "2001::1", "::ffff:127.0.0.1", "::10.0.0.1", "::ffff:7f00:1", "::ffff:a00:1", "::ffff:c0a8:101", "64:ff9b::10.0.0.1", "2002:7f00:1::", "2001:db8::1", "0:0:0:0:0:0:0:1", "0:0:0:0:0:0:7f00:1", "0:0:0:0:0:0:127.0.0.1", "0:0:0:0:0:0:10.0.0.1", "0:0:0:0:0:ffff:7f00:1", "::ffff:0:7f00:1"]) {
  check(`IPv6 ${ip} es privada`, isPublicIP(ip) === false);
}
check("IPv6 2001:4860:4860::8888 es pública", isPublicIP("2001:4860:4860::8888") === true);
check("IPv6 ::ffff:8.8.8.8 (mapped) es pública", isPublicIP("::ffff:8.8.8.8") === true);
check("IPv6 ::ffff:808:808 (mapped hex 8.8.8.8) es pública", isPublicIP("::ffff:808:808") === true);
check("IPv6 0:0:0:0:0:ffff:808:808 (expanded hex 8.8.8.8) es pública", isPublicIP("0:0:0:0:0:ffff:808:808") === true);

// ===========================================================================
// 2. Rutas y errores de usuario
// ===========================================================================
section("2. Rutas: raíz amigable y errores de usuario");
{
  const res = await call("/");
  check("GET / devuelve 200 autoexplicativo", res.statusCode === 200 && bodyJson(res)?.service === "HispaSubs Proxy");
  check("GET / expone el uso", String(bodyJson(res)?.usage || "").includes("/proxy?zipUrl="));
}
{
  // Con los rewrites de vercel.json, la función puede ver su propio path.
  const res = await call("/api/proxy");
  check("GET /api/proxy sin zipUrl responde como la raíz", res.statusCode === 200 && bodyJson(res)?.service === "HispaSubs Proxy");
}
{
  const res = await call("/proxy");
  check("GET /proxy sin zipUrl -> 400", res.statusCode === 400 && bodyJson(res)?.error === "Falta zipUrl");
}
{
  const res = await call("/zzz");
  check("GET /zzz sin zipUrl -> 400", res.statusCode === 400 && bodyJson(res)?.error === "Falta zipUrl");
}
{
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("esto-no-es-una-url"));
  check("zipUrl ilegible -> 400", res.statusCode === 400 && bodyJson(res)?.error === "URL inválida");
}
{
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("http://dl.subdl.com/x.zip"));
  check("http:// -> 400 (solo https)", res.statusCode === 400 && bodyJson(res)?.error === "Solo se permite https");
}
{
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://subdl.com/x.zip"));
  check("host fuera de allowlist -> 403", res.statusCode === 403 && bodyJson(res)?.error === "Host no permitido");
}

// ===========================================================================
// 3. Allowlist, puertos y SSRF
// ===========================================================================
section("3. Allowlist, puertos y red privada");
fetchImpl = () => new Response(null, { status: 500 });
{
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com:8443/x.zip"));
  check("puerto 8443 rechazado (antes conectaba igual)", res.statusCode === 403 && bodyJson(res)?.error === "Puerto no permitido", JSON.stringify(bodyJson(res)));
}
{
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com:4443/x.zip"));
  check("puerto 4443 rechazado", res.statusCode === 403 && bodyJson(res)?.error === "Puerto no permitido");
}
{
  fetchLog = [];
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com:443/x.zip"));
  check("puerto 443 explícito permitido (llega a fetch)", res.statusCode === 502 && fetchLog.length === 1, JSON.stringify(bodyJson(res)));
}
{
  // Un host permitido que resuelva a una IP privada: SSRF vía DNS (host
  // interno registrado en la allowlist por error).
  dnsTable.set("dl.subdl.com", ["10.0.0.5"]);
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/x.zip"));
  dnsTable.set("dl.subdl.com", ["104.20.1.1"]);
  check("host allowlist que resuelve a IP privada -> 403", res.statusCode === 403 && /privada/.test(String(bodyJson(res)?.error)), JSON.stringify(bodyJson(res)));
}
{
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://127.0.0.1/x.zip"));
  check("IP literal loopback -> 403", res.statusCode === 403);
}

// ===========================================================================
// 4. Redirecciones: cada salto se valida (regresión del bypass de 1.0.2)
// ===========================================================================
section("4. Redirecciones validadas salto a salto");
{
  fetchLog = [];
  let calls = 0;
  fetchImpl = () => {
    calls += 1;
    if (calls === 1) return new Response(null, { status: 302, headers: { location: "https://dl.subdl.com/bueno.zip" } });
    return new Response(null, { status: 302, headers: { location: "https://evil.com/malo.zip" } });
  };
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/original.zip"));
  check("salto a host no permitido -> 403", res.statusCode === 403 && bodyJson(res)?.error === "Redirección a host no permitido", JSON.stringify(bodyJson(res)));
  check("no se sigue la redirección hostila", calls === 2, `fetch llamado ${calls} veces`);
  check("todos los fetch usan redirect:manual", fetchLog.length === 2 && fetchLog.every((c) => c.init?.redirect === "manual"));
}
{
  fetchImpl = () => new Response(null, { status: 302, headers: { location: "https://dl.subdl.com:8443/x.zip" } });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/x.zip"));
  check("salto a puerto no permitido -> 403", res.statusCode === 403 && bodyJson(res)?.error === "Redirección a puerto no permitido", JSON.stringify(bodyJson(res)));
}
{
  fetchImpl = () => new Response(null, { status: 302, headers: { location: "http://dl.subdl.com/x.zip" } });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/x.zip"));
  check("salto a http:// -> 403 (mensaje de redirección)", res.statusCode === 403 && bodyJson(res)?.error === "Redirección a esquema no permitido", JSON.stringify(bodyJson(res)));
}
{
  let calls = 0;
  fetchImpl = () => {
    calls += 1;
    if (calls === 1) return new Response(null, { status: 302, headers: { location: "https://dl.subdl.com/b.zip" } });
    return new Response(okZip, { status: 200 });
  };
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/a.zip"));
  check("cadena válida de 1 salto -> 200", res.statusCode === 200 && Buffer.isBuffer(res.body));
}
{
  fetchImpl = () => new Response(null, { status: 302, headers: { location: "https://dl.subdl.com/b.zip" } });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/a.zip"));
  check("redirecciones infinitas -> 403 tras el tope", res.statusCode === 403 && bodyJson(res)?.error === "Demasiadas redirecciones", JSON.stringify(bodyJson(res)));
}

// ===========================================================================
// 5. Extracción del zip
// ===========================================================================
section("5. Extracción del zip");
{
  fetchImpl = () => new Response(okZip, { status: 200 });
  fetchLog = [];
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check("zip con .srt -> 200", res.statusCode === 200);
  check("devuelve el contenido del .srt", String(res.body).includes("hola"));
  check("content-type text/plain", res.headers["content-type"] === "text/plain; charset=utf-8");
  check("content-disposition con el nombre", String(res.headers["content-disposition"]).includes('filename="pista.srt"'));
  check("cache-control 86400 + s-maxage (Edge de Vercel)",
    res.headers["cache-control"] === "public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600",
    res.headers["cache-control"]);
}
{
  // v1.4.5 H-01: Pack de temporada con varios episodios -> con &s=&e= elige el
  // episodio pedido aunque otro episodio sea mucho más grande; y no confunde
  // S01E03 con S01E30.
  const seasonPack = buildZip([
    ["Show.S01E30.Finale.srt", "f".repeat(9000)],
    ["Show.S01E03.Episode.srt", "episodio tres correcto\n"],
    ["Show.S01E10.Big.srt", "b".repeat(8000)],
  ]);
  fetchImpl = () => new Response(seasonPack, { status: 200 });
  const resEp = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/pack.zip") + "&s=1&e=3");
  check("v1.4.5 H-01: con &s=1&e=3 elige S01E03 (no S01E30 ni el más grande)",
    resEp.statusCode === 200 && String(resEp.body).includes("episodio tres correcto"),
    String(resEp.body).slice(0, 80));

  const pack1x = buildZip([
    ["Show.1x12.srt", "x".repeat(5000)],
    ["Show.1x02.srt", "formato 1x02 correcto\n"],
  ]);
  fetchImpl = () => new Response(pack1x, { status: 200 });
  const res1x = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/pack2.zip") + "&s=1&e=2");
  check("v1.4.5 H-01: soporta nomenclatura 1x02",
    res1x.statusCode === 200 && String(res1x.body).includes("formato 1x02 correcto"),
    String(res1x.body).slice(0, 80));

  // v1.4.6 / v1.4.8: Si el pack tiene otros episodios explícitos (S01E03, S01E10,
  // S01E30) y se pide &s=1&e=99 (que NO está en el zip), devuelve 422 en vez
  // de servir el episodio equivocado más grande (y distinto de un 404 de ruta).
  fetchImpl = () => new Response(seasonPack, { status: 200 });
  const resMissingEp = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/pack.zip") + "&s=1&e=99");
  check("v1.4.8: pack con otros episodios pero sin el pedido (&s=1&e=99) -> 422 (no sirve otro cap)",
    resMissingEp.statusCode === 422, `status=${resMissingEp.statusCode}`);

  // Pero si el zip trae archivos con nombres neutros (sin token SxxExx/1x02),
  // sigue sirviendo el .srt más grande como fallback legítimo.
  const neutralZip = buildZip([["subtitulo_es.srt", "neutro valido\n"]]);
  fetchImpl = () => new Response(neutralZip, { status: 200 });
  const resNeutral = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/neutral.zip") + "&s=1&e=99");
  check("v1.4.6: zip con nombre neutro sin SxxExx sigue sirviendo el .srt con &s/&e",
    resNeutral.statusCode === 200 && String(resNeutral.body).includes("neutro valido"));

  // Y soporta nombres con solo episodio (Show - E03.srt / Ep 03 / Cap 03).
  const epOnlyPack = buildZip([
    ["Anime - E12.srt", "x".repeat(4000)],
    ["Anime - Ep 03.srt", "anime episodio 3 ok\n"],
  ]);
  fetchImpl = () => new Response(epOnlyPack, { status: 200 });
  const resEpOnly = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/anime.zip") + "&s=1&e=3");
  check("v1.4.6: soporta nombres 'Ep 03' / 'E03' sin temporada",
    resEpOnly.statusCode === 200 && String(resEpOnly.body).includes("anime episodio 3 ok"));

  // v1.4.7 / v1.4.8: Nombres multiepisodio (S01E03E04 / S01E03-E04 / S01E03-04 / S01E03+E04)
  const multiEpPack = buildZip([
    ["Show.S01E01.srt", "ep 1\n"],
    ["Show.S01E03E04.srt", "doble episodio 3 y 4 ok\n"],
    ["Show.S01E05-E06.srt", "doble episodio 5 y 6 ConGuion ok\n"],
    ["Show.S01E07-08.srt", "doble episodio 7 y 8 SinE ok\n"],
    ["Show.S01E09+E10.srt", "doble episodio 9 y 10 ConMas ok\n"],
  ]);
  fetchImpl = () => new Response(multiEpPack, { status: 200 });
  const resMulti3 = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/multi.zip") + "&s=1&e=3");
  const resMulti4 = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/multi.zip") + "&s=1&e=4");
  const resMulti6 = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/multi.zip") + "&s=1&e=6");
  const resMulti8 = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/multi.zip") + "&s=1&e=8");
  const resMulti10 = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/multi.zip") + "&s=1&e=10");
  check("v1.4.7: S01E03E04 casa al pedir e=3",
    resMulti3.statusCode === 200 && String(resMulti3.body).includes("doble episodio 3 y 4 ok"));
  check("v1.4.7: S01E03E04 casa también al pedir e=4 (segundo episodio del par)",
    resMulti4.statusCode === 200 && String(resMulti4.body).includes("doble episodio 3 y 4 ok"));
  check("v1.4.7: S01E05-E06 casa al pedir e=6",
    resMulti6.statusCode === 200 && String(resMulti6.body).includes("doble episodio 5 y 6 ConGuion ok"));
  check("v1.4.8: S01E07-08 (sin segunda E) casa al pedir e=8",
    resMulti8.statusCode === 200 && String(resMulti8.body).includes("doble episodio 7 y 8 SinE ok"));
  check("v1.4.8: S01E09+E10 (con '+') casa al pedir e=10",
    resMulti10.statusCode === 200 && String(resMulti10.body).includes("doble episodio 9 y 10 ConMas ok"));

  // Anti-ReDoS: nombre con 100 dígitos tras S01E01- tarda <50 ms (matcher lineal O(n)).
  const hostileZip = buildZip([[`Show.S01E01-${"1234567890".repeat(10)}.srt`, "hostil\n"]]);
  fetchImpl = () => new Response(hostileZip, { status: 200 });
  const tHostile = Date.now();
  const resHostile = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/h.zip") + "&s=1&e=99");
  const dtHostile = Date.now() - tHostile;
  check("v1.4.8 Anti-ReDoS: matcher multiepisodio lineal (<50 ms con 100 dígitos)",
    resHostile.statusCode === 422 && dtHostile < 50, `dt=${dtHostile}ms status=${resHostile.statusCode}`);

  // v1.4.9 Anti-ReDoS con 65.000 ceros seguidos ('s' + 65k ceros): antes 0*(\d+)
  // en SE_HEAD era cuadrático O(n²) y tardaba ~16 s; ahora sin 0* tarda <200 ms.
  const zerosZip = buildZip([[`s${"0".repeat(65000)}.srt`, "ceros\n"], ["Show.S01E01.srt", "normal\n"]]);
  fetchImpl = () => new Response(zerosZip, { status: 200 });
  const tZeros = Date.now();
  const resZeros = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/z.zip") + "&s=1&e=1");
  const dtZeros = Date.now() - tZeros;
  check("v1.4.9 Anti-ReDoS: nombre con 65.000 ceros tarda <200 ms (sin O(n²) en SE_HEAD)",
    resZeros.statusCode === 200 && String(resZeros.body).includes("normal") && dtZeros < 200,
    `dt=${dtZeros}ms status=${resZeros.statusCode}`);

  // v1.4.12: nombres de más de 512 caracteres se ignoran (frontera: 512 sí, 513 no).
  const edgeZip = buildZip([
    [`Show.S01E03${"x".repeat(512 - 15)}.srt`, "limite512\n"], // 512 exactos
    [`Show.S01E03${"y".repeat(513 - 15)}.srt`, "limite513\n"], // 513
  ]);
  fetchImpl = () => new Response(edgeZip, { status: 200 });
  const resEdge = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/e.zip") + "&s=1&e=3");
  check("v1.4.12: nombre de 512 car. se sirve y el de 513 se ignora",
    resEdge.statusCode === 200 && String(resEdge.body).includes("limite512") && !String(resEdge.body).includes("limite513"),
    `status=${resEdge.statusCode}`);

  // v1.4.10: cadena "1x1x1x…" de 65.000 caracteres. Cada cabecera NxM re-recorría
  // toda la cadena EP_NEXT hasta el final (O(n²), ~25 s por nombre); con el tope
  // de 8 episodios encadenados por cabecera es lineal.
  const chainZip = buildZip([[`1${"x1".repeat(32490)}.srt`, "cadena\n"]]);
  fetchImpl = () => new Response(chainZip, { status: 200 });
  const tChain = Date.now();
  const resChain = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/y.zip") + "&s=1&e=3");
  const dtChain = Date.now() - tChain;
  check("v1.4.10 Anti-ReDoS: nombre «1x1x1x…» de 65.000 car. tarda <200 ms",
    dtChain < 200, `dt=${dtChain}ms status=${resChain.statusCode}`);

  // v1.4.9: EP_NEXT (\d{1,2}) no confunde códecs/resoluciones (.x264, -720p) con episodios >=100.
  const codecZip = buildZip([
    ["Show.S01E03.x264.srt", "ep 3 x264\n"],
    ["Show.S01E04-720p.srt", "ep 4 720p\n"],
  ]);
  fetchImpl = () => new Response(codecZip, { status: 200 });
  const resCodec264 = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/c.zip") + "&s=1&e=264");
  const resCodec720 = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/c.zip") + "&s=1&e=720");
  check("v1.4.9: S01E03.x264 y S01E04-720p NO casan al pedir e=264 ni e=720 (-> 422)",
    resCodec264.statusCode === 422 && resCodec720.statusCode === 422,
    `264=${resCodec264.statusCode} 720=${resCodec720.statusCode}`);
}
{
  const zip = buildZip([["a.vtt", "WEBVTT\n"], ["b.srt", "1\n00:00:01,000 --> 00:00:02,000\nx\n"], ["c_small.srt", "peque\n"], ["d_big.srt", "g".repeat(5000)]]);
  fetchImpl = () => new Response(zip, { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check("prefiere .srt sobre .vtt y el más grande", res.statusCode === 200 && String(res.body).startsWith("g"));
}
{
  const zip = buildZip([["pistä ño.srt", "contenido\n"]]);
  fetchImpl = () => new Response(zip, { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  const cd = String(res.headers["content-disposition"] || "");
  check("nombre no-ASCII: cabecera 100% ASCII (sin CR/LF)", /^[\x20-\x7e]+$/.test(cd) && cd.includes("filename*=UTF-8''"), cd);
  check("nombre no-ASCII: fallback ASCII legible", cd.includes('filename="pist_ _o.srt"'), cd);
}
{
  const zip = buildZip([['pista con "comillas".srt', "contenido\n"]]);
  fetchImpl = () => new Response(zip, { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  const cd = String(res.headers["content-disposition"] || "");
  check("comillas en el nombre sanitizadas", /^[\x20-\x7e]+$/.test(cd) && !cd.includes('comillas"'), cd);
}
{
  const zip = buildZip([["leeme.txt", "no soy un subtitulo"], ["nota.md", "tampoco"]]);
  fetchImpl = () => new Response(zip, { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check("zip sin subtítulos -> 422", res.statusCode === 422);
}
{
  // Stremio no descomprime .rar: el proxy tampoco debe devolverlos.
  const zip = buildZip([["pelicula.rar", "Rar!\x1a"], ["pista.srt", "1\n00:00:01,000 --> 00:00:02,000\nx\n"]]);
  fetchImpl = () => new Response(zip, { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check(".rar ignorado: se sirve el .srt", res.statusCode === 200 && String(res.body).includes("00:00:01"));
}
{
  const zip = buildZip([["solo.rar", "Rar!\x1a"]]);
  fetchImpl = () => new Response(zip, { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check("zip solo con .rar -> 422", res.statusCode === 422);
}
{
  // Declarado > MAX_BYTES: se descarta ANTES de descomprimirlo.
  const zip = buildZip([["gigante.srt", "a".repeat(MAX_BYTES + 1024)]]);
  fetchImpl = () => new Response(zip, { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check("entrada declarada > MAX_BYTES -> 422 (no se descomprime)", res.statusCode === 422);
}
{
  fetchImpl = () => new Response(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x62, 0x61, 0x73, 0x75]), { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check("zip corrupto -> 415", res.statusCode === 415);
}
{
  fetchImpl = () => new Response(Buffer.from("<html><body>404</body></html>"), { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check("respuesta que no es zip -> 415", res.statusCode === 415);
}
{
  fetchImpl = () => new Response(Buffer.alloc(MAX_BYTES + 1), { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check(`respuesta > ${MAX_BYTES / 1024 / 1024} MB -> 413`, res.statusCode === 413);
}
{
  fetchImpl = () => new Response("boom", { status: 500 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check("origen con error 500 -> 502", res.statusCode === 502 && bodyJson(res)?.error === "Origen respondió 500");
}
{
  fetchImpl = () => new Response("dead", { status: 404 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check("v1.4.8: origen con 404 (zip muerto en SubDL) -> 410 Gone",
    res.statusCode === 410 && bodyJson(res)?.error === "Origen respondió 404");
}

// ===========================================================================
// 5b. Lote 4: timeout que cubre el CUERPO y .sub binario (VobSub)
// ===========================================================================
section("5b. Lote 4: timeout del cuerpo y .sub binario");
{
  // La descarga de las cabeceras acaba, pero el cuerpo nunca termina (origen
  // que se corta a mitad). Antes el timer se limpiaba tras las cabeceras y
  // la función se colgaba; ahora debe volver 504 en ~timeoutMs.
  process.env.FETCH_TIMEOUT_MS = "80";
  try {
    fetchImpl = (url, init) => {
      const stream = new ReadableStream({
        start(c) {
          // Respeta la señal de aborto como haría fetch real.
          if (init && init.signal) {
            init.signal.addEventListener("abort", () =>
              c.error(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })));
          }
          // ...pero nunca cierra solo: simula una descarga colgada.
        },
      });
      return new Response(stream, { status: 200 });
    };
    const t0 = Date.now();
    const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
    const elapsed = Date.now() - t0;
    check("cuerpo colgado -> 504 Timeout", res.statusCode === 504 && bodyJson(res)?.error === "Timeout",
      `${res.statusCode} ${String(res.body).slice(0, 100)}`);
    check("el timeout cubre la lectura del cuerpo (<2s)", elapsed < 2000, `${elapsed}ms`);
  } finally {
    delete process.env.FETCH_TIMEOUT_MS;
  }
}
{
  // VobSub: .sub binario (muestreo de vídeo) servido antes como text/plain.
  const vobsub = Buffer.from([0x00, 0x1a, 0x00, 0x00, 0x00, 0x01, 0xba, 0x44, 0x00, 0xff]);
  const zip = buildZip([["vobsub.sub", vobsub]]);
  fetchImpl = () => new Response(zip, { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check("zip solo con .sub binario (VobSub) -> 422", res.statusCode === 422, `${res.statusCode}`);
}
{
  // Un .sub de texto (SubViewer: sin bytes NUL) sí es servible.
  const zip = buildZip([["subtexto.sub", "[INFORMATION]\n1\n[/INFORMATION]\n[SUBTITLE]\n00:01:00,000,000 --> 00:01:02,000,000\nhola\n"]]);
  fetchImpl = () => new Response(zip, { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check(".sub de texto (SubViewer) -> 200", res.statusCode === 200 && String(res.body).includes("hola"),
    `${res.statusCode}`);
}
{
  // El elegido (el más grande) es binario -> se descarta y se prueba el
  // siguiente candidato en vez de devolver basura.
  const vobsubGrande = Buffer.concat([Buffer.from([0x00, 0x1a]), Buffer.alloc(4000, 0x41)]);
  const zip = buildZip([["grande.sub", vobsubGrande], ["chico.sub", "texto valido\n"]]);
  fetchImpl = () => new Response(zip, { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check(".sub binario elegido -> se sirve el siguiente candidato de texto",
    res.statusCode === 200 && String(res.body).includes("texto valido"), `${res.statusCode}`);
}

// ===========================================================================
// 5c. Auditoría v1.4.1: streaming acotado (anti-OOM), .sub UTF-16 y zipUrl Array
// ===========================================================================
section("5c. v1.4.1: readCapped, .sub UTF-16 y zipUrl duplicado");
{
  // readCapped directamente: corta el stream al tope y devuelve null si el
  // origen seguía mandando datos (para que el caller responda 413, no un
  // "zip corrupto" por truncado).
  const body = new ReadableStream({
    start(c) {
      for (let i = 0; i < 8; i++) c.enqueue(new Uint8Array(1024).fill(0x41));
      c.close();
    },
  });
  const res = await readCapped(new Response(body), 4096);
  check("readCapped corta al tope y devuelve null (exceso)", res === null);

  const body2 = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array([1, 2, 3]));
      c.close();
    },
  });
  const res2 = await readCapped(new Response(body2), 4096);
  check("readCapped devuelve el buffer si cabe", Buffer.isBuffer(res2) && res2.length === 3);

  // El tope exacto NO es exceso.
  const body3 = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(1024));
      c.close();
    },
  });
  const res3 = await readCapped(new Response(body3), 1024);
  check("readCapped: tamaño exacto al tope no es exceso", Buffer.isBuffer(res3) && res3.length === 1024);
}
{
  // Zip legítimo que el origen envía por streaming en trozos (sin
  // content-length): debe reensamblarse y procesarse igual.
  const zip = buildZip([["pista.srt", "1\n00:00:01,000 --> 00:00:02,000\nstreaming ok\n"]]);
  const body = new ReadableStream({
    start(c) {
      for (let i = 0; i < zip.length; i += 512) c.enqueue(new Uint8Array(zip.subarray(i, i + 512)));
      c.close();
    },
  });
  fetchImpl = () => new Response(body, { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check("zip por streaming en trozos -> 200", res.statusCode === 200 && String(res.body).includes("streaming ok"),
    `${res.statusCode}`);
}
{
  // Origen malicioso que OMITE content-length y supera MAX_BYTES: readCapped
  // corta y devuelve 413.
  const chunksNeeded = Math.ceil(MAX_BYTES / (1024 * 1024)) + 1;
  const body = new ReadableStream({
    start(c) {
      const chunk = new Uint8Array(1024 * 1024).fill(0x50);
      for (let i = 0; i < chunksNeeded; i++) c.enqueue(chunk);
      c.close();
    },
  });
  fetchImpl = () => new Response(body, { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check(`sin content-length y >${MAX_BYTES / 1024 / 1024} MB por streaming -> 413`, res.statusCode === 413,
    `${res.statusCode} ${String(res.body).slice(0, 80)}`);
}
{
  // .sub UTF-16LE con BOM: bytes NUL alternos pero es TEXTO. Antes se
  // descartaba como VobSub; ahora se sirve.
  const utf16 = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from("1\n00:00:01,000 --> 00:00:02,000\nhola utf16\n", "utf16le"),
  ]);
  const zip = buildZip([["sub16.sub", utf16]]);
  fetchImpl = () => new Response(zip, { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check(".sub UTF-16LE con BOM -> 200 (no se trata como VobSub)", res.statusCode === 200,
    `${res.statusCode}`);
}
{
  // Un VobSub real (sin BOM UTF-16) sigue descartándose.
  const vobsub = Buffer.from([0x00, 0x1a, 0x00, 0x00, 0x00, 0x01, 0xba, 0x44, 0x00, 0xff]);
  const zip = buildZip([["vobsub.sub", vobsub]]);
  fetchImpl = () => new Response(zip, { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip"));
  check("VobSub sin BOM UTF-16 sigue descartado -> 422", res.statusCode === 422, `${res.statusCode}`);
}
{
  // zipUrl duplicado en la query -> req.query.zipUrl es un Array. Sin la
  // normalización, new URL() lo stringificaba a "url1,url2" (URL sucia); el
  // handler no debe romperse: usa el primer valor y la allowlist manda.
  fetchImpl = () => new Response(okZip, { status: 200 });
  const req = {
    url: "/proxy?zipUrl=a&zipUrl=b",
    method: "GET",
    headers: { "user-agent": "test", "x-real-ip": "203.0.113.90" },
    query: { zipUrl: ["https://dl.subdl.com/a.zip", "https://ejemplo.com/b.zip"] },
  };
  const res = mkRes();
  await handler(req, res);
  check("zipUrl Array no rompe: procesa el primer valor -> 200",
    res.statusCode === 200 && String(res.body).includes("00:00:01"), `${res.statusCode}`);
  check("el fetch va al host del primer valor (allowlist)", String(fetchLog.at(-1)?.url || "").includes("dl.subdl.com"),
    String(fetchLog.at(-1)?.url));
}
{
  // v1.4.11: target sanitiza api_key antes de fetch (evita 429 de SubDL y fugas en logs)
  fetchLog.length = 0;
  const zip = buildZip([["sub.srt", "1\n00:00:01,000 --> 00:00:02,000\nok\n"]]);
  fetchImpl = () => new Response(zip, { status: 200 });
  const res = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip?api_key=mySecretKey"));
  const lastFetch = fetchLog.at(-1)?.url || "";
  check("v1.4.11: el proxy elimina api_key de la URL antes de llamar al origen",
    res.statusCode === 200 && !lastFetch.includes("api_key") && lastFetch === "https://dl.subdl.com/sub.zip",
    `status=${res.statusCode} url=${lastFetch}`);

  // v1.4.12: en dl.subdl.com se descarta toda la consulta (cualquier nombre de parámetro).
  fetchLog.length = 0;
  const resQ = await call("/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip?API_KEY=mySecretKey&token=x&foo=1"));
  const lastQ = fetchLog.at(-1)?.url || "";
  check("v1.4.12: el proxy deja dl.subdl.com sin consulta (API_KEY/token/foo fuera)",
    resQ.statusCode === 200 && lastQ === "https://dl.subdl.com/sub.zip", `status=${resQ.statusCode} url=${lastQ}`);
}
section("6. Rate limit por IP");
process.env.RATE_LIMIT_PER_MIN = "3";
{
  fetchImpl = () => new Response("boom", { status: 500 });
  const url = "/proxy?zipUrl=" + encodeURIComponent("https://dl.subdl.com/sub.zip");
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await call(url, { ip: "198.51.100.77" })).statusCode);
  check("3 peticiones pasan y la 4ª da 429", JSON.stringify(codes) === JSON.stringify([502, 502, 502, 429]), JSON.stringify(codes));
  const res = await call(url, { ip: "198.51.100.77" });
  check("429 incluye Retry-After", res.statusCode === 429 && Number(res.headers["retry-after"]) >= 1, JSON.stringify(res.headers));
  // La raíz (health check) no consume cuota.
  for (let i = 0; i < 3; i++) await call("/", { ip: "198.51.100.88" });
  const res2 = await call(url, { ip: "198.51.100.88" });
  check("GET / no cuenta para el límite", res2.statusCode === 502, JSON.stringify(bodyJson(res2)));
  // x-forwarded-for (sin x-real-ip): se usa el primer salto.
  const fwd = { ip: null, headers: { "x-forwarded-for": "198.51.100.99, 10.0.0.1" } };
  const codes2 = [];
  for (let i = 0; i < 4; i++) codes2.push((await call(url, fwd)).statusCode);
  check("usa el primer salto de x-forwarded-for", JSON.stringify(codes2) === JSON.stringify([502, 502, 502, 429]), JSON.stringify(codes2));
  // Desactivado con 0.
  process.env.RATE_LIMIT_PER_MIN = "0";
  let ok = true;
  for (let i = 0; i < 6; i++) {
    if ((await call(url, { ip: "198.51.100.100" })).statusCode === 429) ok = false;
  }
  check("RATE_LIMIT_PER_MIN=0 desactiva el límite", ok);
  delete process.env.RATE_LIMIT_PER_MIN;
}

// ===========================================================================
// 6b. v1.4.4: tope duro del Map del rate limiter (auditoría externa de 1.4.3)
// ===========================================================================
section("6b. tope del Map del rate limiter (v1.4.4)");
{
  const now = Date.now();
  const mk = (n, reset, prefix = "198.51.100.") => {
    const m = new Map();
    for (let i = 0; i < n; i++) m.set(`${prefix}${i}`, { count: 1, reset });
    return m;
  };
  delete process.env.RATE_LIMIT_PER_MIN; // límite por defecto: 120/min

  const m = mk(RATE_MAP_CAP + 1, now + 60_000);
  const r = rateLimit("203.0.113.7", m);
  check("el Map queda en el tope tras una IP nueva (antes crecía sin límite)",
    m.size === RATE_MAP_CAP && r === null, `size=${m.size}`);
  check("se expulsa de la cabeza (el Map conserva el orden de inserción)",
    !m.has("198.51.100.0") && !m.has("198.51.100.1") && m.has("198.51.100.2") && m.has("203.0.113.7"));

  const m2 = mk(RATE_MAP_CAP + 1, now - 1000, "10.0.");
  rateLimit("203.0.113.8", m2);
  check("las entradas caducadas se barren completas (sin expulsar vivas)",
    m2.size === 1 && m2.has("203.0.113.8"), `size=${m2.size}`);

  const m3 = mk(RATE_MAP_CAP + 1, now + 60_000);
  m3.set("203.0.113.9", { count: 119, reset: now + 60_000 });
  const r3 = rateLimit("203.0.113.9", m3);
  check("la IP actual no se expulsa ni se le reinicia el contador",
    r3 === null && m3.get("203.0.113.9").count === 120 && m3.size <= RATE_MAP_CAP,
    `count=${m3.get("203.0.113.9").count}, size=${m3.size}`);

  const m4 = mk(RATE_MAP_CAP + 1, now + 60_000);
  for (let i = 0; i <= 121; i++) rateLimit("203.0.113.10", m4);
  const r4 = rateLimit("203.0.113.10", m4);
  check("el tope no rompe el 429: la IP que supera el límite sigue contando",
    typeof r4 === "number" && r4 >= 1 && m4.size <= RATE_MAP_CAP, `r4=${r4}, size=${m4.size}`);
}

// ===========================================================================
// 7. Sincronía con la allowlist del worker
// ===========================================================================
section("7. allowlist del proxy vs del worker");
{
  const { readFile } = await import("node:fs/promises");
  const workerSrc = await readFile(new URL("./worker.js", import.meta.url), "utf8");
  const missing = ALLOWED_HOSTS.filter((h) => !workerSrc.includes(`"${h}"`));
  check("worker.js conoce todos los hosts del proxy", missing.length === 0, `faltan: ${missing.join(", ")}`);
  check("sin comodines en la allowlist", !ALLOWED_HOSTS.includes("*") && ALLOWED_HOSTS.length >= 5);
}

// ===========================================================================
// Resumen
// ===========================================================================
console.log(`\n${pass} ok, ${fail} fallos`);
process.exit(fail > 0 ? 1 : 0);
