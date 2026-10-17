# HispaSubs 🇲🇽 🇪🇸

> Clasificador inteligente de dialectos en subtítulos en español para Stremio.

**HispaSubs** soluciona la clásica frustración al reproducir contenido en español: elegir un subtítulo catalogado genéricamente como "Español" y notar a mitad de la reproducción que contiene modismos o conjugaciones de una región distinta a la esperada.

El complemento inspecciona el contenido textual de los subtítulos en tiempo real, detecta modismos regionales mediante expresiones regulares optimizadas y clasifica cada pista de forma clara en la interfaz del reproductor.

---

## ✨ Características principales

- **Clasificación léxica en tiempo real:** Diferencia automáticamente entre:
  - 🇲🇽 **Latino:** Detección de vocabulario, pronombres y modismos comunes de América Latina (*ustedes, celular, carro, manejar, enojar...*).
  - 🇪🇸 **Castellano:** Detección de conjugaciones y giros propios de España (*vosotros, ordenador, coche, conducir, enfadar...*).
  - 🌎 **Neutro:** Pistas con un balance neutro o ausencia de localismos marcados.
- **Sin configuración obligatoria:** Incluye soporte predeterminado para **OpenSubtitles V3**. Instala y reproduce al instante.
- **Integración opcional con SubDL:** Permite añadir tu propia clave API gratuita de SubDL para ampliar el catálogo. Incluye descompresión automática en memoria de archivos comprimidos (`.zip` a `.srt`) sin cortes ni errores de formato.
- **Privacidad y velocidad:** Ejecución ligera en el Edge diseñada para responder en milisegundos sin almacenar datos ni credenciales del usuario.

---

## 🚀 Instalación

1. Entra al portal de configuración: [Configurar HispaSubs](https://hispasubs.ak-forge.workers.dev)
2. *(Opcional)* Ingresa tu clave API de [SubDL](https://subdl.com).
3. Haz clic en **Instalar en Stremio** o utiliza el botón **Copiar URL del Manifest** para añadirlo manualmente en tu cliente preferido.

---

## 🛠️ Arquitectura técnica

El proyecto utiliza un diseño modular dividido en dos capas:

* **Capa Edge (Cloudflare Workers):** Gestión de rutas, resolución de manifiesto, consultas paralelas a proveedores y evaluación léxica ultrarrápida.
* **Capa Proxy / Extractor (Node.js con Express):** Servidor auxiliar encargado de descargar y extraer los paquetes `.zip` de SubDL en memoria RAM (`adm-zip`), entregando al reproductor cabeceras puras de subtítulos `.srt`.
* **Protocolo:** Stremio Addon Protocol v3.

---

## 📄 Licencia

Este proyecto está publicado bajo la [Licencia MIT](LICENSE).
