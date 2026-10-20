// ============================================================================
// HispaSubs — Proxy de extracción para Vercel (Node.js) v1.4.7
//
// ANTES (1.0.0): aceptaba CUALQUIER zipUrl -> open proxy / SSRF / relay de
// ancho de banda. Cualquiera podía usar tu servidor para descargar lo que
// fuera.
//
// AHORA:
//  - Allowlist estricta de hosts destino y SOLO puerto 443 (1.0.3: con
//    "https://dl.subdl.com:8443" se conectaba a cualquier puerto).
//  - Bloqueo de IPs privadas / loopback (SSRF) en el origen y en CADA salto
//    de redirección (1.0.2 seguía el segundo salto con redirect:"follow"
//    sin validarlo -> bypass de la allowlist).
//  - Tamaño máximo descargable: 4 MB (Vercel limita la respuesta de la
//    función a 4,5 MB; 10 MB devolvía 413 de plataforma).
//  - Timeout en la descarga.
//  - Solo devuelve .srt/.vtt/.ass extraídos del zip (nunca binarios raros).
//  - Limitación de peticiones por IP (best-effort, RATE_LIMIT_PER_MIN).
//
// v1.4.7 (20/10/2026):
//  - [SERIES] epExactRe soporta nombres multiepisodio (p. ej. S01E03E04,
//    S01E03-E04, 1x03x04) tanto al pedir el primer episodio como los
//    siguientes del archivo doble.
//  - [SSRF] RESERVED_BLOCKS añade ::/96 (IPv4-compatible deprecada, cubre las
//    formas expandidas de 6 grupos de ceros como 0:0:0:0:0:0:7f00:1 y
//    0:0:0:0:0:0:a.b.c.d), fec0::/10 (site-local deprecada) y 2001::/32
//    (Teredo).
//
// v1.4.6 (19/10/2026):
//  - [SERIES] En packs de temporada (&s=<season>&e=<episode>), si ninguna
//    entrada del zip coincide con el episodio pedido pero sí hay entradas con
//    marcador explícito de otro episodio (SxxExx / 1x02), se descartan en vez
//    de servir el capítulo más largo por error (devuelve 404 para que el
//    Worker pase al siguiente candidato). Si el zip solo trae archivos sin
//    marcador de episodio (p. ej. "subtitulo.srt"), mantiene el fallback.
//    Además se soporta un segundo nivel de match por número de episodio
//    (E03 / Ep 03 / Cap 03) para animes o miniseries sin temporada en el
//    nombre.
//  - [SSRF] isPublicIP usa net.BlockList nativo de Node además de las reglas
//    existentes: normaliza automáticamente formas IPv6 expandidas
//    (0:0:0:0:0:0:0:1, 0:0:0:0:0:ffff:7f00:1) e IPv4-translated (::ffff:0:x).
//
// v1.4.5 (19/10/2026):
//  - [SERIES] Cuando la petición incluye &s=<season>&e=<episode> (series), el
//    orden de candidatos prioriza las entradas cuyo nombre coincida con el
//    episodio (S01E03 / 1x03, con bordes numéricos para no confundir E3 con
//    E30) antes de desempatar por .srt y tamaño declarado. Así un pack de
//    temporada sirve el episodio pedido y no el más largo.
//  - [CACHÉ] Cache-Control añade s-maxage=86400, stale-while-revalidate=3600:
//    Vercel exige s-maxage para cachear respuestas de Functions en el Edge;
//    así la descarga del reproductor reutiliza el zip ya extraído por el
//    Worker sin re-invocar la función ni volver a pedirlo a SubDL.
//  - [SSRF] isPublicIP cubre IPv4-mapped en formato hexadecimal (::ffff:7f00:1)
//    y bloquea los prefijos de transición/documentación NAT64 (64:ff9b::/96),
//    6to4 (2002::/16) y 2001:db8::/32.
//
// v1.4.4 (19/10/2026): tope duro del Map del rate limiter. El barrido de
// expirados no reducía nada si toda la ventana (60 s) seguía viva: con más de
// 5000 IPs distintas el Map crecía sin límite y cada petición pagaba un
// barrido completo. Ahora, tras barrer, se expulsa de la cabeza hasta bajar
// del tope (el Map conserva el orden de inserción), preservando la entrada de
// la IP actual. `rateLimit` acepta un Map inyectable y se exporta para tests.
// (Auditoría externa de la 1.4.3; el reclamo de que adm-zip "destruye la
// latencia" se refutó: 1,6 ms en un zip típico, ~33 ms en el patológico ya
// acotado por MAX_ENTRIES/MAX_BYTES_TOTAL.)
//
// v1.4.3 (19/10/2026): sin cambios funcionales en el proxy — versión alineada
// con el Worker (auditoría de la 1.4.2: CPU, falsos positivos y fugas de
// "solo pistas verificadas" en el análisis del Worker).
//
// v1.4.2 (19/10/2026): sin cambios funcionales en el proxy — versión alineada
// con el Worker (filtro anti-spam y política de solo pistas verificadas).
//
// v1.4.1 (auditoría de código, 18/10/2026):
//  - Descarga por STREAMING acotada a 4 MB (readCapped): un origen que miente
//    con content-length (o no lo manda) ya no puede volcar GB en la memoria
//    de la función antes de que actúe el timeout. El exceso devuelve 413.
//  - .sub UTF-16 (BOM FF FE / FE FF) ya no se descarta como binario VobSub:
//    los bytes NUL alternos del UTF-16 son texto, no muestreo de vídeo.
//  - zipUrl se normaliza a String: con el parámetro duplicado en la query,
//    req.query.zipUrl puede ser un Array (se stringificaba a "url1,url2").
//
// Despliegue: Vercel detecta api/proxy.js por convención de directorios y el
// enrutado vive en vercel.json (rewrites -> /api/proxy).
// Si añades/quitas hosts de SubDL u OpenSubtitles, actualiza ALLOWED_HOSTS —
// y su gemelo PROXY_ALLOWED_HOSTS en worker.js, o los .zip de esa fuente
// quedarán fuera del proxy y la entrada se descartará.
// ============================================================================

