const express = require('express');
const cors = require('cors');
const axios = require('axios');
const AdmZip = require('adm-zip');

const app = express();
// CORS activado para permitir peticiones desde Cloudflare o Stremio Web
app.use(cors());

// --- ENDPOINT PRINCIPAL: EXTRACTOR DE ZIP AL VUELO ---
app.get('/proxy', async (req, res) => {
  const zipUrl = req.query.zipUrl;
  
  if (!zipUrl) {
    return res.status(400).send("Bad Request: Se requiere el parámetro 'zipUrl'.");
  }
  
  try {
    // 1. Descargamos el archivo .zip en la memoria RAM del servidor
    const response = await axios.get(zipUrl, { 
      responseType: 'arraybuffer', 
      timeout: 5000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    
    // 2. Leemos la estructura del archivo comprimido
    const zip = new AdmZip(response.data);
    
    // 3. Buscamos el primer archivo .srt disponible
    const srtEntry = zip.getEntries().find(entry => entry.entryName.toLowerCase().endsWith('.srt'));
    
    if (srtEntry) {
      // 4. Extraemos el texto crudo y lo enviamos al reproductor con cabeceras de subtítulo
      const srtContent = zip.readAsText(srtEntry, 'utf8');
      res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(srtContent);
    } else {
      res.status(404).send("Not Found: No se encontró un archivo .srt dentro del ZIP.");
    }
    
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).send("Internal Server Error: No se pudo proxyear y descomprimir el archivo.");
  }
});

// Endpoint de salud para verificar que Vercel está encendido
app.get('/', (req, res) => {
  res.send("HispaSubs Vercel Proxy Engine V1.0.0 is online.");
});

// Arrancar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HispaSubs proxy corriendo en puerto ${PORT}`);
});

module.exports = app;