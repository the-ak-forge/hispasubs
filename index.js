import dns from "node:dns/promises";
import net from "node:net";
import AdmZip from "adm-zip";

// Lista estricta de hosts permitidos.
const ALLOWED_HOSTS = [
  "dl.subdl.com",
  "www.opensubtitles.org",
  "dl.opensubtitles.org",
  "files.opensubtitles.org",
  "dl6.opensubtitles.org",
];

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const FETCH_TIMEOUT_MS = 8000;
const ALLOWED_EXT = /\.(srt|vtt|ass|ssa|sub)\$/i;

async function assertPublicHost(hostname) {
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
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false; 
    return true;
  }
  const h = ip.toLowerCase().replace(/^\[\vert{}\]\$/g, "");
  if (h === "::1" || h === "::") return false;
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return false;
  if (h.startsWith("fc") || h.startsWith("fd")) return false;
  if (h.startsWith("::ffff:")) return isPublicIP(h.slice(7));
  return true;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();

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
        redirect: "manual",
        headers: { "User-Agent": "HispaSubs/1.0.1" },
      });
    } finally {
      clearTimeout(timer);
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      const loc = upstream.headers.get("location");
      let finalHost = null;
      try { finalHost = new URL(loc, target).hostname.toLowerCase(); } catch { }
      if (!finalHost || finalHost !== host) {
        return res.status(403).json({ error: "Redirección a host no permitido" });
      }
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), FETCH_TIMEOUT_MS);
      try {
        upstream = await fetch(new URL(loc, target), {
          signal: controller2.signal,
          headers: { "User-Agent": "HispaSubs/1.0.1" },
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

    const isZip = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    if (!isZip) return res.status(415).json({ error: "El archivo no es un zip" });

    // Extraemos con adm-zip
    const zip = new AdmZip(buf);
    const entries = zip.getEntries();
    const candidates = [];
    
    for (const entry of entries) {
      const name = entry.entryName || "";
      if (!ALLOWED_EXT.test(name)) continue;
      const data = entry.getData();
      if (!data || data.length === 0 || data.length > MAX_BYTES) continue;
      candidates.push({ name, data });
    }

    if (!candidates.length) {
      return res.status(404).json({ error: "El zip no contiene subtítulos válidos" });
    }

    candidates.sort((a, b) => {
      const score = (x) => (x.name.toLowerCase().endsWith(".srt") ? 2 : 1);
      return score(b) - score(a) || b.data.length - a.data.length;
    });

    const chosen = candidates[0];
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${chosen.name.replace(/["\\]/g, "")}"`);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).send(chosen.data);
  } catch (err) {
    const aborted = err && (err.name === "AbortError" || err.message?.includes("abort"));
    console.error("[proxy]", err && err.message);
    return res.status(aborted ? 504 : 500).json({ error: aborted ? "Timeout" : "Error interno" });
  }
}