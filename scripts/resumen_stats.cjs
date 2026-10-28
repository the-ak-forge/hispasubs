// Uso: node scripts/resumen_stats.cjs export.json
// Lee el export de Workers Logs y usa SOLO source.message de cada evento (el texto
// aparece también en $metadata.message: leer el fichero como texto duplicaba los recuentos).
const fs = require("fs");
const raw = fs.readFileSync(process.argv[2], "utf8");
let msgs;
try { msgs = JSON.parse(raw).map((e) => e?.source?.message || ""); }
catch { msgs = raw.split("\n"); } // respaldo: texto plano
const resumen = msgs.filter((m) => m.includes("[subtitles] resumen") && m.includes("servidas="));
const re = /(🇪🇸 Castellano|🇲🇽 Latino|🌎 Neutro|📄)[^|"]*? es=([\d.]+) lat=([\d.]+) s=(\d+)(?: len=(\d+)k(\+?))?(?: pref48=(\S+))?/g;
const rows = [];
for (const m of resumen) for (const x of m.matchAll(re)) rows.push({ f: x[1], es: +x[2], lat: +x[3], s: +x[4], len: x[5] ? +x[5] : null, trunc: x[6] === "+", pref: x[7] || null });
console.log("respuestas en frío (resumen):", resumen.length, "| pistas con es/lat/s:", rows.length);
const bin = (r) => (r.s <= 2 ? "s<=2" : r.s <= 5 ? "s3-5" : r.s <= 10 ? "s6-10" : "s>10");
const table = (rs) => { const by = {}; for (const r of rs) { by[r.f] ??= {}; by[r.f][bin(r)] = (by[r.f][bin(r)] || 0) + 1; } console.table(by); };
const withLen = rows.filter((r) => r.len != null);
if (withLen.length) {
  console.log(`\n== pistas con len= (${withLen.length}) ==`);
  console.log("<=48 KB (se puntúan enteras):"); table(withLen.filter((r) => r.len <= 48));
  console.log(">48 KB (muestreo de 3 ventanas):"); table(withLen.filter((r) => r.len > 48));
  console.log("truncadas a 300 KB (len=...k+):", withLen.filter((r) => r.trunc).length);
  const big = withLen.filter((r) => r.len > 48);
  const chg = big.filter((r) => r.pref);
  console.log(`\n== log sombra pref48: de ${big.length} pistas >48 KB, ${chg.length} (${big.length ? (100 * chg.length / big.length).toFixed(1) : 0}%) cambian de veredicto por el muestreo`);
  const m = {}; for (const r of chg) { const k = `${r.pref}(prefijo 48KB) -> ${r.f}(muestreo)`; m[k] = (m[k] || 0) + 1; }
  console.table(m);
} else { console.log("\n(sin len= en este export: es anterior al cambio de tamaño)"); table(rows); }
console.log("clasificadas solo por el override de 2 términos:",
  rows.filter((r) => (r.f.includes("Castellano") && r.lat === 0 && r.es === 2) || (r.f.includes("Latino") && r.es === 0 && r.lat === 2)).length);
const cnt = {}; for (const m of msgs) { const x = m.match(/^\[subtitles\] (?:movie|series)\/\S+: OS-V3=(\d+|ERROR[^ ]*) SubDL=(\d+|ERROR[^ ]*)( \(sin clave\))?/); if (x) { const k = `OS-V3=${x[1] === "0" ? "0" : /^\d/.test(x[1]) ? ">0" : "ERROR"} SubDL=${x[2] === "0" ? "0" : /^\d/.test(x[2]) ? ">0" : "ERROR"}${x[3] ? " (sin clave)" : ""}`; cnt[k] = (cnt[k] || 0) + 1; } }
console.log("combinaciones OS-V3/SubDL por título:", cnt);