import dns from "node:dns/promises";
import net from "node:net";
import AdmZip from "adm-zip"; // npm i adm-zip@0.6.1+ (CVE-2026-39244 / zip bomb)

// Lista estricta de hosts permitidos. Si cambian los CDN de SubDL u
// OpenSubtitles, amplíala aquí; nunca la dejes vacía ni con "*".
const ALLOWED_HOSTS = [
  "dl.subdl.com",
  "www.opensubtitles.org",
  "dl.opensubtitles.org",
  "files.opensubtitles.org",
  "dl6.opensubtitles.org",
];

const ALLOWED_PORTS = new Set(["", "443"]);

// Vercel devuelve 413 FUNCTION_PAYLOAD_TOO_LARGE por encima de 4,5 MB en la
// respuesta: el límite real de este proxy es 4 MB, no 10.
const MAX_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 2; // cada salto se vuelve a validar (host+puerto+IP)
const MAX_ENTRIES = 2000; // corte de zips con cientos de miles de entradas
const USER_AGENT = "HispaSubs/1.4.7";

const ALLOWED_EXT = /\.(srt|vtt|ass|ssa|sub)$/i;

// Error con código HTTP propio: evita el cable de return/status anidados del
// flujo de validación (que se ejecuta ahora en el origen Y en cada salto).
class ProxyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Valida UN destino (origen o salto de redirección): https + allowlist +
// puerto permitido + IP pública. `viaRedirect` cambia los mensajes para que
// en los logs se distinga un redirect hostil de un origen malo.
async function assertSafeUrl(target, viaRedirect = false) {
  if (target.protocol !== "https:") {
    throw new ProxyError(
      viaRedirect ? 403 : 400,
      viaRedirect ? "Redirección a esquema no permitido" : "Solo se permite https"
    );
  }
  const host = target.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.includes(host)) {
    throw new ProxyError(403, viaRedirect ? "Redirección a host no permitido" : "Host no permitido");
  }
  if (target.port && !ALLOWED_PORTS.has(target.port)) {
    throw new ProxyError(403, viaRedirect ? "Redirección a puerto no permitido" : "Puerto no permitido");
  }
  await assertPublicHost(host, viaRedirect);
}

