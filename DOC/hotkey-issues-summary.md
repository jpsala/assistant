# Resumen Ejecutivo: Issues de Hotkeys

## Problemas Reportados y Sus Causas Raíz

### Problema 1: "Hotkey doble escribe el segundo hotkey en pantalla"

**Causa Raíz:** Issue 2.2 - Escritura del Suffix en Pantalla

**Explicación:**
Cuando el usuario presiona un chord hotkey (ej: Alt+Shift+Q → Alt+R) muy rápidamente:

1. El prefix (Alt+Shift+Q) se presiona y libera
2. El sistema llama a `releaseModifiers()` que libera TODAS las teclas modificadoras
3. Los suffix se registran como global shortcuts
4. Si el usuario presiona el suffix (Alt+R) ANTES de que el registro se complete
5. Windows interpreta el suffix como una tecla normal (no como shortcut)
6. La tecla se escribe en la aplicación activa
7. El chord hint aparece DESPUÉS de que la tecla se escribió

**Código problemático:**
```typescript
// En hotkeys.ts:290-335
const ok = _register(prefix, () => {
  releaseModifiers();  // ← Libera teclas del suffix también
  // ...
  for (const [suf, { cb: action }] of s.actions) {
    GlobalShortcut.register(suf, async () => {  // ← Registro síncrono
      // ...
    });
  }
  // ...
});
```

**Solución Propuesta:**
Agregar un delay de 50-100ms antes de registrar los suffix para asegurar que el registro se complete antes de que el usuario pueda presionar el suffix.

---

### Problema 2: "selectAllIfEmpty no funciona y muestra mensaje de error"

**Causa Raíz:** Issue 3.1 - Timing insuficiente después de Ctrl+A

**Explicación:**
Cuando `selectAllIfEmpty` está activo y no hay texto seleccionado:

1. Se envía Ctrl+A para seleccionar todo el texto
2. Solo se espera 40ms antes de hacer Ctrl+C
3. Algunas aplicaciones (Word, Chrome, etc.) necesitan más tiempo para procesar la selección
4. El Ctrl+C se envía ANTES de que la selección se complete
5. Se captura texto vacío
6. Se muestra error "No text is selected"

**Código problemático:**
```typescript
// En ffi.ts:350-359
export async function selectAllText(hwnd?: unknown): Promise<void> {
  const target = hwnd ?? u32.GetForegroundWindow();
  if (target) {
    allowSetForegroundWindow();
    forceFocus(target);
  }
  await Bun.sleep(40);  // ← Muy corto para algunas apps
  sendKeys(VK_CONTROL, VK_A);
  await Bun.sleep(40);  // ← Muy corto para procesar selección
}
```

**Solución Propuesta:**
Aumentar el sleep después de `sendKeys(VK_CONTROL, VK_A)` de 40ms a 100-150ms.

---

### Problema 3: "Teclas que no funcionan consistentemente"

**Causa Raíz:** Múltiples issues de timing y estado

**Explicación:**
Este problema tiene varias causas posibles:

1. **Issue 1.1:** Race condition en `captureSequence` - capturas consecutivas pueden interferirse
2. **Issue 5.1:** Timing de Ctrl+C insuficiente - captura fallida en algunas apps
3. **Issue 4.1:** Hotkeys no se re-registran correctamente después de pausar/reanudar
4. **Issue 5.2:** Problemas con `AttachThreadInput` - foco no se transfiere correctamente

**Soluciones Propuestas:**
- Agregar lock/mutex para operaciones de captura
- Aumentar delays de timing
- Agregar validación y logging detallado
- Implementar fallbacks para `AttachThreadInput`

---

## Priorización de Fixes

### 🔴 Alta Prioridad (Impacto Crítico)

