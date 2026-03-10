# Ejemplos De Uso

[Inicio](README.md) | [Qué es Assistant](que-es-assistant.md) | [Features](features.md) | [Open Chat](open-chat.md) | [Prompt Picker](prompt-picker.md) | [Prompt Editor](prompt-editor.md) | [Settings](settings.md)

Esta guía junta ejemplos concretos de tareas reales.

## Ejemplo 1: mejorar un mensaje

Texto original:

```text
che, fijate si podes mandar eso hoy porque estamos medio justos con los tiempos
```

Flujo recomendado:

1. seleccionar texto
2. abrir `Prompt Picker`
3. ejecutar `fix-writing`

Resultado esperado:

```text
¿Podés revisar si podés enviar eso hoy? Estamos bastante justos con los tiempos.
```

## Ejemplo 2: resumir una nota larga

Texto original:

```text
Documento con varias secciones, decisiones, pendientes y contexto.
```

Flujo recomendado:

1. seleccionar texto
2. abrir `Prompt Picker`
3. ejecutar `summarize`

Resultado esperado:

- una versión corta y clara

## Ejemplo 3: responder un mail

Flujo recomendado:

1. seleccionar el mail recibido
2. abrir `Open Chat`
3. escribir:

```text
Escribí una respuesta cordial, concreta y profesional.
```

Resultado esperado:

- un borrador listo para pegar

## Ejemplo 4: traducir un mensaje

Flujo recomendado:

1. seleccionar texto en español
2. abrir `Open Chat`
3. escribir:

```text
/translate-english
Quiero que suene natural, no literal.
```

Resultado esperado:

- una versión en inglés más natural

## Ejemplo 5: insertar texto nuevo sin selección

Flujo recomendado:

1. abrir `Open Chat` sin seleccionar nada
2. escribir:

```text
Escribí tres opciones de asunto para un mail donde reprogramo una reunión.
```

3. generar la respuesta
4. usar `Paste in Source App`

Resultado esperado:

- las opciones se pegan en la app original

## Ver También

- [Open Chat](open-chat.md)
- [Prompt Picker](prompt-picker.md)
- [Prompt Editor](prompt-editor.md)
