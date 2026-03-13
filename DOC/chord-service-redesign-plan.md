# Chord Service Redesign Plan

Este documento define el rediseño del sistema de chords/hotkeys para reemplazar el modelo actual basado en registrar suffix shortcuts temporales despues del prefix.

## Objetivo

- Eliminar la carrera donde la segunda tecla de una chord puede escribirse en la app activa antes de que Assistant la intercepte.
- Separar el motor de chords de la integracion puntual con Electrobun.
- Diseñar una base reusable para un servicio tipo which-key que despues pueda extenderse a otras apps y a otros backends nativos.
- Mantener una estrategia de rollout incremental, con commits chicos, logging fuerte y validacion manual frecuente.

## Problema actual

Hoy el sistema funciona asi:

1. se registra el prefix como global shortcut
2. cuando el prefix dispara, se registran suffix shortcuts temporales
3. si la segunda tecla llega demasiado rapido, puede entrar primero a la app activa

Consecuencia:

- chords como `Alt+R,C` o `Alt+R,S` no son confiables si el usuario teclea rapido
- el modelo depende del timing del runtime y de Windows
- el mecanismo no es reusable como servicio de entrada general

## Arquitectura objetivo

La nueva arquitectura va a separar el sistema en dos capas:

### 1. Core reusable: `ChordService`

Modulo puro de orquestacion, sin dependencia directa de Electrobun ni de Win32.

Responsabilidades:

- mantener estado de chords
- abrir/cerrar ventanas de espera
- resolver timeout
- exponer hint model para which-key
- decidir si una tecla completa una chord, cancela o se ignora
- emitir eventos y logs de alto nivel

Estado interno esperado:

- `idle`
- `pending`
- `executing`

Datos de estado:

- `pendingPrefix`
- `startedAt`
- `deadlineAt`
- `sourceHwnd`
- `allowedSuffixes`
- `hintVisible`
- `sessionId` para trazabilidad

### 2. Input backend nativo: `KeyboardBackend`

Interfaz desacoplada del core.

Responsabilidades:

- observar eventos globales de teclado
- registrar hotkeys estables para prefixes y singles
- notificar `keyDown` y `keyUp`
- opcionalmente consumir eventos si la plataforma lo permite

Interfaz inicial propuesta:

```ts
type KeyEvent = {
  type: "down" | "up";
  key: string;
  code?: string;
  alt: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  repeat: boolean;
  timestamp: number;
};

type PrefixRegistration = {
  accelerator: string;
  id: string;
};

interface KeyboardBackend {
  start(): Promise<void>;
  stop(): Promise<void>;
  registerPrefix(reg: PrefixRegistration, handler: () => void): Promise<void>;
  unregisterPrefix(id: string): Promise<void>;
  onKeyEvent(handler: (event: KeyEvent) => void): () => void;
}
```

### 3. Windows backend: `WindowsKeyboardBackend`

Primera implementacion concreta.

Base tecnica:

- hook global de teclado a bajo nivel en Windows
- deteccion propia de la segunda tecla durante estado `pending`
- consumo del evento si la tecla corresponde a una chord activa

Nota:

- la integracion concreta con Bun FFI y el loop nativo hay que validarla en un spike tecnico
- si el hook global no es viable de forma robusta dentro de Bun/Electrobun, habra que evaluar un helper nativo aparte

### 4. Adaptador de app actual

El app runtime va a dejar de hablar directo con `GlobalShortcut` para chords complejas.

Separacion buscada:

- singles y system hotkeys simples pueden seguir yendo por el camino actual si conviene
- chords multi-step van a pasar por `ChordService`
- `showChordHint` se convierte en una vista del estado del service, no en parte del mecanismo de captura

## Flujo esperado

### Single hotkey

1. backend detecta la hotkey estable
2. app ejecuta accion
3. no entra en modo chord

### Chord

1. usuario presiona prefix
2. `ChordService` entra en `pending`
3. se guarda `sourceHwnd`
4. se publica hint which-key
5. backend entrega eventos globales de teclado
6. si llega suffix valido:
   - se consume el evento
   - se cierra hint
   - se captura texto si aplica
   - se ejecuta la accion
7. si llega `Esc` o timeout:
   - se cancela
   - se cierra hint
8. si llega una tecla no valida:
   - politica inicial: cancelar y dejar trazado el evento
   - decision final a validar en implementacion

## Decisiones de producto/UX a fijar

Estas decisiones no bloquean el documento, pero si la implementacion:

- si una tecla invalida durante `pending` debe consumirse o dejarse pasar
- si `key repeat` se ignora siempre
- si al mantener presionado el prefix se permite o no resolver la chord
- cuanto dura el timeout real
- cuando mostrar el hint:
  - inmediato
  - despues de un delay corto
- si los suffixes aceptan solo letras o tambien teclas especiales

