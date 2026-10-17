const express = require('express');
const cors = require('cors');
const axios = require('axios');
const AdmZip = require('adm-zip');

const app = express();
app.use(cors());

const DICT_ES = /\b(vosotros|ordenador|coche|gilipollas|hostia|hostias|chaval|follar|joder|guay|móvil|patata|zumo|aparcar|conducir|enfadar|nevera|chico|tío|tía)\b/gi;
const DICT_LAT = /\b(computadora|carro|auto|pendejo|chingar|platicar|celular|jugo|estacionar|manejar|enojar|refrigerador|ustedes|chavo|wey|güey|neta)\b/gi;

const ADDON_LOGO = "https://img.icons8.com/fluency/512/subtitles.png";
const LOGO_SVG = `<svg width="80" height="80" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="20" width="80" height="60" rx="10" fill="#00d2ff" fill-opacity="0.2" stroke="#00d2ff" stroke-width="4"/><rect x="25" y="45" width="20" height="8" rx="4" fill="#00d2ff"/><rect x="55" y="45" width="20" height="8" rx="4" fill="#00d2ff"/><rect x="35" y="60" width="30" height="8" rx="4" fill="#00d2ff"/></svg>`;

const getConfigureHTML = (host, existingConfig = {}) => `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Configuración | HispaSubs</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background-color: #121212; color: #ffffff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .container { background-color: #1e1e1e; padding: 40px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); max-width: 500px; width: 100%; text-align: center; }
        h1 { margin-top: 10px; color: #00d2ff; font-size: 28px; }
        p { color: #aaaaaa; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
        .form-group { text-align: left; margin-bottom: 20px; }
        label { display: block; margin-bottom: 8px; font-weight: bold; font-size: 14px; }
        input { width: 100%; padding: 12px; border: 1px solid #333; border-radius: 6px; background-color: #2a2a2a; color: #fff; box-sizing: border-box; font-family: monospace; }
        input:focus { outline: none; border-color: #00d2ff; }
        .btn-container { display: flex; flex-direction: column; gap: 10px; margin-top: 15px; }
        button { font-size: 16px; font-weight: bold; border-radius: 6px; cursor: pointer; width: 100%; padding: 14px 24px; transition: all 0.3s; }
        .btn-primary { background-color: #00d2ff; color: #121212; border: none; }
        .btn-primary:hover { background-color: #00a8cc; transform: translateY(-2px); }
        .btn-secondary { background-color: transparent; color: #00d2ff; border: 2px solid #00d2ff; }
    </style>
</head>
<body>
    <div class="container">
        <div>${LOGO_SVG}</div>
        <h1>HispaSubs</h1>
        <p>Motor de descompresión Node.js activo. SubDL procesado en memoria.</p>
        <div class="form-group">
            <label>SubDL API Key (Opcional - Expande catálogo)</label>
            <input type="text" id="subdlKey" placeholder="ej: abc123def456..." value="${existingConfig.subdlKey || ''}">
        </div>
        <div class="btn-container">
            <button class="btn-primary" onclick="installAddon()">Instalar en Stremio</button>
            <button class="btn-secondary" id="copyBtn" onclick="copyManifest()">Copiar URL del Manifest</button>
        </div>
    </div>
    <script>
        function getManifestUrl(protocol) {
            const config = { subdlKey: document.getElementById('subdlKey').value.trim() };
            if (!config.subdlKey) return protocol + '://' + window.location.host + '/manifest.json';
            const base64Config = btoa(JSON.stringify(config)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
            return protocol + '://' + window.location.host + '/' + base64Config + '/manifest.json';
        }
        function installAddon() { window.location.href = getManifestUrl('stremio'); }
        function copyManifest() {
            const url = getManifestUrl('https');
            navigator.clipboard.writeText(url);
            document.getElementById('copyBtn').innerText = '¡Copiado! ✓';
        }
    </script>
</body>
</html>
`;

const getManifest = (config) => ({
  id: "org.hispasubs.addon",
  version: "4.0.0",
  name: "HispaSubs",
  description: `Motor Node.js + Extractor ZIP. OS V3 | SubDL: ${config.subdlKey ? '✅' : '❌'}`,
  logo: ADDON_LOGO,
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: true }
});

const parseConfig = (configStr) => {
  if (!configStr) return {};
  try {
    let base64 = configStr.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    if (pad) base64 += '='.repeat(4 - pad);
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  } catch (e) { return {}; }
};

// --- SCRAPERS ---
const getOpenSubtitlesV3 = async (type, fullId) => {
  try {
    const { data } = await axios.get(`https://opensubtitles-v3.strem.io/subtitles/${type}/${fullId}.json`, { timeout: 2500 });
    return (data.subtitles || [])
      .filter(sub => (sub.lang || "").toLowerCase().includes("spa") || sub.lang === "es")
      .map(sub => ({ id: sub.id, url: sub.url, lang: "spa", source: "OS-V3" }));
  } catch (e) { return []; }
};