async function assertPublicHost(hostname, viaRedirect = false) {
  // Bloquea IPs literal y nombres que resuelvan a rangos privados.
  const literal = net.isIP(hostname);
  if (literal) {
    if (!isPublicIP(hostname)) {
      throw new ProxyError(403, viaRedirect ? "Redirección a red privada" : "IP privada no permitida");
    }
    return;
  }
  const addrs = await dns.lookup(hostname, { all: true });
  if (!addrs.length || addrs.some((a) => !isPublicIP(a.address))) {
    throw new ProxyError(403, viaRedirect ? "Redirección a red privada" : "Host no permitido (resuelve a red privada)");
  }
}

// BlockList nativa de Node: normaliza cualquier representación IPv4/IPv6
// (incluidas las formas expandidas 0:0:0:0:0:0:0:1, 0:0:0:0:0:ffff:7f00:1
// y ::ffff:0:7f00:1) antes de comparar contra las subredes reservadas.
const RESERVED_BLOCKS = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  RESERVED_BLOCKS.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96],             // IPv4-compatible deprecada (0:0:0:0:0:0:7f00:1, ::a.b.c.d)
  ["::ffff:0:0", 96],     // IPv4-mapped (cualquier forma expandida/hex)
  ["::ffff:0:0:0", 96],   // IPv4-translated (RFC 2765)
  ["64:ff9b::", 96],      // NAT64
  ["64:ff9b:1::", 48],    // NAT64 local-use
  ["100::", 64],          // Discard-Only (RFC 6666)
  ["2001::", 32],         // Teredo (RFC 4380)
  ["2001:db8::", 32],     // Documentación
  ["2002::", 16],         // 6to4
  ["fc00::", 7],          // ULA (fc00::/7 cubre fc y fd)
  ["fe80::", 10],         // Link-local (fe80..febf)
  ["fec0::", 10],         // Site-local deprecada (RFC 3879)
  ["ff00::", 8],          // Multicast
]) {
  RESERVED_BLOCKS.addSubnet(addr, prefix, "ipv6");
}

