# Notas internas de mantenimiento (NO commitear)

Fichero local ignorado por git (ver `.gitignore`). Contiene los datos operativos
del proyecto que se han sacado del README público.

## Entornos y despliegue

- Producción:
  - **Worker**: https://hispasubs.ak-forge.workers.dev — Cloudflare Workers → proyecto `hispasubs` (cuenta `the-ak-forge`).
  - **Proxy**: https://hispasubs.vercel.app — proyecto de Vercel con *Root Directory* en la raíz del repo; despliega solo con cada `push` a `main`.
- Despliegue del Worker: `npx wrangler deploy` (lee `wrangler.toml`; requiere sesión `wrangler login` o `CLOUDFLARE_API_TOKEN`).
- `wrangler.toml` fija `workers_dev = true` y `preview_urls = false` (sin variantes `*.preview`).
- Proxy: `vercel.json` usa `functions` + `rewrites` (enrutado `/` y `/proxy?...` a la función, excluye `/api/`) y `maxDuration: 60` s por invocación.

### Checklist post-despliegue

1. `hispasubs.ak-forge.workers.dev/manifest.json` → versión nueva y sin bloque `stremioAddonsConfig`.
2. `hispasubs.vercel.app/api/proxy` (sin parámetros) → 200 con el JSON amigable; con el enrutado viejo devolvía 400, así que distingue despliegue nuevo de antiguo.
3. `/subtitles/movie/tt0111161.json` → 200, entradas presentes y cabecera `Cache-Control: public, max-age=7200`.
4. En Stremio, reinstalar el addon desde `/configure` para que coja el manifest nuevo (el cliente lo cachea).

### Rollback en paneles (sin git)

- **Cloudflare** → Workers → `hispasubs` → *Versions* → *Rollback* (elegir versión anterior).
- **Vercel** → proyecto del Proxy → *Deployments* → menú "…" → *Promote to Production*.

### Rollback por git (cada versión está en el historial)

```bash
git log --oneline -- worker.js              # localizar la versión
git show <commit>:worker.js > worker.js     # restaurarla
npx wrangler deploy
```

## Historial de versiones publicadas

- Worker: **v1.3.3** (18/10/2026, Rate Limiting nativo via binding `SUBS_RATE_LIMIT`, solo peticiones sin caché, 120 req/60s) · v1.3.2 (logo/favicon migrados a Workers Static Assets → Version ID `57c0b184-cc1b-4232-b7c6-c7ecd148961d`; favicon deja de dar 404; log 403 de SubDL explícito) · v1.3.1 (Version ID `4d25952f-e2b1-4bd4-8cdc-94aebe8c2eec`, commit `e0bf4d0`) · v1.3.0 · v1.2.0 · v1.1.0 · v1.0.1
- Proxy: **v1.0.3** (`api/proxy.js`).
- Nota histórica: la copia `worker.v1.1.0.js` del commit inicial lleva en su cabecera «v1.0.1» aunque su manifest publicaba `1.1.0` (desajuste de la época, sin efecto en producción; se localiza con `git log --diff-filter=A --oneline -- worker.v1.1.0.js`).

## Logo / favicon = Workers Static Assets (no invocan al Worker)

- Los ficheros viven en **`public/`** (`logo.svg`, `favicon.ico`, `_headers`) y se sirven desde el borde **sin ejecutar el Worker**: requests **gratis e ilimitados** (doc oficial: *«Requests to static assets are free and unlimited»*) y **sin eventos en Workers Logs**.
- Declarados en `wrangler.toml` → `[assets] directory = "./public"`. Si una ruta no coincide con un fichero, Cloudflare ejecuta el Worker normalmente (subtitles/manifest/configure siguen en `worker.js`).
- La ruta `/logo.svg` de `worker.js` queda como **fallback muerto** (el asset se sirve antes); cambios ahí de código no afectan a producción salvo que el asset desaparezca.
- **Cache-Control: `public, max-age=604800`** (7 días) + ETag/304 nativos, definido en `public/_headers`. Si se cambia el logo, tarda hasta 7 días en propagarse entre los navegadores que ya lo cachearon.
- `_headers` añade `Access-Control-Allow-Origin: *` por si algún sitio lo carga vía fetch/canvas.
- **Por qué la Cache API (v1.3.2 inicial) no servía para cuota**: Workers corre *antes* que la caché (doc: *«Cloudflare Workers runs before the Cloudflare cache, the caching of a request still incurs costs»*) → cada HIT seguía contando 1 request de la cota.

