# Assistant

App de Windows hecha con Bun + Electrobun para ejecutar prompts sobre texto seleccionado, abrir un chat contextual y administrar prompts locales.

## Qué hace

- reemplaza texto seleccionado usando prompts guardados
- abre un picker de prompts con teclado
- abre un chat contextual tomando la seleccion actual
- guarda prompts como archivos Markdown editables
- muestra feedback visual con un custom tooltip
- recuerda posicion y tamaño de las ventanas principales

## Ventanas principales

### Open Chat

Abre una ventana de chat y toma el texto seleccionado como contexto.

Qué podés hacer:

- ver el texto original en `Original Text`
- escribir instrucciones libres
- usar `/nombre-del-prompt` en la primera linea para aplicar un prompt guardado como system prompt
- copiar la ultima respuesta
- reemplazar el texto seleccionado con la ultima respuesta

Ejemplo:

```text
/fix-writing
Reescribilo para que suene mas claro y mas corto.
```

Flujo:

1. Seleccioná texto en cualquier app.
2. Abrí `Open Chat` desde el tray o por hotkey.
3. Escribí tu instruccion.
4. Usá `Replace Selected Text` si querés pegar el resultado sobre la seleccion original.

### Prompt Picker

Abre un buscador de prompts para correrlos directamente sobre la seleccion actual.

Qué podés hacer:

- buscar por nombre
- navegar con teclado
- ejecutar un prompt sobre el texto seleccionado

Ejemplo:

1. Seleccioná un mail.
2. Abrí el picker.
3. Elegí `improve-email`.
4. La app genera el texto y reemplaza la seleccion.

### Prompt Editor

Permite crear, editar y borrar prompts guardados en Markdown.

Cada prompt puede tener metadatos como:

- `@name`
- `@hotkey`
- `@provider`
- `@model`
- `@category`
- `@confirm`

Ejemplo:

```md
@name:Fix Writing
@hotkey:Alt+Shift+F
@provider:openrouter
@model:anthropic/claude-sonnet-4-5

Rewrite the selected text so it is clearer, cleaner and more concise.
```

### Settings

Permite configurar:

- provider por default
- modelo por default
- API keys
- max tokens
- hotkeys del sistema

Las ventanas `chat`, `picker`, `settings` y `editor` recuerdan `x/y/w/h` entre sesiones.

## Hotkeys

Defaults actuales:

- `Open Chat`: `Alt+Shift+W`
- `Prompt Picker`: `Alt+Shift+Space`

También podés asignar hotkeys por prompt, incluidos chords.

Ejemplos válidos:

- `Alt+Shift+F`
- `!+f`
- `Alt+T -> Y`
- `!t,y`

El tray muestra el hotkey configurado para `Open Chat` y `Prompt Picker`.

## Cómo se usan los prompts

Los prompts viven en `%APPDATA%\\assistant\\prompts`.

Formato:

```md
@name:Summarize
@hotkey:Alt+Shift+S
@provider:openrouter
@model:anthropic/claude-sonnet-4-5

Summarize the selected text in 5 bullet points.
```

Notas:

- si no definís `@provider` o `@model`, usa lo configurado en Settings
- `@confirm:true` se parsea, pero hoy todavia no tiene flujo implementado

## Feedback visual

La app usa un custom tooltip propio para mostrar:

- procesamiento
- exito
- error

No hay selector de estilo: el modo activo y unico es el custom tooltip.

## Estructura de datos del usuario

Se guarda en `%APPDATA%\\assistant`:

- `settings.json`
- `prompts\\*.md`
- `logs\\latest.log`

## Desarrollo

Scripts:

```powershell
bun run dev
bun run build
```

Si `bun run build` falla con `EPERM: operation not permitted, rmdir`, cerrá antes la app en ejecucion porque suele quedar bloqueando archivos dentro de `build/dev-win-x64`.

## Limitaciones conocidas

- `@confirm:true` todavia no abre una confirmacion real
- no hay accion de undo visible para un replace ya hecho
- las API keys se guardan en `settings.json`

## Resumen rapido de uso

1. Configurá tu provider, modelo y API key en Settings.
2. Seleccioná texto en cualquier app Windows.
3. Usá `Prompt Picker` para correr un prompt rapido o `Open Chat` para iterar.
4. Si el resultado te sirve, reemplazá la seleccion o copiá la ultima respuesta.
