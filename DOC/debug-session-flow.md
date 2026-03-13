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

## Cambio de foco - 2026-03-13

- Se detectó un issue de arquitectura en chords de dos pasos:
  - si el suffix se presiona muy rápido, a veces la tecla entra en la app activa antes de que Assistant la intercepte
- Se decidió cambiar el foco de trabajo:
  - dejar de perseguir fixes sueltos en hotkeys/chords
  - diseñar e implementar un nuevo servicio de chords/which-key
- Snapshot previo del estado actual:
  - commit `225c701` `Snapshot current hotkey/window work before chord service redesign`
- Documento principal del rediseño:
  - `DOC/chord-service-redesign-plan.md`
- Documento de arranque de próxima sesión:
  - `DOC/next-session-chord-service-kickoff.md`
- Próximo paso de implementación:
  - crear el core `ChordService` como state machine desacoplada del backend nativo

## Cierre de sesión - 2026-03-13 (Chord Service)

### Contexto de trabajo

- Sesión enfocada exclusivamente en el rediseño del subsistema de chords/which-key.
- Se respetó el scope por fases:
  - primero core desacoplado
  - después spike del backend Windows
  - después integración parcial solo para multi-step chords

### Implementado en esta sesión

- Docs de arranque/rediseño consolidados y comiteados.
- Core nuevo `ChordService` implementado como state machine pura:
  - registro/unregister de chords
  - estado `pending`
  - timeout
  - cancelación por `Esc`
  - invalid key handling
  - hint model derivado del estado
- Tests puros agregados para el core.
- `WindowsKeyboardBackend` prototipo implementado con hook global low-level en worker dedicado.
- Integración parcial realizada:
  - singles siguen por `GlobalShortcut`
  - chords multi-step pasan por `ChordService` + backend Windows
- El hook Windows ahora mantiene bindings de chords en el worker y puede consumir el suffix válido en tiempo de hook.

### Hallazgos principales

- El approach previo basado en registrar suffix shortcuts temporales era la fuente real de la carrera.
- Para consumir la segunda tecla a tiempo no alcanzaba con que el main thread conozca el estado:
  - el worker del hook necesitó su propia tabla de bindings/pending state
- `Worker.data` no resultó usable como se asumió inicialmente en este runtime:
  - se reemplazó por sincronización del estado del hook vía `PostThreadMessageW`
- Al reiniciar `dev` desde terminal usando `bun` por nombre, Windows resolvía `bun.ps1`:
  - eso abría el diálogo para elegir app para `.ps1`
  - la solución operativa fue usar el ejecutable real `C:\\Users\\jpsal\\.bun\\bin\\bun.exe`

### Validación realizada

- Tests corridos:
  - `bun test src/bun/chord-service.test.ts src/bun/windows-keyboard-backend.test.ts`
- Build de verificación:
  - `bun build src/bun/index.ts --target bun`
- Sanity checks del backend:
  - start
  - register/unregister bindings
  - stop
- Validación manual final del usuario:
  - `dev` reiniciado correctamente
  - hotkeys funcionando
  - chord rápido validado como “anduvo”

### Commits relevantes de esta sesión

- `90a93e8` `docs: add chord service redesign session plan`
- `1d25b40` `refactor: add chord service core state machine`
- `458168c` `spike: add windows keyboard backend prototype`
- `efaa8f2` `feat: route multi-step chords through chord service`
- `23e2268` `fix: stabilize chord cancellation and invalid-key handling`

### Qué no se tocó

- no se tocó `ffi.ts` para hooks productivos extra fuera de lo necesario para el spike/backend
- no se reabrió trabajo de ventanas/persistencia
- no se migraron los singles al backend nuevo
- no se hizo cleanup final del camino viejo de chords fallback/no-Windows

### Estado actual al cerrar

- El repo quedó limpio.
- El nuevo path de chords está activo para multi-step chords en Windows.
- Singles siguen por el camino anterior.
- La validación manual mínima dio bien después del reinicio correcto de `dev`.

### Próximo paso concreto al retomar

1. Leer este documento.
2. Levantar `dev` usando el ejecutable real de Bun si hace falta evitar el shim `.ps1`.
3. Revalidar manualmente varios chords rápidos en apps distintas:
   - Notepad
   - navegador
   - editor de texto
4. Mirar `latest.log` para confirmar trazas:
   - `backend.key_event`
   - `chord_service.prefix_started`
   - `chord_service.suffix_matched`
   - `chord_service.cancelled` / `chord_service.timeout`
5. Si todo sigue estable:
   - limpiar/degradar el camino viejo de chords
   - decidir si el backend actual queda como base productiva o necesita más hardening

## Cierre de sesión - 2026-03-13 (Worker bootstrap chord backend)

### Contexto de trabajo

- Sesión enfocada en retomar el estado actual del rediseño de chords y validar si el backend Windows nuevo estaba realmente activo en `dev`.
- Se trabajó primero en modo diagnóstico y después se aplicó fix puntual.

