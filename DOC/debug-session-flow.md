# Debug Session Flow

Este documento define el flow de trabajo para sesiones largas de debug en este repo.

## Intención

- Vamos a trabajar en modo fixes/debug profundo.
- Vamos a reiniciar `dev` frecuentemente después de cambios.
- Vamos a usar este documento como memoria operativa entre sesiones.

## Reglas de sesión

1. Al arrancar una nueva sesión, leer este documento antes de seguir.
2. Trabajar con foco en reproducir, aislar, corregir y verificar.
3. Después de cada cambio relevante:
   - reiniciar `dev`
   - verificar logs
   - probar el caso puntual
4. Cuando el usuario diga `cerrar sesión`:
   - actualizar este documento
   - dejar estado actual, hallazgos, fixes aplicados y próximos pasos

## Flow operativo

1. Reproducir el bug.
2. Confirmar si el problema es:
   - persistencia
   - runtime/window host
   - shell compartido
   - wiring específico de una ventana
3. Aplicar fix mínimo en la base compartida cuando sea reusable.
4. Reiniciar `dev`.
5. Validar con logs y prueba manual.
6. Si queda algo abierto, documentarlo acá.

## Convenciones

- `run dev` o `start dev`: levantar la app limpia.
- `cerrar sesión`: persistir resumen de la sesión en este archivo.
- Si un bug afecta varias ventanas, priorizar fix en framework/base.
- Si un bug es específico, dejar explícito por qué no va a la base.

## Estado inicial

- Documento creado para usar como memoria de sesiones de debug profundas.
- Próxima acción al retomar: leer este archivo y continuar desde el último estado documentado.

## Cierre de sesión - 2026-03-13

### Contexto de trabajo

- Sesión enfocada en ventanas custom, resize, persistencia de frame y hotkeys/chords.
- Se trabajó con reinicios frecuentes de `dev` y validación por logs.

### Hallazgos principales

- `open chat` tenía problemas de host transparente con resize/hit-testing.
- El sistema de chords dejaba suffix keys registradas después de ejecutar una chord.
- El flujo de feedback abría procesos de PowerShell visibles.
- La persistencia de frame existía, pero estaba distribuida entre ventanas y helper base.
- `picker` guardaba bien durante resize/move, pero al cerrar podía sobrescribirse con un frame degradado.
- La persistencia en disco del `picker` quedó confirmada en `%APPDATA%\\assistant\\settings.json`.
- Si una ventana no tenía frame válido, faltaba una política más robusta de fallback/centrado desde la base.

### Fixes aplicados

- `open chat` migrado a host opaco para evitar click-through/transparent resize artifacts.
- Ventanas principales migradas al shell compartido.
- Fix de chords:
  - limpieza completa de suffix temporales después de ejecutar una chord
  - evita ejecuciones accidentales posteriores al primer trigger
- PowerShell de feedback/toasts oculto con flags de spawn y `-WindowStyle Hidden`.
- Latencia de captura reducida en `ffi.ts`:
  - menos sleeps
  - menos reintentos
  - mejor respuesta de hotkeys `Alt+R,*`
- Persistencia centralizada:
  - agregado `createPersistentCustomWindow(...)`
  - `chat`, `settings`, `editor` y `picker` usan helper compartido
- Fix de close persist:
  - `window-state.ts` ahora usa último frame válido observado al cerrar
  - evita que `picker` vuelva a `520x360` al cerrar
- Fallback robusto de frame:
  - si el frame está en default, se centra
  - si está fuera de pantalla, se centra
  - si el tamaño es demasiado grande para el monitor actual, se ajusta

### Commits/push relevantes

- `4f8e482` `Fix hotkey chord cleanup and reduce prompt latency`
- `ee5f140` `Centralize window frame persistence and fallback sizing`
- push realizado a `launchpad/main`

### Estado actual al cerrar

- `dev` fue usado y reiniciado varias veces durante la sesión.
- Se reseteó `%APPDATA%\\assistant\\settings.json` a defaults de ventanas para probar fallback limpio.
- El último objetivo abierto es seguir verificando que todas las ventanas:
  - restauren tamaño/posición correcto
  - arranquen centradas si no hay frame útil
  - no se degraden al cerrar/reabrir

### Próximos pasos sugeridos al retomar

1. Leer este documento.
2. Levantar `dev`.
3. Probar, una por una:
   - `Prompt Picker`
   - `Prompt Editor`
   - `Settings`
   - `Open Chat`
4. Validar:
   - resize
   - close/reopen
   - restart app
   - frame restaurado
5. Si algo falla:
   - mirar `latest.log`
   - distinguir persistencia vs aplicación de frame vs runtime host
