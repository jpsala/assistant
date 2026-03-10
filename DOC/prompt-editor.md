# Prompt Editor

[Inicio](README.md) | [Qué es Assistant](que-es-assistant.md) | [Features](features.md) | [Open Chat](open-chat.md) | [Prompt Picker](prompt-picker.md) | [Settings](settings.md) | [Ejemplos de uso](ejemplos-de-uso.md)

`Prompt Editor` sirve para crear y mantener prompts locales.

Los prompts se guardan como archivos Markdown.

Ubicación:

- `%APPDATA%\\assistant\\prompts`

## Qué podés hacer

- crear un prompt nuevo
- editar un prompt existente
- borrar un prompt
- asignar un hotkey
- elegir provider
- elegir model

## Formato de un prompt

Ejemplo:

```md
@name:Fix Writing
@hotkey:Alt+Shift+F
@provider:openrouter
@model:anthropic/claude-sonnet-4-5

Rewrite the selected text so it is clearer, cleaner and more concise.
```

## Metadatos soportados

- `@name`
- `@hotkey`
- `@provider`
- `@model`
- `@category`
- `@confirm`

## Cómo crear un prompt útil

Recomendaciones:

- que el nombre sea corto
- que el cuerpo diga exactamente qué hacer
- que no dependa de contexto innecesario
- que tenga un hotkey si lo usás mucho

## Ejemplos

### Prompt para mails

```md
@name:Improve Email

Rewrite the selected email so it sounds clear, professional and concise.
```

### Prompt para código

```md
@name:Explain Code

Explain the selected code as if you were helping a junior developer.
```

### Prompt para resumen

```md
@name:Summarize

Summarize the selected text in 5 bullet points.
```

## Ver También

- [Prompt Picker](prompt-picker.md)
- [Settings](settings.md)
- [Ejemplos de uso](ejemplos-de-uso.md)
