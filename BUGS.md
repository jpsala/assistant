# Estado y pendientes

Actualizado al 9 de marzo de 2026.

## Estado actual

El proyecto ya tiene estas piezas funcionando en la ruta principal:

- tray app con menu y hotkeys visibles
- Prompt Picker con captura de seleccion
- Prompt Editor para crear y editar prompts Markdown
- Settings con provider, modelo, API keys y hotkeys globales
- Open Chat con contexto del texto seleccionado
- replace silencioso sobre la seleccion actual
- custom tooltip propio para estados de proceso, exito y error
- ventanas con drag, resize visible y persistencia de `x/y/w/h`

## Lo que ya no aplica

Estos problemas quedaron fuera de la implementacion activa:

- feedback window basada en `BrowserWindow`
- balloon nativo de Windows como camino principal
- selector de estilos de feedback en Settings

La implementacion vigente usa solo el custom tooltip en [`src/bun/feedback.ts`](/c:/dev/electro-bun-1/src/bun/feedback.ts).

## Pendientes conocidos

## Alta prioridad

1. `@confirm:true` sigue parseado pero no implementado en runtime.
2. `undoReplace()` existe en [`src/bun/replace.ts`](/c:/dev/electro-bun-1/src/bun/replace.ts), pero no hay UX real para dispararlo.
3. La eliminacion de prompts en [`src/bun/prompts.ts`](/c:/dev/electro-bun-1/src/bun/prompts.ts) usa `rm -f` via shell y conviene pasarla a filesystem nativo.

## Validacion pendiente

1. Confirmar en uso real que `Replace Selected Text` desde Open Chat siempre vuelve a la ventana origen correcta.
2. Confirmar que no reaparezcan flashes visuales al abrir `picker`, `settings`, `editor` y `chat`.
3. Confirmar que los hotkeys compuestos funcionen de forma consistente en distintas apps Windows.

## Notas operativas

- Si `bun run build` falla con `EPERM: operation not permitted, rmdir`, casi seguro hay un `electrobun.exe` o `build/dev-win-x64/.../bun.exe` corriendo y bloqueando `build/`.
- El texto seleccionado ya se captura correctamente en `Open Chat`; hubo un problema de encoding en el bridge hacia el webview y ahora se envia como base64 UTF-8.
- Los secrets siguen guardandose en `%APPDATA%\\assistant\\settings.json`; para un paso posterior conviene moverlos a un store mas seguro.
