# Input Service Master Plan

Este documento define el plan maestro para rediseñar el subsistema de hotkeys, chords y which-key como un servicio reusable.

La idea ya no es solo arreglar `Alt+R,*` en Assistant. La idea es construir una base reutilizable que sirva:

- para Assistant
- para un future standalone which-key app
- para otras apps que necesiten hotkeys simples, chords y modos transitorios

## Objetivo

Construir un `InputService` reusable que se haga cargo de:

- hotkeys simples
- chords
- modos transitorios tipo which-key
- estado interno
- timeout, cancelacion e invalid key handling
- hint model para overlay/UI
- degradacion por capacidades del backend

Y que no quede atado a:

- Electrobun
- Win32 directo
- una sola implementacion de captura
- una sola app

## Problemas confirmados del estado actual

### Problema 1. El backend Windows nuevo degrada el teclado global

Hallazgo confirmado en validacion manual:

- con la app arrancada, teclas y combinaciones ajenas a Assistant dejan de comportarse normal
- al cerrar la app, el comportamiento vuelve a la normalidad

Evidencia tecnica observada:

- `backend.hook_started`
- luego eventos `backend.key_event` repetidos
- muchos eventos `injected: true`
- `VK_A0` repetido

Consecuencia:

- el backend actual no es apto como base productiva

### Problema 2. El hook actual no es una base confiable para el prefix matching

Hallazgo confirmado:

- `Alt+R` no entra de forma confiable al flujo de prefix
- no aparecen trazas como `backend.prefix_triggered` o `chord_service.prefix_started` cuando deberian

### Problema 3. La arquitectura actual mezcla demasiadas responsabilidades

Hoy estan mezclados:

- registro de hotkeys globales
- logica de chords
- captura de texto
- overlay de hint
- integracion con ventanas
- decisiones de plataforma

Consecuencia:

- cuesta aislar bugs
- cuesta degradar de forma segura
- cuesta reutilizar el sistema en otras apps

## Direccion elegida

Mantener la idea de arquitectura reusable y modal, pero desacoplarla de la implementacion actual del hook Windows.

Decision de alto nivel:

- si al redisenio del servicio reusable
- no a usar el backend Windows actual como base final

## Arquitectura objetivo

La arquitectura objetivo se divide en 4 capas.

### 1. Core reusable: `InputService`

Modulo puro y testeable.

Responsabilidades:

- registrar acciones
- registrar triggers
- registrar modos
- mantener estado
- decidir transiciones
- emitir resoluciones
- producir hint model
- exponer eventos de cambio de estado

No sabe nada de:

- Win32
- Electrobun
- tray
- ventanas
- overlay real

### 2. Backend adapters

Interfaz para hablar con mecanismos reales de teclado.

Ejemplos:

- `ElectrobunShortcutBackend`
- `FallbackChordBackend`
- `WindowsNativeCaptureBackend`

Responsabilidades:

- registrar singles
- registrar prefixes
- notificar eventos de teclado
- informar capacidades

### 3. Overlay adapter

Adaptador opcional que transforma `HintModel` en UI visible.

Ejemplos:

- overlay de Assistant
- sin overlay en otras apps
- future standalone which-key UI

### 4. App integration layer

Capa especifica de la app actual.

Responsabilidades:

- mapear acciones a handlers reales
- conectar captura de texto
- abrir ventanas
- integrar status/toasts

## API conceptual

Esta API no implica nombres finales, pero fija la separacion.

```ts
type ActionId = string;
type ModeId = string;

type ActionDefinition = {
  id: ActionId;
  title: string;
};

type SingleTrigger = {
  kind: "single";
  accelerator: string;
  actionId: ActionId;
};

type ChordTrigger = {
  kind: "chord";
  prefix: string;
  suffix: string;
  actionId: ActionId;
};

type ModeDefinition = {
  id: ModeId;
  title: string;
  prefix: string;
  entries: Array<{
    key: string;
    title: string;
    actionId: ActionId;
  }>;
  timeoutMs?: number;
};

type Resolution =
  | { kind: "ignored"; reason: string }
  | { kind: "pending-started"; modeId?: string }
  | { kind: "matched"; actionId: ActionId }
  | { kind: "cancelled"; reason: string };

interface InputService {
  registerAction(action: ActionDefinition): void;
  unregisterAction(actionId: ActionId): void;

  registerSingle(trigger: SingleTrigger): void;
  registerChord(trigger: ChordTrigger): void;
  registerMode(mode: ModeDefinition): void;

  unregisterTrigger(actionId: ActionId): void;
  unregisterMode(modeId: ModeId): void;

  beginMode(prefix: string, source?: unknown): Resolution;
  handleKeyEvent(event: KeyEvent): Resolution;
  cancel(reason?: string): Resolution;

  getState(): InputState;
  getHintModel(): HintModel | null;
  onStateChange(listener: (state: InputState) => void): () => void;
}
```

## Estado interno deseado

Estados minimos:

- `idle`
- `pending`
- `executing`
- `suspended`

Datos minimos:

- `sessionId`
- `prefix`
- `modeId`
- `source`
- `startedAt`
- `deadlineAt`
- `entries`
- `lastResolution`

## Capacidades del backend

La capa backend tiene que declarar capacidades. El core no debe asumirlas.

Capacidades minimas:

