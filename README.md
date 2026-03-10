# Assistant

Assistant es una app de Windows para trabajar sobre texto seleccionado usando prompts y chat contextual.

La idea es simple: seleccionás texto en cualquier aplicación, llamás a Assistant con un hotkey y decidís si querés transformar ese texto con un prompt, iterar en un chat, o guardar el resultado para usarlo después.

Guía rápida online:

- `https://md.jpsala.dev/view?guide=ai-assistant&f=DOC/README.md`

## Qué problema resuelve

Si escribís mails, documentación, código, mensajes de Slack, tickets o traducciones, normalmente hacés siempre el mismo ciclo:

1. copiar texto
2. abrir alguna herramienta aparte
3. pegar
4. escribir una instrucción
5. copiar el resultado
6. volver a la app original
7. pegar de nuevo

Assistant reduce ese ida y vuelta.

## Conceptos principales

### Selección

La mayoría de los flujos parten de texto seleccionado en otra app.

Ejemplos:

- un párrafo en Word
- un mail en Outlook
- una función en VS Code
- un mensaje en Slack o Teams

### Prompt

Un prompt es una instrucción reusable guardada como archivo Markdown.

Ejemplos:

- `fix-writing`
- `summarize`
- `translate-english`
- `improve-email`

Cada prompt puede tener:

- nombre
- hotkey
- provider
- model
- cuerpo de instrucción

### Open Chat

Es la ventana para conversar con el modelo usando como contexto el texto seleccionado.

Sirve cuando no querés un resultado directo en un solo paso, sino iterar.

### Prompt Picker

Es la forma más rápida de ejecutar un prompt guardado sobre el texto actual.

Sirve para acciones repetitivas.

### Prompt Editor

Es donde creás y editás prompts propios.

### Settings

Es donde configurás:

- provider por default
- model por default
- API keys
- hotkeys
- `Launch on Login`

## Cómo funciona en la práctica

### Flujo 1: corregir o reescribir un texto

1. Seleccionás texto en cualquier app.
2. Abrís `Prompt Picker`.
3. Elegís `fix-writing`.
4. Assistant genera una versión mejorada.
5. El texto seleccionado se reemplaza.

Ejemplo de uso:

```text
Texto original:
"Hi, just checking if you saw my last mail because maybe we need to move fast on this."

Resultado:
"Hi, just checking whether you saw my last email. We may need to move quickly on this."
```

### Flujo 2: resumir algo largo

1. Seleccionás un texto largo.
2. Abrís `Prompt Picker`.
3. Elegís `summarize`.
4. Assistant devuelve una versión corta.

Útil para:

- mails largos
- PR descriptions
- documentación
- reuniones transcritas

### Flujo 3: usar chat con contexto

1. Seleccionás texto.
2. Abrís `Open Chat`.
3. Escribís una instrucción libre.
4. Iterás hasta que el resultado te sirva.
5. Usás:
   - `Copy Latest`
   - `Paste in Source App`
   - `Replace Selected Text`

Ejemplo:

```text
/fix-writing
Reescribilo para que suene más claro, más corto y más profesional.
```

Otro ejemplo:

```text
Explicame este código como si estuvieras ayudando a un developer junior.
```

### Flujo 4: insertar texto sin haber seleccionado nada

`Open Chat` también sirve aunque no hayas seleccionado texto antes.

Caso típico:

1. abrís `Open Chat`
2. escribís una instrucción
3. generás una respuesta
4. usás `Paste in Source App`

Eso pega la última respuesta en la aplicación original donde estaba el cursor.

## Features principales

### Open Chat

Permite:

- usar la selección actual como contexto
- escribir instrucciones libres
- invocar un prompt al comienzo con `/nombre-del-prompt`
- copiar la última respuesta
- pegar la última respuesta en la app original
- reemplazar la selección original

### Prompt Picker

Permite:

- buscar prompts por nombre
- navegar con teclado
- ejecutar prompts rápido
- reemplazar la selección sin abrir el chat

### Prompt Editor

Permite:

- crear prompts
- editarlos en Markdown
- asignarles hotkeys
- elegir provider/model por prompt

Ejemplo de prompt:

```md
@name:Fix Writing
@hotkey:Alt+Shift+F
@provider:openrouter
@model:anthropic/claude-sonnet-4-5

Rewrite the selected text so it is clearer, cleaner and more concise.
```

### Settings

Permite:

- guardar API keys
- elegir provider por default
- elegir model por default
- configurar hotkeys del sistema
- activar `Launch on Login`

## Hotkeys

Defaults actuales:

- `Open Chat`: `Alt+Shift+W`
- `Prompt Picker`: `Alt+Shift+Space`

También podés definir hotkeys por prompt.

Ejemplos válidos:

- `Alt+Shift+F`
- `!+f`
- `Alt+T -> Y`
- `!t,y`

## Cómo se definen los prompts

Los prompts viven en:

- `%APPDATA%\\assistant\\prompts`

Formato mínimo:

```md
@name:Summarize

Summarize the selected text in 5 bullet points.
```

Formato más completo:

```md
@name:Translate to English
@hotkey:Alt+Shift+E
@provider:openrouter
@model:anthropic/claude-sonnet-4-5

Translate the selected text into natural, concise English.
```

Metadatos soportados hoy:

- `@name`
- `@hotkey`
- `@provider`
- `@model`
- `@category`
- `@confirm`

## Primer uso recomendado

1. Abrí `Settings`.
2. Cargá tu API key.
3. Elegí provider y model.
4. Probá `Open Chat` sobre un texto corto.
5. Probá `Prompt Picker` con `fix-writing` o `summarize`.
6. Si te sirve, activá `Launch on Login`.

## Dónde guarda tus datos

Assistant guarda sus datos de usuario en:

- `%APPDATA%\\assistant\\settings.json`
- `%APPDATA%\\assistant\\prompts\\*.md`
- `%APPDATA%\\assistant\\logs\\latest.log`

## Packaging Windows

Para generar el instalador de Windows:

```powershell
bun run package:win
```

Salida esperada:

- `artifacts/windows-installer/Assistant-Installer.exe`

Guía técnica:

- `docs/windows-release.md`

## Limitaciones conocidas

- `@confirm:true` se parsea, pero todavía no tiene un flujo de confirmación completo
- no hay una acción de undo visible después de un replace
- las API keys se guardan en `settings.json`

## Resumen rápido

1. Seleccioná texto.
2. Abrí `Prompt Picker` para algo rápido o `Open Chat` para iterar.
3. Revisá el resultado.
4. Reemplazá, pegá o copiá la respuesta.