### Hallazgos principales

- El backend nuevo no estaba arrancando realmente en `dev`.
- `latest.log` mostraba:
  - `backend.hook_error`
  - `chord.backend_start_failed`
- La causa concreta era el bootstrap del worker:
  - `WindowsKeyboardBackend` intentaba abrir `./windows-keyboard-hook-worker.ts` relativo al bundle en `build/dev-win-x64/.../Resources/app/bun`
  - ese archivo no existe como artifact separado dentro del app bundle de dev
- Resultado práctico:
  - la app seguía registrando chords
  - pero quedaba corriendo por el camino fallback/viejo
  - o sea: el backend nuevo no era el path realmente validado

### Fix aplicado

- Se modificó `src/bun/windows-keyboard-backend.ts`.
- Se agregó resolución explícita del worker entrypoint:
  - prueba paths locales del bundle
  - prueba paths directos desde `process.cwd()`
  - recorre directorios padre desde `import.meta.dir` y desde `process.cwd()` hasta encontrar `src/bun/windows-keyboard-hook-worker.ts`
- Se agregó log estructurado:
  - `backend.worker_entrypoint_resolved`

### Validación realizada

- Tests corridos:
  - `bun test src/bun/chord-service.test.ts src/bun/windows-keyboard-backend.test.ts`
- Reinicio limpio de `dev` y validación por logs.
- Resultado confirmado en `latest.log`:
  - `session.started`
  - `backend.worker_entrypoint_resolved`
  - `backend.hook_started`
  - `chord.backend_ready`
- Esto confirma que el backend Windows nuevo ahora sí arranca en `dev`.

### Estado actual al cerrar

- El repo no quedó limpio:
  - hay cambio local en `src/bun/windows-keyboard-backend.ts`
- El problema de `ModuleNotFound` del worker quedó corregido para el flujo actual de `dev`.
- El backend nuevo ya no falla al boot por no encontrar el worker.
- Falta validación manual fuerte del comportamiento real de chords rápidos en apps externas.

### Próximo paso concreto al retomar

1. Leer este documento.
2. Levantar `dev`.
3. Probar chords rápidos reales en:
   - Notepad
   - navegador
   - editor de texto
4. Confirmar en `latest.log` estas trazas durante uso real:
   - `backend.key_event`
   - `chord_service.prefix_started`
   - `chord_service.suffix_matched`
5. Verificar especialmente:
   - que el suffix rápido no se cuele en la app activa
   - que `Esc` cancele bien
   - que invalid key cancele bien
   - que timeout limpie el estado
6. Si la validación manual da bien:
   - decidir cleanup del camino viejo/fallback de chords
   - decidir si migrar más hotkeys al backend nuevo o endurecer primero el backend actual

## Cierre de sesión - 2026-03-13 (Input Service master plan)

### Contexto de trabajo

- Sesión enfocada en reevaluar el rediseño de chords/hotkeys después de validar comportamiento real del backend Windows nuevo.
- Se trabajó en modo diagnóstico, con foco en evidencias de `latest.log`, comportamiento global del teclado y definición de arquitectura futura.

### Hallazgos principales

- El backend Windows nuevo arranca en `dev`:
  - `backend.worker_entrypoint_resolved`
  - `backend.hook_started`
  - `chord.backend_ready`
- Aun arrancando limpio, sin usar hotkeys de Assistant:
  - hotkeys externos del sistema o de otras apps dejan de comportarse normal
  - ejemplos reportados por el usuario:
    - `Alt+Space`
    - `Win+A`
- El problema no depende de usar primero un chord o una acción de Assistant:
  - aparece desde boot con la app viva
- En logs se observaron ráfagas de:
  - `backend.key_event`
  - `injected: true`
  - muchas teclas `VK_A0`
- Eso refuerza que el backend global nuevo no es apto como path productivo actual.
- `Alt+R` no entra de forma confiable al flujo de prefix:
  - no deja trazas esperadas como `backend.prefix_triggered` o `chord_service.prefix_started`
- Los hotkeys simples de la app sí llegaron a funcionar en momentos concretos:
  - `Alt+Q`
  - `Alt+Shift+W`
- `Alt+T` no estaba roto por captura:
  - simplemente no estaba configurado en settings
- El Prompt Editor sí tiene soporte UI para hotkey:
  - el campo existe en la vista
  - el problema no era que la feature no existiera en código
- El cierre del Prompt Editor fue revalidado:
  - `webview.close_requested`
  - luego `hotkeys.resumed`
  - o sea: cerrar el editor cierra la ventana y reanuda hotkeys, no cierra toda la app

### Conclusiones de arquitectura

- Se decidió ampliar el foco:
  - dejar de pensar solo en `ChordService`
  - pasar a un `InputService`/subsistema reusable para:
    - hotkeys simples
    - chords
    - modos transitorios
    - which-key / hint model
