const express = require('express');
const cors = require('cors');
const axios = require('axios');
const AdmZip = require('adm-zip');

const app = express();
app.use(cors());

// DOMINIOS PERMITIDOS PARA DESCOMPRESIÓN (Mitigación SSRF/Open Proxy)
const ALLOWED_HOSTS = [
  'dl.subdl.com',
  'opensubtitles.org',
  'opensubtitles.com'
];

app.get('/proxy', async (req, res) => {
  const zipUrl = req.query.zipUrl;
  
  if (!zipUrl) {
    return res.status(400).send("Bad Request: Se requiere el parámetro 'zipUrl'.");
  }

  try {
    const targetUrl = new URL(zipUrl);
    // Verificamos si el hostname termina en alguno de los dominios permitidos
    const isAllowed = ALLOWED_HOSTS.some(host => targetUrl.hostname === host || targetUrl.hostname.endsWith('.' + host));
    
    if (!isAllowed) {
      return res.status(403).send("Forbidden: Dominio no autorizado.");
    }

    const response = await axios.get(zipUrl, { 
      responseType: 'arraybuffer', 
      timeout: 5000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    
    const zip = new AdmZip(response.data);
    const srtEntry = zip.getEntries().find(entry => entry.entryName.toLowerCase().endsWith('.srt'));
    
    if (srtEntry) {
      const srtContent = zip.readAsText(srtEntry, 'utf8');
      res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(srtContent);
    } else {
      res.status(404).send("Not Found: No se encontró un archivo .srt dentro del ZIP.");
    }
    
  } catch (err) {
    res.status(500).send("Internal Server Error: No se pudo proxyear y descomprimir el archivo.");
  }
});

app.get('/', (req, res) => {
  res.send("HispaSubs Vercel Proxy Engine V1.0.1 is online.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HispaSubs proxy corriendo en puerto ${PORT}`);
});

module.exports = app;