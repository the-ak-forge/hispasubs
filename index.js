// ============================================================================
// HispaSubs — Proxy de extracción para Vercel (Node.js) v1.0.2
//
// ANTES (1.0.0): aceptaba CUALQUIER zipUrl -> open proxy / SSRF / relay de
// ancho de banda. Cualquiera podía usar tu servidor para descargar lo que
// fuera.
//
// AHORA:
//  - Allowlist estricta de hosts destino.
//  - Bloqueo de IPs privadas / loopback (SSRF).
//  - Tamaño máximo descargable.
//  - Timeout en la descarga.
//  - Solo devuelve .srt/.vtt/.ass extraídos del zip (nunca binarios raros).
//
// Despliegue: Vercel > Functions > api/proxy.js (runtime Node 18+).
// Si añades/quitas hosts de SubDL u OpenSubtitles, actualiza ALLOWED_HOSTS.
// ============================================================================

import dns from "node:dns/promises";
import net from "node:net";
import AdmZip from "adm-zip"; // npm i adm-zip (publicado en npm, a diferencia de unzipsync)

// Lista estricta de hosts permitidos. Si cambian los CDN de SubDL u
// OpenSubtitles, amplíala aquí; nunca la dejes vacía ni con "*".
const ALLOWED_HOSTS = [
  "dl.subdl.com",
  "www.opensubtitles.org",
  "dl.opensubtitles.org",
  "files.opensubtitles.org",
  "dl6.opensubtitles.org",
];

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const FETCH_TIMEOUT_MS = 8000;

const ALLOWED_EXT = /\.(srt|vtt|ass|ssa|sub)$/i;

async function assertPublicHost(hostname) {
  // Bloquea IPs literal y nombres que resuelvan a rangos privados.
  const literal = net.isIP(hostname);
  if (literal) {
    if (!isPublicIP(hostname)) throw new Error("IP privada no permitida");
    return;
  }
  const addrs = await dns.lookup(hostname, { all: true });
  if (!addrs.length || addrs.some((a) => !isPublicIP(a.address))) {
    throw new Error("Host no permitido (resuelve a red privada)");
  }
}

function isPublicIP(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false; // link-local / metadata
    if (a === 0) return false;
    return true;
  }
  // IPv6: loopback, ULA, link-local, IPv4-mapped privada
  const h = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "::") return false;
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return false;
  if (h.startsWith("fc") || h.startsWith("fd")) return false;
  if (h.startsWith("::ffff:")) return isPublicIP(h.slice(7));
  return true;
}

export default async function handler(req, res) {
  // CORS básico por si Stremio lo pide desde navegador.
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();

  // Raíz amigable: el dominio no es una web, es un endpoint. Al abrirlo a
  // mano (o en health checks de Vercel) se explica a sí mismo en vez de
  // devolver el 400 "Falta zipUrl". /proxy sin zipUrl sí sigue en 400.
  const pathname = (req.url || "/").split("?")[0];
  if (pathname === "/" || pathname === "/index.html") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).json({
      service: "HispaSubs Proxy",
      status: "ok",
      usage: "/proxy?zipUrl=<url-https-de-un-zip-de-SubDL-u-OpenSubtitles>",
    });
  }

  try {
    const rawUrl = (req.query && req.query.zipUrl) || "";
    if (!rawUrl) return res.status(400).json({ error: "Falta zipUrl" });

    let target;
    try {
      target = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: "URL inválida" });
    }
    if (target.protocol !== "https:") return res.status(400).json({ error: "Solo se permite https" });

    const host = target.hostname.toLowerCase();
    if (!ALLOWED_HOSTS.includes(host)) {
      return res.status(403).json({ error: "Host no permitido" });
    }

    await assertPublicHost(host);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch(target, {
        signal: controller.signal,
        redirect: "manual", // NO seguir redirecciones a otros hosts
        headers: { "User-Agent": "HispaSubs/1.0.2" },
      });
    } finally {
      clearTimeout(timer);
    }

    // Si nos redirige, revalidamos el destino final.
    if (upstream.status >= 300 && upstream.status < 400) {
      const loc = upstream.headers.get("location");
      let finalHost = null;
      try { finalHost = new URL(loc, target).hostname.toLowerCase(); } catch { /* location ilegible: finalHost queda null y se bloquea */ }
      if (!finalHost || finalHost !== host) {
        return res.status(403).json({ error: "Redirección a host no permitido" });
      }
      // Reintentamos la URL final dentro del mismo host permitido.
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), FETCH_TIMEOUT_MS);
      try {
        upstream = await fetch(new URL(loc, target), {
          signal: controller2.signal,
          headers: { "User-Agent": "HispaSubs/1.0.2" },
        });
      } finally {
        clearTimeout(timer2);
      }
    }

    if (!upstream.ok) return res.status(502).json({ error: `Origen respondió ${upstream.status}` });

    const len = Number(upstream.headers.get("content-length") || 0);
    if (len && len > MAX_BYTES) return res.status(413).json({ error: "Archivo demasiado grande" });

    const buf = Buffer.from(await upstream.arrayBuffer());
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
    const candidates = [];
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const name = entry.entryName || "";
      if (!ALLOWED_EXT.test(name)) continue;
      let data;
      try {
        data = entry.getData();
      } catch {
        continue; // entrada corrupta: la saltamos, no tiramos el zip entero
      }
      if (!data || data.length === 0 || data.length > MAX_BYTES) continue;
      candidates.push({ name, data });
    }

    if (!candidates.length) {
      return res.status(404).json({ error: "El zip no contiene subtítulos válidos" });
    }

    // Preferimos .srt sobre el resto y, dentro de cada tipo, el más grande
    // (suele ser la pista completa, no un fragmento de prueba).
    candidates.sort((a, b) => {
      const score = (x) => (x.name.toLowerCase().endsWith(".srt") ? 2 : 1);
      return score(b) - score(a) || b.data.length - a.data.length;
    });

    const chosen = candidates[0];
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${chosen.name.replace(/["\\]/g, "")}"`);
    res.setHeader("Cache-Control", "public, max-age=86400"); // evita re-descargas
    return res.status(200).send(chosen.data);
  } catch (err) {
    const aborted = err && (err.name === "AbortError" || err.message?.includes("abort"));
    console.error("[proxy]", err && err.message);
    return res.status(aborted ? 504 : 500).json({ error: aborted ? "Timeout" : "Error interno" });
  }
}

// Nota: si esperas zips grandes, considera streaming en lugar de arrayBuffer.
