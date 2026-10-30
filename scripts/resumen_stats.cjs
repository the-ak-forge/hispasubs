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

// ---- v1.4.30: veredicto del archivo COMPLETO (full=) -------------------------
// full= solo aparece en ~1 de cada 5 pistas >48 KB. Servido = veredicto del
// muestreo (el que ve el usuario); prefijo = pref48= (ausente = igual que el
// servido); completo = full=. Se compara cada uno contra el completo.
const emo = (f) => f.split(" ")[0];
const withFull = rows.filter((r) => r.full);
if (withFull.length) {
  const ok = (a, b) => a === b;
  const sOk = withFull.filter((r) => ok(emo(r.f), r.full)).length;
  const pOk = withFull.filter((r) => ok(r.pref || emo(r.f), r.full)).length;
  const pct = (n) => (100 * n / withFull.length).toFixed(1) + " %";
  console.log(`\n== full= (archivo completo): ${withFull.length} pistas ==`);
  console.log(`coincide con el completo: muestreo (servido) ${sOk} (${pct(sOk)}) | prefijo 48 KB ${pOk} (${pct(pOk)})`);
  const dis = withFull.filter((r) => !ok(emo(r.f), r.full) || !ok(r.pref || emo(r.f), r.full));
  const tab = {};
  for (const r of dis) { const k = `muestreo ${emo(r.f)} | prefijo ${r.pref || emo(r.f)} | completo ${r.full}`; tab[k] = (tab[k] || 0) + 1; }
  console.table(tab);
  const dial = (e) => e === "🇪🇸" || e === "🇲🇽";
  const opp = withFull.filter((r) => dial(emo(r.f)) && dial(r.full) && emo(r.f) !== r.full).length;
  console.log(`saltos Castellano<->Latino del muestreo frente al completo: ${opp}`);
  const bySize = {};
  for (const r of withFull) { const b = r.len <= 96 ? "49-96k" : r.len <= 150 ? "97-150k" : ">150k"; bySize[b] ??= { n: 0, muestreo: 0, prefijo: 0 }; bySize[b].n++; if (ok(emo(r.f), r.full)) bySize[b].muestreo++; if (ok(r.pref || emo(r.f), r.full)) bySize[b].prefijo++; }
  console.table(bySize);
  if (withFull.length < 150) console.log("(muestra pequeña: conviene juntar >=150 pistas antes de decidir)");
} else console.log("\n(sin full= en este export: es anterior a la v1.4.30)");

// ---- v1.4.30: idioma crudo del proveedor (rl=) y líneas `langs` -------------
const rl = rows.filter((r) => r.rl);
console.log(`\n== rl= (idioma crudo distinto de spa/es): ${rl.length} de ${rows.length} pistas ==`);
if (rl.length) {
  const t = {}; for (const r of rl) { t[r.rl] ??= {}; t[r.rl][emo(r.f)] = (t[r.rl][emo(r.f)] || 0) + 1; } console.log("veredicto servido (muestreo) por idioma crudo:"); console.table(t);
  const rf = rl.filter((r) => r.full);
  if (rf.length) { const tf = {}; for (const r of rf) { tf[r.rl] ??= {}; tf[r.rl][r.full] = (tf[r.rl][r.full] || 0) + 1; } console.log("veredicto del archivo completo (full=) por idioma crudo:"); console.table(tf); }
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