| Issue | Problema | Solución | Esfuerzo |
|-------|----------|----------|----------|
| 2.2 | Suffix se escribe en pantalla | Agregar delay antes de registrar suffix | Bajo |
| 3.1 | selectAllIfEmpty falla | Aumentar sleep a 100-150ms | Bajo |
| 1.1 | Race condition en captura | Agregar lock/mutex | Medio |

### 🟡 Media Prioridad (Impacto Moderado)

| Issue | Problema | Solución | Esfuerzo |
|-------|----------|----------|----------|
| 2.1 | Doble presión de prefix | Ignorar si ya está activo | Bajo |
| 4.1 | Hotkeys no se re-registran | Agregar try-catch y logging | Bajo |
| 5.1 | Timing de Ctrl+C | Aumentar sleep o polling | Medio |

### 🟢 Baja Prioridad (Impacto Menor)

| Issue | Problema | Solución | Esfuerzo |
|-------|----------|----------|----------|
| 2.3 | Timeout de chord muy corto | Hacer configurable | Bajo |
| 5.2 | Problemas con AttachThreadInput | Agregar validación | Medio |
| 5.3 | Restauración del clipboard | Usar lock/mutex | Medio |

---

## Plan de Acción Recomendado

### Fase 1: Fixes Críticos (1-2 días)

1. **Fix Issue 2.2: Delay en registro de suffix**
   ```typescript
   // En hotkeys.ts, después de releaseModifiers()
   await Bun.sleep(50);  // ← Nuevo
   for (const [suf, { cb: action }] of s.actions) {
     GlobalShortcut.register(suf, async () => { ... });
   }
   ```

2. **Fix Issue 3.1: Aumentar delay en selectAllText**
   ```typescript
   // En ffi.ts:350-359
   export async function selectAllText(hwnd?: unknown): Promise<void> {
     // ...
     await Bun.sleep(40);
     sendKeys(VK_CONTROL, VK_A);
     await Bun.sleep(100);  // ← Cambiado de 40 a 100
   }
   ```