### Contexto de tráfico (logs 18/10/2026)

- **52 % del tráfico total** venía con `referer: https://stremio-addons.net/` (489/533 peticiones de `/logo.svg`): la web **hotlinkea** el logo directamente desde el worker en el navegador de cada visitante. 485 IPs distintas = visitantes reales, no un scraper.
- ~37k req/día de logo ≈ **37 % de la cota Free (100k/día)**; con esta migración pasan a **0 %** (solo consumen cuota subtitles/manifest/configure).
- Los países «raros» en logs (Omán, Arabia Saudí, Turquía, India…) son visitantes del directorio: stremio-addons.net es internacional; los 33 `/manifest.json` con ese referer son **instalaciones reales** desde 10 países.
- Si el tráfico del logo volviera a contar contra cuota (o Cloudflare cambiase la política), opción de respaldo: pedir a stremio-addons.net que aloje el logo localmente.

## Firma del manifest (stremio-addons.net)

- La **v1.2.0** publicaba un bloque `stremioAddonsConfig` con una firma generada para el manifest de esa versión.
- Desde la **v1.3.0** la firma dejó de validar: cubre el manifest byte a byte (incluye `version` y `logo`, que además depende del host).
- En la **v1.3.1** se eliminó (una firma inválida es peor que ninguna; el addon se instala igual sin ella).
- Para regenerarla: publicar el manifest actual desde https://stremio-addons.net y pegar el bloque `stremioAddonsConfig` que devuelva en `getManifest()` (`worker.js`). Regenerarla cada vez que cambien `version`, `logo` o `description`.

## Rate limiting / abuso

- Worker: Binding nativo **`SUBS_RATE_LIMIT`** (`[[ratelimits]]` en `wrangler.toml`, namespace_id 1001, 120 req/60s). Usa `cf-connecting-ip` como clave, solo cuenta peticiones SIN caché. También acepta `RATE_LIMIT` como override (0 = desactivado) vía vars/env (el código lo respeta). En tests/local cae a fallback in-memory.
- Proxy: `RATE_LIMIT_PER_MIN` (variable de entorno en Vercel), por defecto **120** peticiones con `zipUrl` por minuto e IP; `0` = desactivado.
- Con el binding nativo, la regla manual del panel de Workers ya no es necesaria (el límite es global por PoP y comparte estado vía namespace). Se deja documentado por si se quisiera reforzar con WAF (no aplicable a workers.dev).
- **CGNAT**: si algún usuario reporta `429` (fibra móvil comparte IP), subir el umbral, no desactivar por completo.

## Credenciales (nunca commitear ni compartir)

- `git push` usa un PAT fine-grained guardado en el **Keychain de macOS**: repo solo `hispasubs`, permisos *Contents* + *Workflows* (Read and write). Caduca a los 90 días; cuando pase, `git push` fallará hasta generar uno nuevo (GitHub → Settings → Developer settings → Fine-grained tokens) y guardarlo en el Keychain (borrar la entrada antigua de Llavero o `git credential-osxkeychain erase`).
- El MCP de GitHub de esta sesión actúa como `the-ak-forge` pero en modo lectura y sin scope `workflow`: sirve para verificar estado, no para escribir.
- Cloudflare: sesión con `wrangler login` en este mac.
