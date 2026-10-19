// ============================================================================
// HispaSubs — Proxy de extracción para Vercel (Node.js) v1.4.1
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
const USER_AGENT = "HispaSubs/1.4.1";

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

function isPublicIP(ip) {
  if (net.isIPv4(ip)) return isPublicIPv4(ip);
  // IPv6: loopback, ULA, link-local, multicast, NAT64 e IPv4 embebida
  const h = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "::") return false;
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return false;
  if (h.startsWith("fc") || h.startsWith("fd")) return false;
  if (h.startsWith("ff")) return false; // multicast ff00::/8
  // IPv4 embebida: ::ffff:127.0.0.1 (mapped) y ::127.0.0.1 (compatible)
  const v4 = h.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4) return isPublicIPv4(v4[1]);
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

function clientIp(req) {
  const h = req.headers || {};
  const raw = h["x-real-ip"] || String(h["x-forwarded-for"] || "").split(",")[0];
  return (raw || "").trim();
}

function rateLimit(ip) {
  const limit = Number(process.env.RATE_LIMIT_PER_MIN ?? 120);
  if (!Number.isFinite(limit) || limit <= 0 || !ip) return null;
  const now = Date.now();
  if (rateHits.size > 5000) {
    for (const [k, v] of rateHits) if (v.reset <= now) rateHits.delete(k);
  }
  let e = rateHits.get(ip);
  if (!e || e.reset <= now) {
    e = { count: 0, reset: now + 60_000 };
    rateHits.set(ip, e);
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

    // Preferimos .srt sobre el resto y, dentro de cada tipo, el más grande
    // (suele ser la pista completa, no un fragmento de prueba).
    candidates.sort((a, b) => {
      const score = (x) => (x.name.toLowerCase().endsWith(".srt") ? 2 : 1);
      return score(b) - score(a) || b.declared - a.declared;
    });

    // FASE 2 — Descomprimimos SOLO hasta encontrar la pista elegida (o las
    // que fallen y haya que descartar). Si getData() lanza o el dato no sirve
    // (binario, vacío, enorme), seguimos con la siguiente candidata.
    let chosen = null;
    let totalUncompressed = 0;
    for (const cand of candidates) {
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
    res.setHeader("Cache-Control", "public, max-age=86400"); // evita re-descargas
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
export { ALLOWED_HOSTS, MAX_BYTES, isPublicIP, assertSafeUrl, readCapped };