- Se confirmó que la arquitectura reusable sí vale la pena.
- Se confirmó que la implementación actual del backend global Windows no debe tomarse como base final.
- Se investigaron referencias externas para mejorar el rediseño:
  - modal hotkeys
  - transient keymaps
  - backends con capacidades
  - helper nativo separado como dirección probable

### Documento nuevo creado

- Documento rector nuevo:
  - `DOC/input-service-master-plan.md`

### Qué quedó definido en ese plan

- objetivo del nuevo subsistema
- problemas confirmados del backend actual
- arquitectura por capas:
  - core reusable
  - backend adapters
  - overlay adapter
  - app integration layer
- API conceptual
- fases del trabajo:
  - Fase 0: documento rector
  - Fase 1: core puro
  - Fase 2: adapter temporal seguro
  - Fase 3: backend Windows serio
  - Fase 4: cleanup de migración
  - Fase 5: extracción reusable
- to-dos y checkpoints de validación manual

### Estado actual al cerrar

- La app puede seguir viva aunque el usuario no la vea claramente en el tray.
- El backend global nuevo quedó conceptualmente descartado como path productivo inmediato.
- El rediseño no se abandona:
  - se conserva la idea de arquitectura reusable
  - se cambia el foco desde “hook actual” hacia “InputService + adapters”
- El repo quedó con documento nuevo de plan maestro.

### Próximo paso concreto al retomar

Cuando el usuario arranque la próxima sesión y diga `go`:

1. Leer:
   - `DOC/debug-session-flow.md`
   - `DOC/input-service-master-plan.md`
2. Empezar Fase 1.
3. Crear el core puro del nuevo subsistema:
   - `src/input-service/core/input-service.ts`
   - `src/input-service/core/input-types.ts`
   - `src/input-service/core/input-state.ts`
   - `src/input-service/core/hint-model.ts`
   - `src/input-service/core/input-service.test.ts`
4. No volver a tocar todavía el backend Windows productivo.
5. Usar tests puros como criterio de avance antes de cualquier nueva integración con la app.

## Cierre de sesión - 2026-03-13 (Input Service integration and old chord cleanup)

### Contexto de trabajo

- Sesión enfocada en completar la Fase 2 inicial del `InputService` y validar el comportamiento real en `dev`.
- Se trabajó con reinicios frecuentes y prueba manual directa del usuario sobre hotkeys/chords.

### Implementado en esta sesión

- Se agregó `InputService` core reusable con:
  - singles semánticos
  - pending sessions
  - hint model
  - timeout / cancelación / invalid key
  - tests puros
- Se agregó adapter temporal seguro:
  - `ElectrobunShortcutBackend`
  - `AssistantInputFacade`
- `src/bun/hotkeys.ts` quedó migrado al facade nuevo.
- Se agregó helper operativo:
  - `scripts/restart-dev.ps1`
- Se ajustó UX del hint:
  - al aparecer el overlay, la sesión se extiende
  - se corrigió un bug de parpadeo/reaparición del hint
- Cleanup aplicado:
  - se removió el camino viejo huérfano de chords/backend Windows:
    - `src/bun/chord-service.ts`
    - `src/bun/chord-types.ts`
    - `src/bun/chord-service.test.ts`
    - `src/bun/keyboard-backend.ts`
    - `src/bun/windows-keyboard-backend.ts`
    - `src/bun/windows-keyboard-backend.test.ts`
    - `src/bun/windows-keyboard-backend-spike.ts`
    - `src/bun/windows-keyboard-hook-worker.ts`

### Validación realizada

- Tests corridos:
  - `bun test src/input-service/core/input-service.test.ts`
- Validación manual del usuario en `dev`:
  - `Alt+Shift+W` ok
  - `Alt+Q` ok
  - `Alt+R,C` ok
  - el hint del chord ya no degrada el teclado global
  - el hint quedó estable después del fix de reentrada/parpadeo

### Hallazgos principales

- El problema operativo de restart no era la app:
  - era el wrapper `bun.ps1` cuando se intentaba lanzar `bun` por nombre desde PowerShell
- Para este repo conviene reiniciar `dev` con `node_modules/electrobun/.cache/electrobun.exe dev` y no a través del shim de PowerShell.
- Después de migrar `hotkeys.ts`, el backend viejo Windows quedó totalmente muerto en runtime.

### Estado actual al cerrar

- La arquitectura activa de input/hotkeys quedó unificada sobre `InputService` + backend temporal seguro.
- El repo quedó sin el código viejo huérfano del spike de backend Windows.
- `dev` sigue siendo el flujo principal de validación manual.

### Próximo paso concreto al retomar

1. Mantener este restart flow:
   - usar `scripts/restart-dev.ps1`
2. Seguir con cleanup/documentación de la arquitectura nueva si hace falta.
3. Si aparece un nuevo problema real de chords:
   - debug sobre `src/input-service/*`
   - no reintroducir el backend Windows viejo.