- `globalObserve`
- `consumeKeys`
- `sourceWindow`
- `singleRegistration`
- `prefixRegistration`

Eso permite degradar de forma explicita:

- backend nativo si la plataforma soporta captura real
- fallback si no soporta consumo o observacion

## Fases del plan

### Fase 0. Documento rector y cambio de foco

Objetivo:

- dejar explicitado que el scope ya no es solo `ChordService`
- alinear arquitectura, riesgos y roadmap

To-dos:

- crear este documento
- mantener como referencia `DOC/chord-service-redesign-plan.md`
- usar este plan como documento principal de la migracion

Salida:

- plan maestro aprobado

### Fase 1. Core puro de `InputService`

Objetivo:

- construir el core reusable y testeable

Incluye:

- tipos publicos
- acciones
- singles a nivel semantico
- chords
- modos
- timeout
- cancelacion
- hint model
- logs del core
- tests puros

No incluye:

- Win32
- Electrobun
- captura real
- overlay real

To-dos:

- crear modulo `src/input-service/core/input-service.ts`
- crear `input-types.ts`
- crear `input-state.ts`
- crear `hint-model.ts`
- portar/aprovechar lo rescatable de `ChordService`
- agregar tests unitarios

Salida:

- servicio puro instanciable y testeado

### Fase 2. Adapter temporal seguro para Assistant

Objetivo:

- integrar el core nuevo sin romper teclado global

Incluye:

- backend temporal seguro
- soporte de singles
- soporte de chords por camino fallback controlado
- overlay conectado al hint model

No incluye:

- hook global Windows productivo

To-dos:

- definir `backend-types.ts`
- crear `ElectrobunShortcutBackend`
- crear `FallbackChordBackend`
- integrar a Assistant detras de un facade nuevo
- mantener el path actual apagable

Salida:

- Assistant operando sobre la arquitectura nueva sin depender del hook roto

### Fase 3. Backend Windows serio

Objetivo:

- resolver captura real para chords rapidos sin degradar el teclado global

Opciones a evaluar:

- helper nativo separado en Rust
- helper nativo separado en C++
- alternativa basada en Raw Input
- reevaluacion de hook low-level solo si la implementacion queda fuera de Bun JS callback

Decision preferida hoy:

- helper nativo separado

To-dos:

- escribir spike tecnico comparando opciones
- definir IPC con el core
- soportar prefix + key events + consumo si aplica
- medir estabilidad real

Salida:

- backend Windows con criterio productivo o decision formal de descartarlo

### Fase 4. Migration cleanup

Objetivo:

- retirar wiring viejo y consolidar el facade nuevo

To-dos:

- remover caminos duplicados
- limpiar `hotkeys.ts`
- mover logica de hint al adapter
- dejar API estable para la app

Salida:

- una sola arquitectura activa

### Fase 5. Extraccion reusable

Objetivo:

- dejar el sistema listo para reutilizarse en otros proyectos

To-dos:

- revisar nombres y fronteras
- separar adapters especificos de Assistant
- documentar API publica
- dejar ejemplo de uso minimo

Salida:

- modulo reusable para otras apps

## Plan detallado de Fase 1

### Modulos propuestos

- `src/input-service/core/input-service.ts`
- `src/input-service/core/input-types.ts`
- `src/input-service/core/input-state.ts`
- `src/input-service/core/hint-model.ts`
- `src/input-service/core/input-service.test.ts`

### Casos que deben quedar cubiertos

1. registrar acciones
2. registrar single trigger
3. registrar chord trigger
4. registrar mode definition
5. `beginMode()` entra en pending
6. suffix valido hace match
7. invalid key cancela
8. `Esc` cancela
9. timeout limpia
10. nueva sesion reemplaza la anterior
11. unregister limpia estado pendiente
12. `HintModel` refleja el estado activo

### Logging minimo del core

- `input_service.action_registered`
- `input_service.action_unregistered`
- `input_service.mode_registered`
- `input_service.mode_unregistered`
- `input_service.pending_started`
- `input_service.matched`
- `input_service.cancelled`
- `input_service.timeout`
- `input_service.invalid_key`

Metadata minima:

- `sessionId`
- `prefix`
- `key`
- `actionId`
- `modeId`
- `elapsedMs`

## Riesgos y decisiones

### Riesgo 1. Volver a mezclar arquitectura con spike tecnico

Mitigacion:

- no meter Win32 en Fase 1

### Riesgo 2. Diseñar una API demasiado atada a Assistant

Mitigacion:

- el core no abre ventanas ni captura texto

### Riesgo 3. Repetir el error del backend actual

Mitigacion:

- el backend Windows no vuelve a producción hasta probar estabilidad real

## Puntos donde necesito ayuda del usuario

Tu ayuda va a ser especialmente valiosa en:

- validar UX del which-key overlay
- probar hotkeys reales en Windows
- confirmar comportamiento en:
  - Notepad
  - navegador
  - editores
- detectar si una degradacion se siente aceptable o no

## Criterio de exito

El plan va bien si logramos:

1. un core reusable y testeado
2. una integracion temporal segura en Assistant
3. cero degradacion global del teclado
4. una base lista para un future standalone which-key project

## Proximo paso recomendado

Empezar por Fase 1:

1. crear el core `InputService`
2. mantenerlo puro
3. cubrirlo con tests
4. no tocar todavia el backend Windows productivo