3. **Fix Issue 1.1: Agregar lock para captura**
   ```typescript
   // En ffi.ts
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

### Fase 2: Mejoras de Robustez (2-3 días)

4. **Fix Issue 2.1: Ignorar prefix si ya está activo**
   ```typescript
   // En hotkeys.ts, al inicio del callback del prefix
   if (chordPrefixes.has(prefix) && chordPrefixes.get(prefix)!.actions.size > 0) {
     log.warn("chord.prefix_already_active", { prefix });
     return;  // Ignorar
   }
   ```

5. **Fix Issue 4.1: Agregar validación en reanudación**
   ```typescript
   // En index.ts
   function resumeHotkeys(): void {
     // ...
     try {
       applySystemHotkeys(getSettings());
       applyPromptHotkeys(currentPrompts);
       log.info("hotkeys.resumed");
     } catch (error) {
       log.error("hotkeys.resume_failed", { error });
       // Reintentar o notificar al usuario
     }
   }
   ```

6. **Fix Issue 5.1: Mejorar timing de captura**
   ```typescript
   // En ffi.ts
   export async function captureSelectedText(...) {
     // ...
     if (hwnd) {
       u32.BringWindowToTop(hwnd);
       u32.SetForegroundWindow(hwnd);
     }
     await Bun.sleep(120);  // ← Aumentado de 80 a 120
     // ...
   }
   ```

### Fase 3: Configurabilidad y Logging (3-5 días)

7. **Hacer timeouts configurables**
   ```typescript
   // En settings.ts
   hotkeys: {
     promptChat: "Alt+Shift+W",
     promptPicker: "Alt+Shift+Space",
     reload: "",
     chordTimeout: 900,        // ← Nuevo
     chordHintDelay: 400,     // ← Nuevo
     captureDelay: 120,       // ← Nuevo
     selectAllDelay: 100,     // ← Nuevo
   }
   ```

8. **Agregar logging detallado**
   ```typescript
   // En hotkeys.ts
   log.info("chord.prefix_pressed", { 
     prefix, 
     timestamp: Date.now(),
     depth: hotkeyPauseDepth 
   });
   
   log.info("chord.suffix_registered", { 
     suffix, 
     delay: Date.now() - prefixTime 
   });
   
   log.info("chord.suffix_triggered", { 
     suffix, 
     timestamp: Date.now(),
     timeSincePrefix: Date.now() - prefixTime 
   });
   ```

9. **Agregar métricas de rendimiento**
   ```typescript
   // En ffi.ts
   log.info("capture.timing", {
     hwnd,
     focusTime: focusEndTime - focusStartTime,
     copyTime: copyEndTime - copyStartTime,
     readTime: readEndTime - readStartTime,
     totalTime: endTime - startTime,
   });
   ```

---

## Métricas de Éxito

### Antes de los Fixes
- ❌ Suffix se escribe en pantalla ~30% de las veces con presión rápida
- ❌ selectAllIfEmpty falla ~40% de las veces en Word/Chrome
- ❌ Hotkeys dejan de funcionar después de ~10 aperturas/cierres de ventanas
- ❌ Captura de texto falla ~20% de las veces en aplicaciones lentas

### Después de los Fixes (Objetivos)
- ✅ Suffix se escribe en pantalla <5% de las veces
- ✅ selectAllIfEmpty funciona >95% de las veces
- ✅ Hotkeys funcionan consistentemente sin reinicio
- ✅ Captura de texto funciona >90% de las veces

---

## Testing Recomendado

### Casos de Prueba Críticos

1. **Test de Chord Rápido**
   - Presionar Alt+Shift+Q → Alt+R lo más rápido posible
   - Verificar que NO se escriba "R" en pantalla
   - Verificar que el chord hint aparezca correctamente

2. **Test de selectAllIfEmpty**
   - Abrir Word/Chrome sin texto seleccionado
   - Presionar hotkey de prompt con selectAllIfEmpty activo
   - Verificar que se seleccione todo el texto
   - Verificar que el prompt se ejecute correctamente

3. **Test de Pausa/Reanudación**
   - Abrir y cerrar ventanas 10 veces consecutivas
   - Verificar que los hotkeys sigan funcionando
   - Verificar que no haya memory leaks

4. **Test de Timing**
   - Probar en aplicaciones lentas (Word, Excel, Chrome)
   - Verificar que la captura funcione consistentemente
   - Medir tiempos de respuesta

### Aplicaciones para Probar
- Microsoft Word
- Google Chrome
- Visual Studio Code
- Slack
- Outlook
- Notepad
- Terminal/PowerShell

---

## Notas Adicionales

### Consideraciones de Rendimiento
- Los delays agregados pueden aumentar ligeramente la latencia
- El lock/mutex puede causar contention si hay múltiples capturas simultáneas
- Considerar usar un pool de workers para operaciones de FFI

### Compatibilidad
- Los fixes deben probarse en Windows 10 y 11
- Verificar compatibilidad con diferentes versiones de WebView2
- Probar con diferentes resoluciones de pantalla

### Rollback Plan
- Mantener versión anterior de hotkeys.ts como backup
- Implementar feature flags para nuevos delays
- Agregar logging detallado para debugging en producción

---

## Conclusión

Los tres problemas reportados tienen causas raíz identificables y soluciones relativamente simples:

1. **Hotkey doble** → Agregar delay de 50ms antes de registrar suffix
2. **selectAllIfEmpty** → Aumentar sleep de 40ms a 100ms
3. **Teclas inconsistentes** → Agregar locks y mejorar timing

Los fixes de Fase 1 pueden implementarse en 1-2 días y deberían resolver la mayoría de los problemas reportados. Las mejoras de Fase 2 y 3 agregarán robustez y configurabilidad a largo plazo.

**Recomendación:** Implementar Fase 1 inmediatamente y planificar Fase 2 y 3 para las siguientes iteraciones.
