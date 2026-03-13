# Guía Rápida: Flujos de Hotkeys

## Tabla de Contenidos

1. [Flujo 1: Hotkey Simple del Sistema](#flujo-1-hotkey-simple-del-sistema)
2. [Flujo 2: Hotkey de Chord](#flujo-2-hotkey-de-chord)
3. [Flujo 3: Hotkey de Prompt](#flujo-3-hotkey-de-prompt)
4. [Flujo 4: Pausa/Reanudación](#flujo-4-pausareanudación)
5. [Flujo 5: Captura de Texto](#flujo-5-captura-de-texto)
6. [Flujo 6: Reemplazo Silencioso](#flujo-6-reemplazo-silencioso)
7. [Issues Conocidos](#issues-conocidos)
8. [Soluciones Propuestas](#soluciones-propuestas)

---

## Flujo 1: Hotkey Simple del Sistema

### Ejemplo: Alt+Shift+W → Open Chat

```
Usuario presiona Alt+Shift+W
    ↓
GlobalShortcut callback
    ↓
handlePromptChat()
    ↓
showMainWindow()
    ↓
captureSelectedText()
    ↓
main window se muestra
```

### Archivos Involucrados
- `src/bun/index.ts` (262-265)
- `src/bun/mainview-window.ts` (408-465)
- `src/bun/ffi.ts` (255-327)

### Tiempos Críticos
- Captura de texto: ~200-400ms
- Apertura de ventana: ~100-200ms

---

## Flujo 2: Hotkey de Chord

### Ejemplo: Alt+Shift+Q → Alt+R

```
Usuario presiona Alt+Shift+Q (Prefix)
    ↓
releaseModifiers()
    ↓
Registrar Alt+R temporalmente (900ms)
    ↓
Esperar 400ms
    ↓
Mostrar Chord Hint
    ↓
Usuario presiona Alt+R (Suffix)
    ↓
clearChordActivation()
    ↓
captureSelectedText()
    ↓
Ejecutar acción
```

### Archivos Involucrados
- `src/bun/hotkeys.ts` (278-348)
- `src/bun/chord-hint.ts` (90-123)

### Tiempos Críticos
- Timeout de chord: 900ms
- Delay de hint: 400ms
- **⚠️ Issue:** Registro de suffix puede no completarse a tiempo

---

## Flujo 3: Hotkey de Prompt

### Ejemplo: Alt+Shift+F → Fix Writing

```
Usuario presiona Alt+Shift+F
    ↓
Prompt hotkey callback
    ↓
¿prompt.confirm?
    ├─ Sí → showMainWindowWithContext()
    └─ No → silentReplace()
         ↓
    captureSelectedText()
         ↓
    ¿Texto vacío?
         ├─ Sí → ¿selectAllIfEmpty?
         │    ├─ Sí → selectAllText() + Recapturar
         │    └─ No → Error: "No text selected"
         └─ No → LLM Processing
              ↓
         Pegar resultado
```

### Archivos Involucrados
- `src/bun/index.ts` (203-237)
- `src/bun/replace.ts` (54-186)
- `src/bun/ffi.ts` (350-359)

### Tiempos Críticos
- selectAllText: 40ms + 40ms = 80ms
- **⚠️ Issue:** 80ms puede ser insuficiente para algunas apps

---

## Flujo 4: Pausa/Reanudación

### Estado: hotkeyPauseDepth

```
App inicia → hotkeyPauseDepth = 0
    ↓
Ventana abre → hotkeyPauseDepth = 1
    ↓
Otra ventana abre → hotkeyPauseDepth = 2
    ↓
Una ventana cierra → hotkeyPauseDepth = 1
    ↓
Última ventana cierra → hotkeyPauseDepth = 0
    ↓
Re-registrar hotkeys
```

### Archivos Involucrados
- `src/bun/index.ts` (151-176)

### Tiempos Críticos
- Pausa: instantánea (unregisterAll)
- Reanudación: ~50-100ms (re-registro)

### **⚠️ Issue:** Si hay error en reanudación, hotkeys quedan pausados

---

## Flujo 5: Captura de Texto

### Secuencia Detallada

```
captureSelectedText(hwnd)
    ↓
Leer clipboard actual
    ↓
Limpiar clipboard
    ↓
releaseModifiers()
    ↓
AttachThreadInput (si es necesario)
    ↓
SetForegroundWindow(hwnd)
    ↓
Esperar 80ms
    ↓
Loop (2 intentos):
    ├─ Verificar ventana activa
    ├─ Limpiar clipboard
    ├─ Enviar Ctrl+C
    ├─ Leer clipboard con polling (4 intentos, 75ms cada uno)
    └─ Si texto no vacío → break
    ↓
Desadjuntar ThreadInput
    ↓
Restaurar clipboard original
    ↓
Retornar {text, hwnd, savedClipboard}
```

### Archivos Involucrados
- `src/bun/ffi.ts` (255-327)

### Tiempos Críticos
- SetForegroundWindow: 80ms
- Ctrl+C: ~50ms
- Polling: 4 × 75ms = 300ms
- **Total estimado:** 430-730ms

### **⚠️ Issues:**
- 80ms puede ser insuficiente para algunas apps
- AttachThreadInput puede fallar silenciosamente

---

## Flujo 6: Reemplazo Silencioso

### Secuencia

```
silentReplace(prompt, options)
    ↓
¿options.inputText definido?
    ├─ Sí → Usar input proporcionado
    └─ No → captureSelectedText()
         ↓
    ¿Texto vacío?
         ├─ Sí → ¿selectAllIfEmpty?
         │    ├─ Sí → selectAllText() + Recapturar
         │    └─ No → Error: "No text selected"
         └─ No → LLM Processing
              ↓
         Pegar resultado
              ↓
         Mostrar toast de undo
```

### Archivos Involucrados
- `src/bun/replace.ts` (54-186)
- `src/bun/ffi.ts` (329-348)

### Tiempos Críticos
- Captura: 430-730ms
- LLM: 1-5 segundos (depende del modelo)
- Pegado: ~200ms
- **Total estimado:** 2-6 segundos

---

## Issues Conocidos

### 🔴 Issue 2.2: Suffix se Escribe en Pantalla

**Síntoma:** Al presionar chord muy rápido, el suffix se escribe como texto normal

**Causa:** `releaseModifiers()` libera teclas del suffix antes de que se registren

**Impacto:** Alto - Comportamiento muy confuso

**Solución:** Agregar delay de 50ms antes de registrar suffix

**Código:**
```typescript
// hotkeys.ts:290-335
const ok = _register(prefix, () => {
  releaseModifiers();
  await Bun.sleep(50);  // ← AGREGAR
  // ... registrar suffix
});
```

---

### 🔴 Issue 3.1: selectAllIfEmpty Falla

**Síntoma:** Al no tener texto seleccionado, el prompt muestra error en lugar de seleccionar todo

**Causa:** Solo 40ms de espera después de Ctrl+A es insuficiente

**Impacto:** Alto - Funcionalidad principal no funciona

**Solución:** Aumentar sleep de 40ms a 100ms

**Código:**
```typescript
// ffi.ts:350-359
export async function selectAllText(hwnd?: unknown): Promise<void> {
  // ...
  await Bun.sleep(40);
  sendKeys(VK_CONTROL, VK_A);
  await Bun.sleep(100);  // ← CAMBIAR de 40 a 100
}
```

---

### 🔴 Issue 1.1: Race Condition en Captura

**Síntoma:** Capturas consecutivas pueden interferirse

**Causa:** `captureSequence` no usa lock/mutex

**Impacto:** Medio - Comportamiento impredecible

**Solución:** Agregar mutex para operaciones de captura

**Código:**
```typescript
// ffi.ts
let captureMutex = false;

export async function captureSelectedText(...) {
  while (captureMutex) {
    await Bun.sleep(10);
  }
  captureMutex = true;
  try {
    // ... operación existente
  } finally {
    captureMutex = false;
  }
}
```

---

### 🟡 Issue 2.1: Doble Presión de Prefix

**Síntoma:** Al presionar prefix dos veces, el hint parpadea

**Causa:** Timer se resetea y suffix se re-registran

**Impacto:** Medio - Confusión visual

**Solución:** Ignorar prefix si ya está activo

**Código:**
```typescript
// hotkeys.ts, al inicio del callback del prefix
if (chordPrefixes.has(prefix) && chordPrefixes.get(prefix)!.actions.size > 0) {
  log.warn("chord.prefix_already_active", { prefix });
  return;
}
```

---

### 🟡 Issue 4.1: Hotkeys no se Re-registran

**Síntoma:** Hotkeys dejan de funcionar después de cerrar ventanas

**Causa:** Error silencioso en reanudación

**Impacto:** Medio - Requiere reinicio de app

**Solución:** Agregar try-catch y logging

**Código:**
```typescript
// index.ts
function resumeHotkeys(): void {
  // ...
  try {
    applySystemHotkeys(getSettings());
    applyPromptHotkeys(currentPrompts);
    log.info("hotkeys.resumed");
  } catch (error) {
    log.error("hotkeys.resume_failed", { error });
    // Reintentar o notificar
  }
}
```

---

### 🟡 Issue 5.1: Timing de Ctrl+C

**Síntoma:** Captura falla en aplicaciones lentas

**Causa:** Solo 80ms de espera después de enfocar ventana

**Impacto:** Medio - Inconsistencia entre apps

**Solución:** Aumentar sleep de 80ms a 120ms

**Código:**
```typescript
// ffi.ts:280
if (hwnd) {
  u32.BringWindowToTop(hwnd);
  u32.SetForegroundWindow(hwnd);
}
await Bun.sleep(120);  // ← CAMBIAR de 80 a 120
```

---

## Soluciones Propuestas

### Fase 1: Fixes Críticos (1-2 días)

| Fix | Archivo | Cambio | Tiempo |
|-----|---------|--------|--------|
| Delay en suffix | hotkeys.ts | +50ms | 1 hora |
| Aumentar selectAll | ffi.ts | 40→100ms | 30 min |
| Mutex de captura | ffi.ts | Agregar lock | 2 horas |

### Fase 2: Robustez (2-3 días)

| Fix | Archivo | Cambio | Tiempo |
|-----|---------|--------|--------|
| Ignorar prefix activo | hotkeys.ts | Early return | 1 hora |
| Validación reanudación | index.ts | Try-catch | 1 hora |
| Mejorar timing captura | ffi.ts | 80→120ms | 30 min |

### Fase 3: Configurabilidad (3-5 días)

| Fix | Archivo | Cambio | Tiempo |
|-----|---------|--------|--------|
| Timeouts configurables | settings.ts | Nuevos campos | 2 horas |
| Logging detallado | hotkeys.ts | Logs extra | 2 horas |
| Métricas rendimiento | ffi.ts | Timing logs | 2 horas |

---

## Métricas de Rendimiento

### Tiempos Esperados (después de fixes)

| Operación | Antes | Después | Mejora |
|-----------|-------|---------|--------|
| Chord exitoso | 500-800ms | 550-850ms | +50ms |
| selectAllIfEmpty | 80-120ms | 140-180ms | +60ms |
| Captura de texto | 430-730ms | 470-770ms | +40ms |
| Reemplazo total | 2-6s | 2.1-6.1s | +100ms |

### Impacto en UX

- **Chord:** +50ms es imperceptible para usuarios
- **selectAll:** +60ms mejora confiabilidad significativamente
- **Captura:** +40ms reduce fallas en apps lentas
- **Total:** +100ms es aceptable para mejoras de estabilidad

---

## Testing Checklist

### Antes de Cada Fix

- [ ] Reproducir issue en entorno controlado
- [ ] Medir timing actual con logs
- [ ] Identificar aplicación específica donde falla

### Después de Cada Fix

- [ ] Verificar que el fix resuelve el issue
- [ ] Medir timing nuevo con logs
- [ ] Probar en múltiples aplicaciones
- [ ] Verificar que no hay regresiones
- [ ] Actualizar documentación

### Aplicaciones para Probar

- [ ] Microsoft Word
- [ ] Google Chrome
- [ ] Visual Studio Code
- [ ] Slack
- [ ] Outlook
- [ ] Notepad
- [ ] Terminal/PowerShell

---

## Referencia Rápida de Archivos

### Archivos Clave

| Archivo | Función | Líneas Clave |
|---------|---------|--------------|
| `hotkeys.ts` | Gestor central | 278-348 (chord) |
| `ffi.ts` | Windows API | 255-327 (captura) |
| `index.ts` | Coordinación | 151-176 (pausa) |
| `replace.ts` | Reemplazo | 54-186 (silent) |
| `mainview-window.ts` | Chat window | 408-465 (show) |
| `picker.ts` | Prompt picker | 300-381 (show) |

### Constantes Importantes

| Constante | Valor | Ubicación |
|-----------|-------|-----------|
| CHORD_TIMEOUT_MS | 900 | hotkeys.ts:258 |
| CHORD_HINT_DELAY_MS | 400 | hotkeys.ts:259 |
| CAPTURE_COPY_ATTEMPTS | 2 | ffi.ts:38 |
| CAPTURE_POLL_INTERVAL_MS | 75 | ffi.ts:39 |
| CAPTURE_POLL_ROUNDS | 4 | ffi.ts:40 |

---

## Comandos Útiles para Debugging

### Ver Logs en Tiempo Real

```powershell
# Seguir logs en tiempo real
Get-Content "$env:APPDATA\assistant\logs\latest.log" -Wait -Tail 50
```

### Buscar Errores Específicos

```powershell
# Buscar errores de hotkeys
Select-String "$env:APPDATA\assistant\logs\latest.log" -Pattern "hotkey.*failed"

# Buscar errores de captura
Select-String "$env:APPDATA\assistant\logs\latest.log" -Pattern "capture.*failed"

# Buscar errores de chord
Select-String "$env:APPDATA\assistant\logs\latest.log" -Pattern "chord.*error"
```

### Medir Timing

```powershell
# Buscar logs de timing
Select-String "$env:APPDATA\assistant\logs\latest.log" -Pattern "timing"
```

---

## Notas Finales

### Prioridad de Fixes

1. **Issue 2.2** (Suffix se escribe) - Crítico, afecta UX directamente
2. **Issue 3.1** (selectAllIfEmpty) - Crítico, funcionalidad principal
3. **Issue 1.1** (Race condition) - Medio, comportamiento impredecible

### Timeline Estimado

- **Fase 1:** 1-2 días → Resuelve problemas críticos
- **Fase 2:** 2-3 días → Mejora robustez
- **Fase 3:** 3-5 días → Agrega configurabilidad

### Rollback Plan

- Mantener backup de `hotkeys.ts` antes de cambios
- Implementar feature flags para nuevos delays
- Agregar logging detallado para debugging en producción

---

## Contacto y Soporte

Para issues adicionales o preguntas sobre estos flujos, revisar:

- `DOC/hotkey-flows-analysis.md` - Análisis detallado
- `DOC/hotkey-flows-diagram.md` - Diagramas visuales
- `DOC/hotkey-issues-summary.md` - Resumen ejecutivo
- `latest.log` - Logs de la aplicación
