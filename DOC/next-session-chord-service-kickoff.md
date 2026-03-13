# Next Session - Chord Service Kickoff

Este documento es la guía de arranque para la próxima sesión dedicada al rediseño del sistema de chords/which-key.

La intención es arrancar con contexto limpio y sin volver a reconstruir el razonamiento desde cero.

## Objetivo de la próxima sesión

Empezar la Fase 1 del rediseño:

- crear el core `ChordService`
- mantenerlo desacoplado del backend nativo
- no meterse todavía con el hook global de Windows
- no mezclar esta fase con fixes laterales de ventanas, prompts o replace

## Contexto que hay que leer al arrancar

Leer solamente estos documentos, en este orden:

1. `DOC/debug-session-flow.md`
2. `DOC/chord-service-redesign-plan.md`
3. `DOC/next-session-chord-service-kickoff.md`

No hace falta releer toda la documentación anterior de hotkeys salvo que aparezca una duda puntual.

## Commit base de referencia

El estado snapshot previo al rediseño quedó en:

- `225c701` `Snapshot current hotkey/window work before chord service redesign`

Ese commit es el punto de rollback mental y técnico.

## Estado esperado al comenzar

Antes de tocar código:

- revisar `git status`
- confirmar si quedaron cambios sin commit de la sesión anterior
- si solo están los documentos de preparación, comitearlos primero

Commit sugerido para dejar el repo listo:

- `docs: add chord service redesign session plan`

## Qué hacer primero

### Paso 1. Consolidar documentación

Si los docs creados para esta preparación siguen sin commit:

- commitear:
  - `DOC/chord-service-redesign-plan.md`
  - `DOC/next-session-chord-service-kickoff.md`
  - `DOC/debug-session-flow.md`

### Paso 2. Crear el core del servicio

Objetivo puntual:

- crear un modulo nuevo para `ChordService`
- que no dependa de Electrobun
- que no dependa de Win32
- que no dependa todavía de `GlobalShortcut`

Ubicación sugerida:

- `src/bun/chord-service.ts`

Archivos complementarios probables:

- `src/bun/chord-types.ts`
- `src/bun/chord-service.test.ts` o equivalente si el repo admite tests simples

## Alcance exacto de la Fase 1

### Sí entra

- tipos del estado
- tipos de eventos
- state machine
- timeout scheduling abstracto o encapsulado
- logger del servicio
- API pública del servicio
- adaptación del hint model como salida de estado

### No entra

- hook global de Windows
- callbacks FFI nativos
- consumo real de eventos del sistema
- migrar todavía el app wiring completo
- reemplazar de una vez el sistema actual de hotkeys

## API mínima sugerida para arrancar

La implementación inicial debería alcanzar algo como esto:

```ts
type ChordMatch = {
  prefix: string;
  suffix: string;
  actionId: string;
  label: string;
};

type PendingChordState = {
  sessionId: number;
  prefix: string;
  sourceHwnd: unknown;
  startedAt: number;
  deadlineAt: number;
  entries: Array<{ suffix: string; label: string; actionId: string }>;
};

interface ChordService {
  registerChord(match: ChordMatch): void;
  unregisterChord(actionId: string): void;
  beginPrefix(prefix: string, sourceHwnd: unknown): void;
  handleKeyEvent(event: KeyEvent): ChordResolution;
  cancel(reason: string): void;
  getPendingState(): PendingChordState | null;
}
```

No hace falta clavarse con estos nombres exactos, pero sí con la separación conceptual.

## Decisiones a mantener durante la implementación

- una sola chord activa a la vez
- los singles quedan fuera del servicio por ahora
- el hint visual sale del estado del servicio, no al revés
- el servicio no abre ventanas ni captura texto: solo decide el flujo del chord
- la integración con captura/prompt se resuelve después, desde afuera

## Casos que hay que cubrir en el core

Como mínimo:

1. `beginPrefix()` entra en pending con timeout activo
2. un suffix válido resuelve match
3. una tecla inválida cancela o devuelve `no-match`, según la política elegida
4. `Esc` cancela
5. timeout limpia el estado
6. un nuevo prefix reemplaza la sesión anterior sin dejar timers colgados
7. unregister de acciones limpia correctamente el mapa interno

## Logging que hay que agregar desde el principio

No esperar a “pulir después”. Agregar logs estructurados ya en la primera implementación.

Eventos mínimos:

- `chord_service.registered`
- `chord_service.unregistered`
- `chord_service.prefix_started`
- `chord_service.suffix_matched`
- `chord_service.cancelled`
- `chord_service.timeout`
- `chord_service.invalid_key`

Metadata mínima:

- `sessionId`
- `prefix`
- `suffix`
- `actionId`
- `elapsedMs`

## Cómo trabajar la sesión

Orden recomendado:

1. leer los 3 documentos
2. revisar `git status`
3. comitear docs si todavía no están comiteados
4. crear el core del servicio
5. revisar consistencia de tipos/API
6. validar manualmente la state machine con casos dirigidos
7. recién ahí pensar en el backend Windows

## Qué no hacer en la próxima sesión

Para mantener foco y no ensuciar el contexto:

- no tocar `ffi.ts` todavía
- no tocar hook nativo todavía
- no reabrir análisis generales de ventanas
- no mezclar fixes de persistencia o UI
- no cambiar prompts/hotkeys productivos hasta tener el core estable

## Criterio para cerrar la próxima sesión

La sesión se puede considerar bien cerrada si quedan hechos estos puntos:

- docs comiteados
- `ChordService` creado
- API del core definida
- estado y transiciones validadas
- siguiente paso claro: backend Windows spike

## Próximo commit esperado despues de esa sesión

Si la Fase 1 sale bien, el commit siguiente debería ser algo cercano a:

- `refactor: add chord service core state machine`

## Recordatorio operativo

Cuando la próxima sesión termine y el usuario diga `cerrar sesión`:

- actualizar `DOC/debug-session-flow.md`
- dejar qué se implementó
- dejar qué no se tocó
- dejar el siguiente paso concreto
