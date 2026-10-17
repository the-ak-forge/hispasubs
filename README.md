# HispaSubs 🇲🇽 🇪🇸

> Clasificador inteligente de subtítulos en español para Stremio

HispaSubs te ayuda a identificar rápidamente si un subtítulo está orientado a España, Latinoamérica o si es neutral. Evita el problema clásico de activar un archivo marcado como “Español” y descubrir, a mitad de la reproducción, que está escrito con un vocabulario regional muy distinto al que esperabas.

El complemento analiza el texto de los subtítulos en tiempo real, detecta expresiones, pronombres y modismos propios de cada región, y clasifica cada pista de forma clara para que puedas elegir el idioma con mejor ajuste a tu audiencia o preferencia.

---

## ✨ Características

- Clasificación léxica en tiempo real
  - 🇲🇽 Latino: detecta vocabulario, pronombres y expresiones comunes de América Latina (`ustedes`, `celular`, `carro`, `manejar`, `enojar`, etc.).
  - 🇪🇸 Castellano: detecta conjugaciones y giros propios de España (`vosotros`, `ordenador`, `coche`, `conducir`, `enfadar`, etc.).
  - 🌎 Neutro: identifica subtítulos con vocabulario equilibrado o sin localismos marcados.

- Sin configuración obligatoria
  - Incluye soporte predeterminado para OpenSubtitles V3.
  - Instala y usa el complemento casi de inmediato.

- Integración opcional con SubDL
  - Puedes añadir tu clave API gratuita de SubDL para ampliar el catálogo de subtítulos.
  - Incluye extracción automática en memoria de archivos comprimidos (`.zip`) para un flujo más rápido y eficiente.

- Privacidad y rendimiento
  - Ejecuta la lógica en Edge con baja latencia.
  - No almacena datos ni credenciales del usuario.
  - Diseñado para responder en milisegundos.

---

## 🚀 Instalación

1. Abre la configuración del complemento:
   [Configurar HispaSubs](https://hispasubs.ak-forge.workers.dev)

2. (Opcional) Agrega tu clave API de [SubDL](https://subdl.com)

3. Haz clic en:
   - **Instalar en Stremio**, o
   - **Copiar URL del Manifest** para añadirlo manualmente en tu cliente preferido.

### Requisitos

- Un cliente Stremio compatible.
- Acceso a Internet para descargar subtítulos.
- (Opcional) Cuenta en SubDL para ampliar resultados.

---

## 🧠 ¿Cómo funciona?

HispaSubs inspecciona el contenido textual de cada subtítulo e identifica patrones lingüísticos con expresiones regulares optimizadas. A partir de esos patrones, clasifica cada pista como:

- Latino
- Castellano
- Neutro

Esto permite distinguir entre versiones del español con matices regionales sin depender de metadatos ambiguos o genéricos.

---

## 🏗️ Arquitectura técnica

El proyecto sigue un diseño modular con dos capas principales:

- Capa Edge (Cloudflare Workers)
  - Gestiona rutas, resolución de manifiestos, consultas paralelas y evaluación léxica ultrarrápida.

- Capa Proxy / Extractor
  - Descarga y extrae paquetes `.zip` de SubDL en memoria RAM usando `adm-zip`.
  - Entrega al reproductor subtítulos `.srt` limpios y listos para uso.

- Protocolo
  - Stremio Addon Protocol v3

---

## 📦 Casos de uso

- Ver contenido latino con subtítulos que reflejen vocabulario y expresiones propias del idioma de América Latina.
- Ver contenido español con subtítulos en castellano sin confusiones con variantes americanas.
- Elegir mejor un archivo “Español” cuando el texto del subtítulo es claramente más cercano a una región concreta.

---

## 🛠️ Solución de problemas

### Los subtítulos siguen apareciendo como “Español” genérico
Esto puede ocurrir si el archivo no contiene suficientes marcadores regionales o si el subtítulo es muy neutro. En esos casos, la detección puede resultar menos precisa.

### Quiero ampliar el catálogo
Puedes añadir una clave API de SubDL para acceder a más fuentes y ampliar tus resultados.

### ¿Puedo usarlo sin configuración?
Sí. La configuración predeterminada para OpenSubtitles V3 ya debería funcionar en la mayoría de casos.

---

## 📄 Licencia

Este proyecto está publicado bajo la [Licencia MIT](LICENSE).

---

## 🤝 Contribuciones

Si quieres colaborar, puedes:

- reportar errores,
- sugerir mejoras en la detección léxica,
- proponer nuevos patrones de regionalización,
- mejorar la documentación o la experiencia de instalación.

---

## 🔗 Enlaces útiles

- [Configurar HispaSubs](https://hispasubs.ak-forge.workers.dev)
- [SubDL](https://subdl.com)
- [Repositorio GitHub](https://github.com/the-ak-forge/hispasubs)