function isPublicIP(ip) {
  const clean = String(ip || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIPv4(clean)) return isPublicIPv4(clean);
  if (!net.isIPv6(clean)) return false;
  // IPv4-mapped decimal: ::ffff:8.8.8.8 o 0:0:0:0:0:ffff:8.8.8.8 (la gama
  // IPv4-compatible ::/96 sin ffff: está deprecada por RFC 4291 y la bloquea
  // RESERVED_BLOCKS abajo).
  const v4 = clean.match(/^(?:(?:0+:){0,5}ffff:|::ffff:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4) return isPublicIPv4(v4[1]);
  // IPv4-mapped hex: ::ffff:7f00:1 o 0:0:0:0:0:ffff:7f00:1
  const v4Hex = clean.match(/^(?:(?:0+:){0,5}ffff:|::ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4Hex) {
    const hi = parseInt(v4Hex[1], 16);
    const lo = parseInt(v4Hex[2], 16);
    return isPublicIPv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  if (RESERVED_BLOCKS.check(clean, "ipv6")) return false;
  return true;
}

function isPublicIPv4(ip) {
  const [a, b] = ip.split(".").map(Number);
  if (a === 10) return false;
  if (a === 127) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false; // link-local / metadata
  if (a === 0) return false; // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64/10
  if (a === 192 && b === 0) return false; // 192.0.0/24 (IETF)
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmark 198.18/15
  if (a >= 224) return false; // multicast 224/4 + reservado 240/4 + broadcast
  return true;
}

// ---------------------------------------------------------------------------
// Limitación de peticiones por IP (best-effort)
//
// Ventana fija de 60 s en memoria de la instancia: en Vercel las instancias
// van y vienen, así que esto ata a un atacante concreto, no es una defensa
// de plataforma (para eso, regla de rate limiting en el panel).
//   RATE_LIMIT_PER_MIN=120 (por defecto) | 0 o negativo = desactivado
// Solo cuenta peticiones que van a descargar de verdad (con zipUrl), así el
// endpoint raíz/health check nunca dispara el contador.
// ---------------------------------------------------------------------------
const rateHits = new Map();
// Tope del Map: el barrido de expirados no reduce nada si toda la ventana
// (60 s) sigue viva, así que sin este cap un barrido de IPs distintas lo
// dejaría crecer sin límite (presión de memoria de la instancia) y cada
// petición pagaría un barrido completo inútil (0,2 ms medidos con 5001
// entradas). Best-effort: la defensa de plataforma es la rate limiting
// rule del panel de Vercel.
const RATE_MAP_CAP = 5000;

function clientIp(req) {
  const h = req.headers || {};
  const raw = h["x-real-ip"] || String(h["x-forwarded-for"] || "").split(",")[0];
  return (raw || "").trim();
}

function rateLimit(ip, map = rateHits) {
  const limit = Number(process.env.RATE_LIMIT_PER_MIN ?? 120);
  if (!Number.isFinite(limit) || limit <= 0 || !ip) return null;
  const now = Date.now();
  if (map.size > RATE_MAP_CAP) {
    for (const [k, v] of map) if (v.reset <= now) map.delete(k);
    // Expulsión de la cabeza (el Map conserva el orden de inserción),
    // preservando la entrada de la IP actual para no reiniciar su contador.
    // El bucle para por DEBAJO del tope: con la inserción posterior el Map
    // queda exactamente en RATE_MAP_CAP.
    for (const k of map.keys()) {
      if (map.size < RATE_MAP_CAP) break;
      if (k !== ip) map.delete(k);
    }
  }
  let e = map.get(ip);
  if (!e || e.reset <= now) {
    e = { count: 0, reset: now + 60_000 };
    map.set(ip, e);
  }
  e.count += 1;
  if (e.count > limit) {
    // Un solo log por IP y ventana, para que un ataque no te ahogue los logs.
    if (e.count === limit + 1) console.warn(`[proxy] rate limit superado por ${ip}`);
    return Math.max(1, Math.ceil((e.reset - now) / 1000));
  }
  return null;
}

// Cabecera Content-Disposition segura: sin CR/LF (inyección de cabeceras),
// sin separadores de ruta y con nombre UTF-8 declarado según RFC 5987.
function contentDisposition(name) {
  const base = String(name || "").split(/[/\\]/).pop() || "";
  const ascii = base.replace(/[\r\n"]/g, "").replace(/[^\x20-\x7e]/g, "_").slice(0, 120) || "subtitle.srt";
  const utf8 = encodeURIComponent(base.replace(/[\r\n"]/g, "").slice(0, 200) || ascii).slice(0, 400);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// Lee como mucho `max` bytes del body por STREAMING y cancela el resto.
// Devuelve null si la respuesta supera el tope (el caller responde 413):
// truncar un zip por la mitad solo produciría un 415 "zip corrupto" confuso.
// Mismo esquema que readCapped en worker.js (ahí truncaba a propósito porque
// para muestrear el léxico bastaba con la cabeza del fichero).
async function readCapped(res, max) {
  if (!res.body || typeof res.body.getReader !== "function") {
    const ab = await res.arrayBuffer();
    return ab.byteLength > max ? null : Buffer.from(ab);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // Un chunk que no cabe en el espacio restante es exceso REAL (aunque el
    // body entero venga en un solo chunk, p. ej. new Response(buffer)): se
    // corta y se devuelve null para que el caller responda 413.
    if (value.length > max - total) {
      try { await reader.cancel(); } catch { /* stream ya cerrado */ }
      return null;
    }
    // En Node >= 18 fetch devuelve Uint8Array; Buffer.from copia y adm-zip
    // trabaja con Buffers.
    chunks.push(Buffer.from(value));
    total += value.length;
  }
  try { await reader.cancel(); } catch { /* stream ya cerrado */ }
  return Buffer.concat(chunks, total);
}

export default async function handler(req, res) {
  // CORS básico por si Stremio lo pita desde navegador.
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();

  // Raíz amigable: el dominio no es una web, es un endpoint. Al abrirlo a
  // mano (o en health checks de Vercel) se explica a sí mismo en vez de
  // devolver el 400 "Falta zipUrl". /proxy sin zipUrl sí sigue en 400.
  // Cubre también /api/proxy: con los rewrites de vercel.json la función
  // puede ver su propio path como req.url.
  const pathname = (req.url || "/").split("?")[0];
  if (pathname === "/" || pathname === "/index.html" || pathname === "/api/proxy") {
    if (!(req.query && req.query.zipUrl)) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.status(200).json({
        service: "HispaSubs Proxy",
        status: "ok",
        usage: "/proxy?zipUrl=<url-https-de-un-zip-de-SubDL-u-OpenSubtitles>",
      });
    }
  }

  try {
    // String() explícito: con el parámetro duplicado en la query,
    // req.query.zipUrl puede ser un Array (querystring.parse de Node); sin
    // normalizar se stringificaría igual dentro de new URL() a "url1,url2",
    // una URL sucia cuyo host sigue atado a la allowlist. Aquí queda decidido
    // en un solo sitio y con .trim() de regalo.
    const rawUrl = req.query && req.query.zipUrl ? String(req.query.zipUrl).trim() : "";
    if (!rawUrl) return res.status(400).json({ error: "Falta zipUrl" });

    let target;
    try {
      target = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: "URL inválida" });
    }

    // Límite de peticiones por IP: solo aquí, porque solo aquí se descarga.
    const retryAfter = rateLimit(clientIp(req));
    if (retryAfter) {
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "Demasiadas peticiones" });
    }

    // Descarga con validación en CADA salto (origen + hasta MAX_REDIRECTS
    // redirecciones). redirect:"manual" siempre: con "follow" el segundo
    // salto viajaba sin validar (bypass de allowlist / SSRF).
    //
    // El timeout cubre cabeceras Y cuerpo: antes se limpiaba el timer tras
    // recibir las cabeceras, así que una descarga lenta o truncada (origen
    // que manda Content-Length y se corta a mitad) podía dejar la función
    // colgada indefinidamente hasta el límite de la plataforma.
    const timeoutMs = Number(process.env.FETCH_TIMEOUT_MS) || FETCH_TIMEOUT_MS;
    let buf = null;
    let redirects = 0;
    for (;;) {
      await assertSafeUrl(target, redirects > 0);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const upstream = await fetch(target, {
          signal: controller.signal,
          redirect: "manual",
          headers: { "User-Agent": USER_AGENT },
        });
        if (upstream.status >= 300 && upstream.status < 400) {
          if (++redirects > MAX_REDIRECTS) {
            throw new ProxyError(403, "Demasiadas redirecciones");
          }
          const loc = upstream.headers.get("location");
          try {
            target = new URL(loc, target); // location relativa -> absoluta
          } catch {
            throw new ProxyError(403, "Redirección ilegible");
          }
          continue;
        }
        if (!upstream.ok) {
          return res.status(502).json({ error: `Origen respondió ${upstream.status}` });
        }
        const len = Number(upstream.headers.get("content-length") || 0);
        if (len && len > MAX_BYTES) {
          return res.status(413).json({ error: "Archivo demasiado grande" });
        }
        // Lectura ACOTADA por streaming (anti-OOM): un origen que miente con
        // content-length o no lo manda ya no puede cargar GB en la función.
        buf = await readCapped(upstream, MAX_BYTES);
        if (buf === null) return res.status(413).json({ error: "Archivo demasiado grande" });
      } finally {
        clearTimeout(timer);
      }
      break;
    }
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: "Archivo demasiado grande" });

    // ¿Es realmente un zip? (PK\x03\x04)
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    if (!isZip) return res.status(415).json({ error: "El archivo no es un zip" });

    // adm-zip: getEntries() -> entryName / isDirectory / getData()
    let entries;
    try {
      entries = new AdmZip(buf).getEntries();
    } catch {
      return res.status(415).json({ error: "Zip corrupto o ilegible" });
    }
    // FASE 1 — Solo metadatos: nombre + tamaño declarado en la cabecera del
    // zip. Antes se descomprimía CADA candidato con getData() para poder
    // ordenarlos por bytes reales, con lo que un zip con muchas pistas
    // pagaba la descompresión de todas aunque solo se sirviera una.
    const candidates = [];
    let scanned = 0;
    const MAX_BYTES_TOTAL = MAX_BYTES * 2; // presupuesto agregado conservador (8 MB por zip)
    for (const entry of entries) {
      if (++scanned > MAX_ENTRIES) break;
      if (entry.isDirectory) continue;
      const name = entry.entryName || "";
      if (!ALLOWED_EXT.test(name)) continue;
      // Tamaño declarado ANTES de descomprimir: es el mismo que GetData()
      // produciría (bytes sin comprimir), así que ordenar por él equivale a
      // ordenar por data.length sin haber descomprimido nada, y además es
      // defensa adicional al fix de adm-zip 0.6.1 (zip bomb).
      const declared = entry.header && entry.header.size;
      if (declared && declared > MAX_BYTES) continue;
      candidates.push({ entry, name, declared: declared || 0 });
    }

    // En series (&s=<season>&e=<episode>):
    //  - Nivel 2 (exacto): S01E03 / 1x03 (temporada + episodio).
    //  - Nivel 1 (solo ep): E03 / Ep 03 / Cap 03 (sin otro marcador SxxExx
    //    de otra temporada en el mismo nombre).
    //  - Si ninguna entrada del zip coincide con el episodio pedido, se
    //    descartan las entradas que tengan un marcador explícito de OTRO
    //    episodio (SxxExx / 1x02 / Ep 05): así un pack de E01-E05 cuando se
    //    pide E07 responde 404 en vez de servir E01 por error. Las entradas
    //    neutras sin marcador de episodio ("subtitulo.srt") sí se conservan.
    const rawS = req.query && req.query.s ? String(req.query.s).trim() : "";
    const rawE = req.query && req.query.e ? String(req.query.e).trim() : "";
    const hasSE = /^\d+$/.test(rawS) && /^\d+$/.test(rawE);
    const sNum = hasSE ? Number(rawS) : 0;
    const eNum = hasSE ? Number(rawE) : 0;
    const epExactRe = hasSE
      ? new RegExp(
          `(?:(?<![0-9a-z])s0*${sNum}(?:[._\\s-]*e\\d+)*[._\\s-]*e0*${eNum}|(?<![0-9])0*${sNum}(?:[._\\s-]*x\\d+)*x0*${eNum})(?![0-9])`,
          "i"
        )
      : null;
    const epLooseRe = hasSE
      ? new RegExp(`(?<![0-9a-z])(?:ep(?:isodio)?|cap(?:[ií]tulo)?|e)[._\\s-]*0*${eNum}(?![0-9a-z])`, "i")
      : null;
    const anySeTokenRe = /(?:(?<![0-9a-z])s\d+[._\s-]*e\d+|(?<![0-9])\d+x\d+|(?<![0-9a-z])(?:ep(?:isodio)?|cap(?:[ií]tulo)?)[._\s-]*\d+)(?![0-9])/i;

    const epRank = (name) => {
      if (!hasSE) return 0;
      if (epExactRe.test(name)) return 2;
      if (!anySeTokenRe.test(name) && epLooseRe.test(name)) return 1;
      if (epLooseRe.test(name) && !/(?<![0-9a-z])s\d+[._\s-]*e\d+|(?<![0-9])\d+x\d+/i.test(name)) return 1;
      return 0;
    };

    let filteredCandidates = candidates;
    if (hasSE) {
      const anyMatch = candidates.some((c) => epRank(c.name) > 0);
      if (anyMatch) {
        filteredCandidates = candidates.filter((c) => epRank(c.name) > 0);
      } else {
        // Ninguna entrada casa con el episodio pedido: descartamos las que
        // llevan token explícito de OTRO episodio para no servir otro capítulo.
        filteredCandidates = candidates.filter((c) => !anySeTokenRe.test(c.name));
      }
    }

    filteredCandidates.sort((a, b) => {
      if (hasSE) {
        const diff = epRank(b.name) - epRank(a.name);
        if (diff !== 0) return diff;
      }
      const score = (x) => (x.name.toLowerCase().endsWith(".srt") ? 2 : 1);
      return score(b) - score(a) || b.declared - a.declared;
    });

    // FASE 2 — Descomprimimos SOLO hasta encontrar la pista elegida (o las
    // que fallen y haya que descartar). Si getData() lanza o el dato no sirve
    // (binario, vacío, enorme), seguimos con la siguiente candidata.
    let chosen = null;
    let totalUncompressed = 0;
    for (const cand of filteredCandidates) {
      if (totalUncompressed >= MAX_BYTES_TOTAL) break;
      let data;
      try {
        data = cand.entry.getData();
      } catch {
        continue; // entrada corrupta: la saltamos, no tiramos el zip entero
      }
      if (!data || data.length === 0 || data.length > MAX_BYTES) continue;
      if (totalUncompressed + data.length > MAX_BYTES_TOTAL) break;
      totalUncompressed += data.length;
      // Un .sub VobSub es BINARIO (muestreo de vídeo, no texto): con la
      // extensión en la allowlist llegaba al reproductor como text/plain y
      // salían glifos aleatorios. Los .sub de texto (SubViewer) no llevan
      // NUL y sí se sirven. Excepción v1.4.1: UTF-16 (BOM FF FE / FE FF),
      // que también es texto y cuyos bytes alternan con NULs —sin esta
      // comprobación se descartaba falsamente como binario—. Si el elegido
      // es binario, se prueba el siguiente candidato.
      if (/\.(sub)$/i.test(cand.name) && data.includes(0x00)) {
        const utf16Bom =
          data.length >= 2 &&
          ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff));
        if (!utf16Bom) continue;
      }
      chosen = { name: cand.name, data };
      break;
    }

    if (!chosen) {
      return res.status(404).json({ error: "El zip no contiene subtítulos válidos" });
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", contentDisposition(chosen.name));
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600"); // evita re-descargas en cliente y CDN de Vercel
    return res.status(200).send(chosen.data);
  } catch (err) {
    if (err instanceof ProxyError) {
      return res.status(err.status).json({ error: err.message });
    }
    const aborted = err && (err.name === "AbortError" || err.message?.includes("abort"));
    console.error("[proxy]", err && err.message);
    return res.status(aborted ? 504 : 500).json({ error: aborted ? "Timeout" : "Error interno" });
  }
}

// Exportados para test_proxy.js (la lógica de SSRF no puede quedar sin tests).
export { ALLOWED_HOSTS, MAX_BYTES, isPublicIP, assertSafeUrl, readCapped, rateLimit, RATE_MAP_CAP };