const getSubDL = async (imdbId, season, episode, apiKey) => {
  if (!apiKey) return [];
  try {
    let url = `https://api.subdl.com/api/v1/subtitles?api_key=${apiKey}&imdb_id=${imdbId}&languages=ES`;
    if (season && episode) url += `&season_number=${season}&episode_number=${episode}`;
    const { data } = await axios.get(url, { timeout: 2500 });
    if (!data.subtitles) return [];
    
    return data.subtitles.map(sub => {
      let dlUrl = sub.url;
      if (dlUrl.startsWith('//')) dlUrl = 'https:' + dlUrl;
      else if (!dlUrl.startsWith('http')) dlUrl = 'https://dl.subdl.com' + dlUrl;
      return { id: `sdl_${sub.file_id || Math.random()}`, url: dlUrl, lang: "spa", source: "SubDL" };
    });
  } catch (e) { return []; }
};

// --- EL ANALIZADOR NODE.JS ---
const classifySubtitle = async (sub, host) => {
  let isZip = sub.url.toLowerCase().includes(".zip");
  // Aseguramos que todo archivo zip apunte siempre al proxy, incluso si el análisis falla.
  let finalUrl = isZip ? `https://${host}/proxy?zipUrl=${encodeURIComponent(sub.url)}` : sub.url;

  try {
    let text = "";
    if (isZip) {
      const response = await axios.get(sub.url, { responseType: 'arraybuffer', timeout: 2000 });
      const zip = new AdmZip(response.data);
      const zipEntries = zip.getEntries();
      const srtEntry = zipEntries.find(entry => entry.entryName.toLowerCase().endsWith('.srt'));
      if (srtEntry) text = zip.readAsText(srtEntry, 'utf8');
    } else {
      const response = await axios.get(sub.url, { timeout: 1500 });
      text = response.data;
    }

    const esMatches = (text.match(DICT_ES) || []).length;
    const latMatches = (text.match(DICT_LAT) || []).length;
    
    let flag = "🌎 Neutro";
    if (esMatches > latMatches + 2) flag = "🇪🇸 Castellano";
    else if (latMatches > esMatches + 2) flag = "🇲🇽 Latino";

    return { id: sub.id, url: finalUrl, lang: `${flag} (${sub.source})` };
  } catch (error) {
    return { id: sub.id, url: finalUrl, lang: `🇪🇸/🇲🇽 Genérico (${sub.source})` };
  }
};

// --- EL PROXY EXTRACTOR DE ZIP PARA STREMIO ---
app.get('/proxy', async (req, res) => {
  const zipUrl = req.query.zipUrl;
  if (!zipUrl) return res.status(400).send("No zipUrl provided");
  
  try {
    const response = await axios.get(zipUrl, { responseType: 'arraybuffer', timeout: 4000 });
    const zip = new AdmZip(response.data);
    const srtEntry = zip.getEntries().find(entry => entry.entryName.toLowerCase().endsWith('.srt'));
    
    if (srtEntry) {
      const srtContent = zip.readAsText(srtEntry, 'utf8');
      res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
      res.send(srtContent);
    } else {
      res.status(404).send("No SRT inside ZIP");
    }
  } catch (err) {
    res.status(500).send("Error proxying Zip file");
  }
});

// --- RUTAS DE STREMIO (CORREGIDAS Y EXPLÍCITAS) ---
app.get('/', (req, res) => res.send(getConfigureHTML(req.get('host'))));
app.get('/configure', (req, res) => res.send(getConfigureHTML(req.get('host'))));
app.get('/:config/configure', (req, res) => {
  res.send(getConfigureHTML(req.get('host'), parseConfig(req.params.config)));
});

app.get('/manifest.json', (req, res) => res.json(getManifest({})));
app.get('/:config/manifest.json', (req, res) => {
  res.json(getManifest(parseConfig(req.params.config)));
});

const handleSubtitles = async (req, res, config) => {
  try {
    const type = req.params.type;
    const fullId = req.params.id.replace('.json', '');
    const [imdbId, season, episode] = fullId.split(':');

    const [osSubs, sdlSubs] = await Promise.allSettled([
      getOpenSubtitlesV3(type, fullId),
      getSubDL(imdbId, season, episode, config.subdlKey)
    ]);

    let rawSubs = [];
    if (osSubs.status === 'fulfilled') rawSubs.push(...osSubs.value);
    if (sdlSubs.status === 'fulfilled') rawSubs.push(...sdlSubs.value);

    if (rawSubs.length === 0) {
      return res.json({ subtitles: [{ id: "diag_1", url: "https://pastebin.com/raw/empty", lang: "⚠️ 0 Resultados" }] });
    }

    // Limitamos a 4 para garantizar que Vercel responda a Stremio en menos de 3 segundos
    const subsToAnalyze = rawSubs.slice(0, 4);
    const unanalyzedSubs = rawSubs.slice(4).map(s => {
      let finalUrl = s.url;
      if (s.url.toLowerCase().includes(".zip")) {
        finalUrl = `https://${req.get('host')}/proxy?zipUrl=${encodeURIComponent(s.url)}`;
      }
      return { id: s.id, url: finalUrl, lang: `🇪🇸/🇲🇽 Genérico (${s.source})` };
    });

    const analyzedSubs = await Promise.all(subsToAnalyze.map(sub => classifySubtitle(sub, req.get('host'))));
    res.json({ subtitles: [...analyzedSubs, ...unanalyzedSubs] });

  } catch (err) {
    res.json({ subtitles: [] });
  }
};

// Rutas explícitas para evitar el bug del parámetro opcional :config
app.get('/subtitles/:type/:id', (req, res) => handleSubtitles(req, res, {}));
app.get('/:config/subtitles/:type/:id', (req, res) => handleSubtitles(req, res, parseConfig(req.params.config)));

module.exports = app;