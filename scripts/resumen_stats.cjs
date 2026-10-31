// Uso: node scripts/resumen_stats.cjs export.json
// Lee el export de Workers Logs y usa SOLO source.message de cada evento (el texto
// aparece también en $metadata.message: leer el fichero como texto duplicaba los recuentos).
const fs = require("fs");
const raw = fs.readFileSync(process.argv[2], "utf8");
let msgs;
try { msgs = JSON.parse(raw).map((e) => e?.source?.message || ""); }
catch { msgs = raw.split("\n"); } // respaldo: texto plano
const resumen = msgs.filter((m) => m.includes("[subtitles] resumen") && m.includes("servidas="));
const re = /(🇪🇸 Castellano|🇲🇽 Latino|🌎 Neutro|📄)[^|"]*? es=([\d.]+) lat=([\d.]+) s=(\d+)(?: len=(\d+)k(\+?))?(?: pref48=(\S+))?(?: full=(\S+))?(?: rl=(\S+))?/g;
const rows = [];
for (const m of resumen) for (const x of m.matchAll(re)) rows.push({ f: x[1], es: +x[2], lat: +x[3], s: +x[4], len: x[5] ? +x[5] : null, trunc: x[6] === "+", pref: x[7] || null, full: x[8] || null, rl: x[9] || null });
console.log("respuestas en frío (resumen):", resumen.length, "| pistas con es/lat/s:", rows.length);
const bin = (r) => (r.s <= 2 ? "s<=2" : r.s <= 5 ? "s3-5" : r.s <= 10 ? "s6-10" : "s>10");
const table = (rs) => { const by = {}; for (const r of rs) { by[r.f] ??= {}; by[r.f][bin(r)] = (by[r.f][bin(r)] || 0) + 1; } console.table(by); };
const withLen = rows.filter((r) => r.len != null);
if (withLen.length) {
  console.log(`\n== pistas con len= (${withLen.length}) ==`);
  console.log("<=48 KB:"); table(withLen.filter((r) => r.len <= 48));
  console.log(">48 KB (desde v1.4.32 también se puntúan enteras; las anteriores usaban muestreo):"); table(withLen.filter((r) => r.len > 48));
  console.log("truncadas a 300 KB (len=...k+):", withLen.filter((r) => r.trunc).length);
} else { console.log("\n(sin len= en este export: es anterior al cambio de tamaño)"); table(rows); }
console.log("clasificadas solo por el override de 2 términos:",
  rows.filter((r) => (r.f.includes("Castellano") && r.lat === 0 && r.es === 2) || (r.f.includes("Latino") && r.es === 0 && r.lat === 2)).length);
const cnt = {}; for (const m of msgs) { const x = m.match(/^\[subtitles\] (?:movie|series)\/\S+: OS-V3=(\d+|ERROR[^ ]*) SubDL=(\d+|ERROR[^ ]*)( \(sin clave\))?/); if (x) { const k = `OS-V3=${x[1] === "0" ? "0" : /^\d/.test(x[1]) ? ">0" : "ERROR"} SubDL=${x[2] === "0" ? "0" : /^\d/.test(x[2]) ? ">0" : "ERROR"}${x[3] ? " (sin clave)" : ""}`; cnt[k] = (cnt[k] || 0) + 1; } }
console.log("combinaciones OS-V3/SubDL por título:", cnt);

// ---- Archivos únicos -----------------------------------------------------------
// Las pistas se repiten (un título popular se recalcula decenas de veces por caché
// por centro de datos y TTL): se agrupan por huella (veredicto, es, lat, s, len, rl).
// Los porcentajes por archivo único evitan que dos títulos muy pedidos dominen todo.
const emo = (f) => f.split(" ")[0];
{
  const seen = new Set(); const uniq = [];
  for (const r of rows) { const k = [r.f, r.es, r.lat, r.s, r.len, r.rl].join("|"); if (!seen.has(k)) { seen.add(k); uniq.push(r); } }
  const dist = (rs) => { const n = rs.length || 1; const c = (e) => rs.filter((r) => emo(r.f) === e).length; const pc = (x) => (100 * x / n).toFixed(0) + "%"; return `n=${rs.length} | 🇲🇽 ${pc(c("🇲🇽"))} 🇪🇸 ${pc(c("🇪🇸"))} 🌎 ${pc(c("🌎"))} 📄 ${pc(c("📄"))}`; };
  console.log(`\n== archivos únicos: ${uniq.length} de ${rows.length} pistas ==`);
  console.log("sin etiqueta regional:", dist(uniq.filter((r) => !r.rl)));
  for (const k of ["spl", "spn"]) { const g = uniq.filter((r) => r.rl === k); if (g.length) console.log(`${k}:`, dist(g)); }
}

// ---- v1.4.30: idioma crudo del proveedor (rl=) y líneas `langs` -------------
const rl = rows.filter((r) => r.rl);
console.log(`\n== rl= (idioma crudo distinto de spa/es): ${rl.length} de ${rows.length} pistas ==`);
if (rl.length) {
  const t = {}; for (const r of rl) { t[r.rl] ??= {}; t[r.rl][emo(r.f)] = (t[r.rl][emo(r.f)] || 0) + 1; } console.log("veredicto servido por idioma crudo:"); console.table(t);
  // acuerdo etiqueta<->léxico: spl se espera Latino y spn Castellano (supuesto NO confirmado; se mide)
  const exp = { spl: "🇲🇽", spn: "🇪🇸" };
  for (const k of Object.keys(exp)) { const g = rl.filter((r) => r.rl === k); if (g.length) { const a = g.filter((r) => emo(r.f) === exp[k]).length; const o = g.filter((r) => (emo(r.f) === "🇪🇸" || emo(r.f) === "🇲🇽") && emo(r.f) !== exp[k]).length; console.log(`${k}: ${g.length} pistas | léxico coincide con ${exp[k]} en ${a} (${(100 * a / g.length).toFixed(0)} %) | dialecto contrario ${o} | neutro/📄 ${g.length - a - o}`); } }
}
const langLines = msgs.filter((m) => m.startsWith("[subtitles] langs "));
if (langLines.length) {
  const os = {}, sd = {}, near = {}, sdDrop = {};
  const add = (o, str) => { for (const m of str.matchAll(/(\S+)×(\d+)/g)) o[m[1]] = (o[m[1]] || 0) + +m[2]; };
  for (const m of langLines) {
    const x = m.match(/: OS-V3 (.*?)(?: \(descartados: (.*?)\))? \| SubDL (.*?)(?: \(descartados: (.*?)\))?$/);
    if (!x) continue;
    add(os, x[1]); if (x[2]) add(near, x[2]); add(sd, x[3]); if (x[4]) add(sdDrop, x[4]);
  }
  console.log(`\n== líneas langs: ${langLines.length} títulos con pistas/descartes ==`);
  console.log("OS-V3 aceptados (idioma crudo):", os);
  console.log("OS-V3 descartados que parecen español:", Object.keys(near).length ? near : "ninguno");
  console.log("SubDL (language/lang crudo):", sd);
  console.log("SubDL descartados por idioma no español:", Object.keys(sdDrop).length ? sdDrop : "ninguno");
} else console.log("(sin líneas langs en este export: es anterior a la v1.4.30)");

// ---- v1.4.33: memoria de enlaces muertos y desacuerdo etiqueta/texto ---------------
{
  let down = 0, mem = 0, d404 = 0, withMem = 0;
  for (const m of resumen) {
    const a = m.match(/ descargas=(\d+)/), b = m.match(/ mem404=(\d+)/), c = m.match(/ descartes404=(\d+)/);
    if (a) down += +a[1]; if (c) d404 += +c[1];
    if (b) { mem += +b[1]; if (+b[1] > 0) withMem++; }
  }
  console.log(`\n== enlaces muertos: descargas reales ${down} | descartes404 ${d404} | omitidos por memoria (mem404) ${mem} en ${withMem} respuestas ==`);
  if (!resumen.some((m) => m.includes(" mem404="))) console.log("(sin mem404= en este export: es anterior a la v1.4.33)");

  // Desacuerdos: una línea por archivo (huella h=) aunque se recalcule muchas veces.
  const dis = msgs.filter((m) => m.startsWith("[classify] desacuerdo "));
  const byHash = new Map();
  for (const m of dis) { const h = (m.match(/ h=(\S+)/) || [])[1] || m; if (!byHash.has(h)) byHash.set(h, m); }
  console.log(`\n== desacuerdos etiqueta/texto: ${dis.length} líneas, ${byHash.size} archivos únicos ==`);
  if (byHash.size) {
    const by = {}; const termCount = { es: {}, lat: {}, deb: {} };
    for (const m of byHash.values()) {
      const k = (m.match(/rl=(\S+) veredicto=(\S+)/) || []).slice(1, 3).join(" -> "); by[k] = (by[k] || 0) + 1;
      for (const g of ["es", "lat", "deb"]) {
        const seg = (m.match(new RegExp(`\\| ${g}: (.*?)(?: \\||\\s\\[|$)`)) || [])[1] || "";
        for (const t of seg.matchAll(/(\S+)×(\d+)/g)) termCount[g][t[1]] = (termCount[g][t[1]] || 0) + 1;
      }
    }
    console.log("por etiqueta -> veredicto:", by);
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, c]) => `${t}(${c})`).join(" ");
    console.log("términos fuertes ES más repetidos entre archivos únicos:", top(termCount.es) || "-");
    console.log("términos fuertes LAT más repetidos:", top(termCount.lat) || "-");
    console.log("términos débiles más repetidos:", top(termCount.deb) || "-");
  } else console.log("(sin líneas de desacuerdo en este export)");
}