## Estrategia de implementacion

Vamos a hacerlo por capas y con puntos claros de rollback.

### Fase 0. Snapshot y documento

- commit del estado actual
- crear este documento
- dejar explicito el cambio de direccion

### Fase 1. Diseno del core

- crear `ChordService` sin backend real
- modelar estados, eventos y transiciones
- agregar logger dedicado
- agregar pruebas unitarias puras para transiciones

Entregable:

- servicio instanciable sin tocar aun el sistema actual de hotkeys

### Fase 2. Spike del backend Windows

- validar viabilidad de hook global con Bun FFI
- verificar callback lifetime
- verificar consumo de eventos
- verificar estabilidad del loop

Entregable:

- demo minima que loguee teclas globales
- conclusion tecnica: viable o no viable

### Fase 3. Integracion parcial

- enrutar solo chords multi-step al nuevo servicio
- dejar singles en la implementacion actual
- usar feature flag interna si hace falta
- mantener logs comparables con el sistema anterior

Entregable:

- prompts como `Alt+R,C` funcionando por el nuevo camino

### Fase 4. Which-key y polish

- conectar hint visual al estado del service
- definir politica de cancelacion
- ajustar tiempos
- validar limpieza de estado en errores y cierres

### Fase 5. Extraccion reusable

- revisar si el core puede moverse a un modulo mas generico
- definir interfaz para backends multiplataforma
- documentar extension futura a macOS

## Estrategia de commits

La idea es evitar un branch de miles de lineas sin puntos intermedios seguros.

### Commit 1

- `docs: add chord service redesign plan`

### Commit 2

- `refactor: add chord service core state machine`

Contenido:

- servicio nuevo
- tipos
- logger
- tests del core si entran en el repo actual

### Commit 3

- `spike: add windows keyboard backend prototype`

Contenido:

- backend experimental
- logging fuerte
- sin reemplazar todavia el wiring productivo

### Commit 4

- `feat: route multi-step chords through chord service`

Contenido:

- integracion con prompts
- hint which-key conectado al nuevo state machine
- limpieza del path viejo para chords

### Commit 5

- `fix: stabilize chord cancellation and invalid-key handling`

Contenido:

- cancelacion
- timeouts
- repeats
- corner cases

### Commit 6

- `docs: document chord backend architecture and validation results`

## Estrategia de devagueo y validacion

No vamos a trabajar a ciegas. Cada fase necesita trazas y pruebas manuales concretas.

### Logging obligatorio

Agregar eventos estructurados para:

- `chord.pending_started`
- `chord.pending_cancelled`
- `chord.pending_timeout`
- `chord.suffix_matched`
- `chord.invalid_key`
- `chord.event_consumed`
- `chord.event_passthrough`
- `backend.key_event`
- `backend.hook_started`
- `backend.hook_stopped`
- `backend.hook_error`

Cada evento deberia incluir:

- `sessionId`
- `prefix`
- `suffix` si aplica
- `sourceHwnd`
- `timestamp`
- `elapsedMs`

### Validacion manual por fase

Casos minimos:

1. chord rapida:
   - `Alt+R,C` muy rapido
   - la `C` no debe escribirse
2. chord lenta:
   - prefix, pausa corta, suffix
   - debe seguir funcionando
3. tecla invalida:
   - prefix, tecla no mapeada
   - validar politica elegida
4. timeout:
   - prefix, esperar
   - el servicio debe volver a `idle`
5. multiples apps:
   - Notepad
   - navegador
   - editor de texto
6. repeticion:
   - mantener tecla
   - no debe duplicar acciones
7. reuso:
   - varias chords consecutivas
   - sin estado fantasma

### Criterio de salida por fase

- no avanzar a la fase siguiente sin poder reproducir y observar bien la fase actual
- no remover el camino viejo hasta tener estabilidad real en Windows
- si el backend hook resulta fragil, parar y reevaluar antes de mezclarlo con la app principal

## Riesgos

### Riesgo tecnico

- hooks globales y callbacks nativos pueden ser delicados en Bun FFI
- puede haber problemas con lifecycle, threading o consumo de eventos

### Riesgo de estabilidad

- un bug en el hook podria degradar el teclado global del sistema
- cleanup defectuoso puede dejar el servicio en un estado roto

### Riesgo de alcance

- es facil mezclar refactor, fix y feature en un solo bloque
- por eso separamos core, backend e integracion

### Riesgo multiplataforma

- la arquitectura es portable
- el backend nativo no
- macOS requerira un backend distinto y permisos del sistema

## Estado de inicio

- snapshot previo creado en commit `225c701`
- foco actual cambiado desde fixes generales hacia rediseño del subsistema de chords/which-key
- siguiente paso recomendado: implementar Fase 1, empezando por el core `ChordService`
