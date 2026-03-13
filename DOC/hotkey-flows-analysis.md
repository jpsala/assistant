# Análisis Profundo de Flujos de Hotkeys

## Objetivo

Identificar y documentar todos los flujos de hotkeys en el proyecto, describir cómo funcionan, y analizar posibles issues que podrían causar los problemas reportados:

1. Hotkey doble que escribe el segundo hotkey en pantalla antes de mostrar el menú
2. Teclas que no funcionan consistentemente
3. selectAllIfEmpty que a veces no funciona y muestra mensaje de "no hay texto seleccionado"

---

## Arquitectura General del Sistema de Hotkeys

### Componentes Principales

1. **`src/bun/hotkeys.ts`** - Gestor central de hotkeys
   - Conversión de formato AHK a aceleradores
   - Registro/unregistro de hotkeys simples y chords
   - Gestión de estado de chords (prefix → suffix)
   - Timeouts y hints visuales

2. **`src/bun/index.ts`** - Inicialización y coordinación
   - Registro de hotkeys del sistema (promptChat, promptPicker, reload)
   - Registro de hotkeys de prompts dinámicos
   - Pausa/reanudación de hotkeys cuando ventanas están abiertas

3. **`src/bun/ffi.ts`** - Interfaz con Windows API
   - Captura de texto seleccionado (Ctrl+C)
   - Pegado de texto (Ctrl+V)
   - Selección de todo el texto (Ctrl+A)
   - Gestión de foco y ventanas

4. **`src/bun/chord-hint.ts`** - Visualización de hints de chord
   - Muestra opciones disponibles después de presionar prefix

---

## Flujo 1: Hotkey Simple del Sistema (ej: Alt+Shift+W → Open Chat)

### Secuencia de Ejecución

```
1. Usuario presiona Alt+Shift+W
   ↓
2. GlobalShortcut callback se ejecuta
   ↓
3. handlePromptChat() se llama
   ↓
4. showMainWindow() se ejecuta
   ↓
5. captureSelectedText() captura texto de ventana activa
   ↓
6. main window se muestra con contexto
```

### Código Relevante

**En `src/bun/index.ts` (líneas 262-265):**
```typescript
function handlePromptChat(): void {
  log.info("hotkey.prompt_chat_triggered");
  showMainWindow().catch((error) => log.error("hotkey.prompt_chat_failed", { error }));
}
```

**En `src/bun/mainview-window.ts` (líneas 408-465):**
```typescript
export async function showMainWindow(): Promise<void> {
  log.info("show.requested", { hasExistingWindow: Boolean(mainWindow) });
  const fg = getForegroundWindow();
  sourceHwnd = fg;
  originalText = "";
  const currentCapture = ++captureSequence;

  try {
    const captured = await captureSelectedText(fg);
    if (currentCapture === captureSequence) {
      originalText = captured.text;
      sourceHwnd = captured.hwnd;
      // ...
    }
  } catch (error) {
    // ...
  }
  // ...
}
```

### Posibles Issues Identificados

#### Issue 1.1: Race Condition en captureSequence

**Problema:**
```typescript
const currentCapture = ++captureSequence;
// ... async operations ...
if (currentCapture === captureSequence) {
  // Solo actualiza si no hubo otra llamada
}
```

**Análisis:**
- `captureSequence` es un contador que se incrementa en cada llamada
- Si el usuario presiona el hotkey rápidamente dos veces, se incrementa dos veces
- La primera captura puede completarse DESPUÉS de la segunda
- Esto causa que el texto de la primera captura sobrescriba el de la segunda

**Impacto:**
- Comportamiento impredecible en capturas consecutivas
- Posible pérdida de contexto

**Ubicación:** `src/bun/mainview-window.ts:413-427`

---

#### Issue 1.2: Timing de captureSelectedText

**Problema:**
```typescript
const captured = await captureSelectedText(fg);
```

**Análisis:**
- `captureSelectedText` hace Ctrl+C vía FFI
- Si el usuario suelta las teclas muy rápido, el callback puede ejecutarse antes de que las teclas estén completamente liberadas
- `releaseModifiers()` se llama DENTRO de `captureSelectedText`, no antes

**Impacto:**
- El Ctrl+C puede no registrarse correctamente
- Captura de texto vacío o incorrecto

**Ubicación:** `src/bun/ffi.ts:255-327`

---

## Flujo 2: Hotkey de Chord (ej: Alt+Shift+Q → Alt+R)

### Secuencia de Ejecución

```
1. Usuario presiona Alt+Shift+Q (prefix)
   ↓
2. Chord prefix callback se ejecuta
   ↓
3. releaseModifiers() se llama
   ↓
4. Suffix keys se registran temporalmente (900ms window)
   ↓
5. Chord hint se muestra después de 400ms
   ↓
6. Usuario presiona Alt+R (suffix) dentro de la ventana
   ↓
7. Suffix callback se ejecuta
   ↓
8. clearChordActivation() limpia todos los suffix temporales
   ↓
9. Acción del chord se ejecuta
```

### Código Relevante

**En `src/bun/hotkeys.ts` (líneas 278-348):**
```typescript
function registerChord(
  name: string,
  prefix: string,
  suffix: string,
  cb: HotkeyCallback,
  label: string
): boolean {
  if (!chordPrefixes.has(prefix)) {
    const state: ChordState = { 
      actions: new Map(), 
      timer: null, 
      hintTimer: null, 
      sourceHwnd: null 
    };
    chordPrefixes.set(prefix, state);

    const ok = _register(prefix, () => {
      releaseModifiers();
      const s = chordPrefixes.get(prefix)!;
      s.sourceHwnd = getForegroundWindow();

      // Register all suffix keys temporarily
      for (const [suf, { cb: action }] of s.actions) {
        GlobalShortcut.register(suf, async () => {
          const sourceHwnd = s.sourceHwnd;
          clearChordActivation(s);  // ← Limpia TODOS los suffix
          let preCaptured: CaptureResult | null = null;
          try {
            preCaptured = await captureSelectedText(sourceHwnd);
          } catch {
            preCaptured = null;
          }
          await action(preCaptured ? { preCaptured } : undefined);
        });
      }

      // Timeout: unregister suffix keys
      s.timer = setTimeout(() => clearChordActivation(s), CHORD_TIMEOUT_MS);
    });
  }
  // ...
}
```

### Posibles Issues Identificados

#### Issue 2.1: Doble Presión del Prefix

**Problema:**
Si el usuario presiona el prefix (Alt+Shift+Q) dos veces rápidamente:

1. Primera presión: registra suffix temporales
2. Segunda presión: el callback del prefix se ejecuta de nuevo
3. El timer se resetea
4. Los suffix se re-registran

**Análisis:**
```typescript
const ok = _register(prefix, () => {
  releaseModifiers();
  const s = chordPrefixes.get(prefix)!;
  s.sourceHwnd = getForegroundWindow();

  if (s.timer !== null) {
    clearTimeout(s.timer);  // ← Resetea el timer
    s.timer = null;
  }
  // ...
  s.timer = setTimeout(() => clearChordActivation(s), CHORD_TIMEOUT_MS);
});
```

**Impacto:**
- La ventana de hint puede parpadear
- El usuario puede confundirse con el timing
- Si presiona el suffix después del segundo prefix, puede que el primer suffix callback ya se haya limpiado

**Ubicación:** `src/bun/hotkeys.ts:290-335`

---

#### Issue 2.2: Escritura del Suffix en Pantalla

**Problema Reportado:**
"Si lo hago muy rápido, el segundo hotkey queda escrito en la pantalla y después aparece el menú"

**Análisis:**
Este es el issue más crítico. Posibles causas:

1. **Timing entre prefix y suffix:**
   - El prefix se presiona y libera
   - Los suffix se registran como global shortcuts
   - Si el usuario presiona el suffix MUY rápido después del prefix, puede que:
     - El suffix se registre DESPUÉS de que el usuario lo presione
     - Windows lo interprete como tecla normal (no como shortcut)
     - La tecla se escriba en la aplicación activa

2. **Problema con releaseModifiers():**
   ```typescript
   releaseModifiers();  // ← Se llama en el callback del prefix
   ```
   - Si el usuario aún está manteniendo las teclas del prefix cuando presiona el suffix
   - `releaseModifiers()` puede liberar las teclas del suffix también
   - Esto puede causar que el suffix no se registre como shortcut

3. **Ventana de registro de suffix:**
   ```typescript
   for (const [suf, { cb: action }] of s.actions) {
     GlobalShortcut.register(suf, async () => { ... });
   }
   ```
   - El registro de suffix es síncrono
   - Pero si hay un delay en el registro, el suffix puede no estar listo a tiempo

**Impacto:**
- El suffix se escribe como texto normal en la aplicación
- El menú/chord hint aparece DESPUÉS de que el suffix se escribió
- Comportamiento muy confuso para el usuario

**Ubicación:** `src/bun/hotkeys.ts:290-335`

---

#### Issue 2.3: Timeout de Chord muy Corto

**Problema:**
```typescript
const CHORD_TIMEOUT_MS = 900;
```

**Análisis:**
- 900ms puede ser muy corto para algunos usuarios
- Si el usuario es lento al presionar el suffix, la ventana se cierra
- Esto puede causar que el suffix se escriba como texto normal

**Impacto:**
- Usuarios lentos experimentan comportamiento inconsistente
- El suffix se escribe en lugar de activar el chord

**Ubicación:** `src/bun/hotkeys.ts:258`

---

## Flujo 3: Hotkey de Prompt (ej: Alt+Shift+F → Fix Writing)

### Secuencia de Ejecución

```
1. Usuario presiona hotkey del prompt (ej: Alt+Shift+F)
   ↓
2. Prompt hotkey callback se ejecuta
   ↓
3. Si prompt.confirm = true:
   - Captura texto
   - Verifica selectAllIfEmpty
   - Muestra main window con contexto
   ↓
4. Si prompt.confirm = false:
   - silentReplace() se ejecuta
   - Captura texto
   - Verifica selectAllIfEmpty
   - Llama a LLM
   - Pega resultado
```

### Código Relevante

**En `src/bun/index.ts` (líneas 203-237):**
```typescript
const result = registerHotkeyDetailed(key, prompt.hotkey, (context) => {
  log.info("prompt.hotkey_triggered", { name, hotkey: prompt.hotkey });
  if (prompt.confirm) {
    (async () => {
      const settings = getSettings();
      let captured = {
        text: context?.preCaptured?.text ?? "",
        hwnd: context?.preCaptured?.hwnd ?? null,
        savedClipboard: context?.preCaptured?.savedClipboard ?? null,
      };
      const effectiveSelectAll = prompt.selectAllIfEmpty ?? settings.selectAllIfEmpty;
      if (!captured.text.trim() && effectiveSelectAll) {
        await selectAllText(captured.hwnd);
        const recaptured = await captureSelectedText(captured.hwnd);
        captured = {
          text: recaptured.text,
          hwnd: recaptured.hwnd,
          savedClipboard: recaptured.savedClipboard,
        };
      }
      await showMainWindowWithContext(captured, prompt.name);
    })().catch((e) =>
      log.error("prompt.open_chat_failed", { name, error: e })
    );
    return;
  }
  silentReplace(prompt, {
    inputText: context?.preCaptured?.text,
    hwnd: context?.preCaptured?.hwnd,
    savedClipboard: context?.preCaptured?.savedClipboard,
    onStatus: handleReplaceStatus,
  }).catch((e) =>
    log.error("prompt.replace_failed", { name, error: e })
  );
}, prompt.name);
```

### Posibles Issues Identificados

#### Issue 3.1: selectAllIfEmpty no Funciona Consistentemente

**Problema Reportado:**
"A veces, cuando tengo el seteo de un prompt o global de que, cuando llamo un hotkey y no hay nada seleccionado, seleccione primero todo el texto. Hay veces que eso no funciona: llama al prompt y aparece un mensaje diciendo que no hay texto seleccionado."

**Análisis:**
```typescript
const effectiveSelectAll = prompt.selectAllIfEmpty ?? settings.selectAllIfEmpty;
if (!captured.text.trim() && effectiveSelectAll) {
  await selectAllText(captured.hwnd);
  const recaptured = await captureSelectedText(captured.hwnd);
  captured = {
    text: recaptured.text,
    hwnd: recaptured.hwnd,
    savedClipboard: recaptured.savedClipboard,
  };
}
```

**Posibles causas:**

1. **Timing de selectAllText:**
   ```typescript
   export async function selectAllText(hwnd?: unknown): Promise<void> {
     const target = hwnd ?? u32.GetForegroundWindow();
     if (target) {
       allowSetForegroundWindow();
       forceFocus(target);
     }
     await Bun.sleep(40);
     sendKeys(VK_CONTROL, VK_A);
     await Bun.sleep(40);
   }
   ```
   - Solo hay 40ms de espera después de Ctrl+A
   - Algunos aplicaciones pueden necesitar más tiempo para procesar la selección
   - Si `captureSelectedText` se ejecuta muy rápido, puede capturar antes de que la selección se complete

2. **Problema con hwnd:**
   - `captured.hwnd` puede ser null si la ventana perdió foco
   - `selectAllText(captured.hwnd)` con hwnd null puede no funcionar
   - La recaptura puede fallar si el hwnd no es válido

3. **Clipboard pollution:**
   - `captureSelectedText` limpia el clipboard y lo restaura
   - Si hay múltiples capturas rápidas, el clipboard puede corromperse
   - La restauración del clipboard puede interferir con la selección

**Impacto:**
- selectAllIfEmpty falla intermitentemente
- Usuario ve mensaje de "no hay texto seleccionado"
- Comportamiento inconsistente y frustrante

**Ubicación:** 
- `src/bun/index.ts:213-222`
- `src/bun/replace.ts:113-119`
- `src/bun/ffi.ts:350-359`

---

#### Issue 3.2: Contexto Perdido en Chords de Prompt

**Problema:**
Cuando un prompt usa chord hotkey (ej: Alt+Shift+Q -> Alt+R), el `context?.preCaptured` puede no estar disponible o ser incorrecto.

**Análisis:**
```typescript
// En chord callback (hotkeys.ts:306-317)
GlobalShortcut.register(suf, async () => {
  const sourceHwnd = s.sourceHwnd;  // ← Guardado al presionar prefix
  clearChordActivation(s);
  let preCaptured: CaptureResult | null = null;
  try {
    preCaptured = await captureSelectedText(sourceHwnd);  // ← Captura aquí
  } catch {
    preCaptured = null;
  }
  await action(preCaptured ? { preCaptured } : undefined);
});
```

**Problema:**
- `sourceHwnd` se guarda al presionar el prefix
- Pero entre el prefix y el suffix, el usuario puede cambiar de ventana
- La captura se hace con el hwnd antiguo
- Esto puede causar captura del texto incorrecto o fallida

**Impacto:**
- Chords de prompt pueden capturar texto de la ventana incorrecta
- Comportamiento inconsistente

**Ubicación:** `src/bun/hotkeys.ts:293,312`

---

## Flujo 4: Pausa/Reanudación de Hotkeys

### Secuencia de Ejecución

```
1. Ventana se abre (main, picker, settings, editor)
   ↓
2. onWindowOpen() se llama
   ↓
3. hotkeyPauseDepth se incrementa
   ↓
4. unregisterAll() se llama
   ↓
5. Todos los hotkeys se desregistran
   ↓
6. Ventana se cierra
   ↓
7. onWindowClose() se llama
   ↓
8. hotkeyPauseDepth se decrementa
   ↓
9. applySystemHotkeys() y applyPromptHotkeys() se llaman
   ↓
10. Hotkeys se re-registran
```

### Código Relevante

**En `src/bun/index.ts` (líneas 151-176):**
```typescript
function pauseHotkeys(): void {
  hotkeyPauseDepth += 1;
  if (hotkeyPauseDepth === 1) {
    unregisterAll();
    log.info("hotkeys.paused");
    return;
  }
  log.info("hotkeys.pause_nested", { depth: hotkeyPauseDepth });
}

function resumeHotkeys(): void {
  if (hotkeyPauseDepth === 0) {
    log.warn("hotkeys.resume_ignored_already_zero");
    return;
  }

  hotkeyPauseDepth -= 1;
  if (hotkeyPauseDepth > 0) {
    log.info("hotkeys.resume_deferred", { depth: hotkeyPauseDepth });
    return;
  }

  applySystemHotkeys(getSettings());
  applyPromptHotkeys(currentPrompts);
  log.info("hotkeys.resumed");
}
```

### Posibles Issues Identificados

#### Issue 4.1: Hotkeys no se Re-registran Correctamente

**Problema:**
Si hay un error durante la reanudación, los hotkeys pueden no re-registrarse.

**Análisis:**
```typescript
function resumeHotkeys(): void {
  // ...
  hotkeyPauseDepth -= 1;
  if (hotkeyPauseDepth > 0) {
    return;  // ← Early return si hay nesting
  }

  applySystemHotkeys(getSettings());
  applyPromptHotkeys(currentPrompts);
}
```

**Problema:**
- Si `applySystemHotkeys()` o `applyPromptHotkeys()` fallan silenciosamente
- Los hotkeys no se re-registran
- El usuario tiene que reiniciar la aplicación

**Impacto:**
- Hotkeys dejan de funcionar después de cerrar ventanas
- Comportamiento muy confuso

**Ubicación:** `src/bun/index.ts:161-176`

---

#### Issue 4.2: Race Condition en Pausa/Reanudación

**Problema:**
Si el usuario abre y cierra ventanas rápidamente, puede haber race conditions.

**Análisis:**
```typescript
// En mainview-window.ts (líneas 437-449)
if (mainWindow) {
  // Reuse existing window — do NOT call onWindowOpen() here.
  // It was called when the window was created; calling it again would
  // increment hotkeyPauseDepth without a matching onWindowClose(), causing
  // hotkeys to stay permanently paused after the window closes.
  mainWindow.show();
  // ...
  return;
}
```

**Problema:**
- El código comenta que NO se debe llamar `onWindowOpen()` al reutilizar ventana
- Pero si hay un error en la lógica de reutilización, se puede llamar dos veces
- Esto incrementa `hotkeyPauseDepth` sin decremento correspondiente
- Los hotkeys quedan pausados permanentemente

**Impacto:**
- Hotkeys dejan de funcionar después de cierto uso
- Requiere reinicio de aplicación

**Ubicación:** `src/bun/mainview-window.ts:437-449`

---

## Flujo 5: Captura de Texto Seleccionado

### Secuencia de Ejecución

```
1. captureSelectedText(hwnd) se llama
   ↓
2. Se guarda clipboard actual
   ↓
3. Se limpia clipboard
   ↓
4. releaseModifiers() se llama
   ↓
5. Se hace AttachThreadInput si es necesario
   ↓
6. Se envía Ctrl+C (2 intentos)
   ↓
7. Se lee clipboard con polling
   ↓
8. Se restaura clipboard original
   ↓
9. Se retorna texto capturado
```

### Código Relevante

**En `src/bun/ffi.ts` (líneas 255-327):**
```typescript
export async function captureSelectedText(targetHwnd?: unknown): Promise<CaptureResult> {
  const hwnd = targetHwnd ?? u32.GetForegroundWindow();
  const savedClipboard = readClipboard();

  clearClipboard();

  // Release modifier keys still held from the hotkey combo
  releaseModifiers();

  // AttachThreadInput pattern
  const currentThreadId = k32.GetCurrentThreadId() as number;
  const targetThreadId = u32.GetWindowThreadProcessId(hwnd, null) as number;
  const attached = targetThreadId && targetThreadId !== currentThreadId
    ? (u32.AttachThreadInput(currentThreadId, targetThreadId, true) as boolean)
    : false;

  if (hwnd) {
    u32.BringWindowToTop(hwnd);
    u32.SetForegroundWindow(hwnd);
  }
  await Bun.sleep(80);

  let text = "";
  for (let attempt = 1; attempt <= CAPTURE_COPY_ATTEMPTS; attempt++) {
    const foregroundBeforeCopy = u32.GetForegroundWindow();
    if (hwnd && foregroundBeforeCopy !== hwnd) {
      u32.BringWindowToTop(hwnd);
      u32.SetForegroundWindow(hwnd);
      await Bun.sleep(40);
    }

    clearClipboard();
    const sent = sendKeys(VK_CONTROL, VK_C);
    // ...

    text = await readClipboardWithPolling();
    // ...

    if (text.trim()) break;
    // ...
  }

  if (attached) {
    u32.AttachThreadInput(currentThreadId, targetThreadId, false);
  }

  if (savedClipboard !== null) writeClipboard(savedClipboard);

  return { text, hwnd, savedClipboard };
}
```

### Posibles Issues Identificados

#### Issue 5.1: Timing de Ctrl+C

**Problema:**
```typescript
await Bun.sleep(80);  // ← Espera después de SetForegroundWindow
// ...
const sent = sendKeys(VK_CONTROL, VK_C);
// ...
text = await readClipboardWithPolling();
```

**Análisis:**
- Solo hay 80ms de espera después de enfocar la ventana
- Algunos aplicaciones pueden necesitar más tiempo para procesar el foco
- Si Ctrl+C se envía muy rápido, puede que la ventana no esté lista
- El polling del clipboard puede devolver texto viejo

**Impacto:**
- Captura de texto vacío o incorrecto
- Comportamiento inconsistente entre aplicaciones

**Ubicación:** `src/bun/ffi.ts:280-303`

---

#### Issue 5.2: Problemas con AttachThreadInput

**Problema:**
```typescript
const attached = targetThreadId && targetThreadId !== currentThreadId
  ? (u32.AttachThreadInput(currentThreadId, targetThreadId, true) as boolean)
  : false;
```

**Análisis:**
- `AttachThreadInput` es una operación delicada en Windows
- Si falla silenciosamente, el código continúa como si funcionara
- Esto puede causar que `SetForegroundWindow` no funcione
- El Ctrl+C se envía a la ventana incorrecta

**Impacto:**
- Captura de texto de la ventana incorrecta
- Comportamiento muy impredecible

**Ubicación:** `src/bun/ffi.ts:270-274`

---

#### Issue 5.3: Restauración del Clipboard

**Problema:**
```typescript
if (savedClipboard !== null) writeClipboard(savedClipboard);
```

**Análisis:**
- Si hay múltiples capturas rápidas, el clipboard puede corromperse
- La restauración puede interferir con capturas simultáneas
- No hay lock o mutex para proteger el clipboard

**Impacto:**
- Pérdida de datos en el clipboard
- Capturas fallidas

**Ubicación:** `src/bun/ffi.ts:324`

---

## Flujo 6: Reemplazo Silencioso

### Secuencia de Ejecución

```
1. silentReplace() se llama
   ↓
2. Se captura texto (o se usa texto proporcionado)
   ↓
3. Si selectAllIfEmpty y texto vacío:
   - Se selecciona todo
   - Se recaptura texto
   ↓
4. Si texto sigue vacío:
   - Se retorna error "No text is selected"
   ↓
5. Se llama a LLM
   ↓
6. Se pega resultado
   ↓
7. Se muestra toast de undo
```

### Código Relevante

**En `src/bun/replace.ts` (líneas 54-186):**
```typescript
export async function silentReplace(
  prompt: Prompt,
  options: {
    promptBody?: string;
    inputText?: string;
    hwnd?: unknown;
    savedClipboard?: string | null;
    onStatus?: (status: ReplaceStatus) => void;
  } = {}
): Promise<ReplaceResult | null> {
  // ...
  
  // 1. Capture selected text (or use provided)
  let captureResult: { text: string; hwnd: unknown; savedClipboard: string | null };

  if (options.inputText !== undefined) {
    // Came from confirm dialog — we already have text
    captureResult = {
      text: options.inputText,
      hwnd: options.hwnd ?? null,
      savedClipboard: options.savedClipboard ?? null,
    };
  } else {
    notify("capturing", "Capturing selected text");
    captureResult = await captureSelectedText(options.hwnd);
  }

  let inputText = captureResult.text.trim();
  const effectiveSelectAll = prompt.selectAllIfEmpty ?? settings.selectAllIfEmpty;
  if (!inputText && effectiveSelectAll) {
    notify("capturing", "Nothing selected - selecting all text");
    await selectAllText(captureResult.hwnd);
    captureResult = await captureSelectedText(captureResult.hwnd);
    inputText = captureResult.text.trim();
  }
  if (!inputText) {
    log.warn("capture.empty", { promptName: prompt.name });
    updateHwnd("error", "No text is selected");
    return null;
  }
  // ...
}
```

### Posibles Issues Identificados

#### Issue 6.1: Doble Captura en selectAllIfEmpty

**Problema:**
```typescript
if (!inputText && effectiveSelectAll) {
  notify("capturing", "Nothing selected - selecting all text");
  await selectAllText(captureResult.hwnd);
  captureResult = await captureSelectedText(captureResult.hwnd);  // ← Segunda captura
  inputText = captureResult.text.trim();
}
```

**Análisis:**
- Se hacen DOS capturas de texto
- La primera captura puede fallar o devolver texto vacío
- `selectAllText` se ejecuta entre las dos capturas
- Si hay timing issues, la segunda captura puede fallar también

**Impacto:**
- selectAllIfEmpty falla intermitentemente
- Usuario ve mensaje de error "No text is selected"

**Ubicación:** `src/bun/replace.ts:113-124`

---

## Resumen de Issues Críticos

### Alta Prioridad

1. **Issue 2.2: Escritura del Suffix en Pantalla**
   - Causa principal del problema reportado
   - Necesita investigación profunda del timing de registro de suffix
   - Posible solución: aumentar delay antes de registrar suffix o usar enfoque diferente

2. **Issue 3.1: selectAllIfEmpty no Funciona**
   - Causa del problema reportado
   - Timing insuficiente después de Ctrl+A
   - Posible solución: aumentar sleep después de selectAllText

3. **Issue 1.1: Race Condition en captureSequence**
   - Comportamiento impredecible en uso rápido
   - Posible solución: usar lock/mutex o cancelar capturas anteriores

### Media Prioridad

4. **Issue 2.1: Doble Presión del Prefix**
   - Confusión visual con hint
   - Posible solución: ignorar prefix si ya está activo

5. **Issue 4.1: Hotkeys no se Re-registran**
   - Hotkeys dejan de funcionar
   - Posible solución: agregar try-catch y logging detallado

6. **Issue 5.1: Timing de Ctrl+C**
   - Captura inconsistente
   - Posible solución: aumentar sleep o hacer polling de estado de ventana

### Baja Prioridad

7. **Issue 2.3: Timeout de Chord muy Corto**
   - Afecta usuarios lentos
   - Posible solución: hacer configurable o aumentar a 1500ms

8. **Issue 5.2: Problemas con AttachThreadInput**
   - Comportamiento impredecible
   - Posible solución: agregar validación y fallback

9. **Issue 5.3: Restauración del Clipboard**
   - Pérdida de datos
   - Posible solución: usar lock/mutex para clipboard

---

## Recomendaciones Generales

### 1. Logging Mejorado

Agregar más logs detallados para debugging:

```typescript
// En hotkeys.ts
log.info("chord.prefix_pressed", { prefix, timestamp: Date.now() });
log.info("chord.suffix_registered", { suffix, delay: Date.now() - prefixTime });
log.info("chord.suffix_triggered", { suffix, timestamp: Date.now() });

// En ffi.ts
log.info("capture.start", { hwnd, timestamp: Date.now() });
log.info("capture.ctrl_c_sent", { attempt, timestamp: Date.now() });
log.info("capture.clipboard_read", { chars: text.length, timestamp: Date.now() });
```

### 2. Configuración de Timeouts

Hacer configurables los timeouts críticos:

```typescript
// En settings.ts
hotkeys: {
  chordTimeout: 900,  // Configurable
  chordHintDelay: 400,
  captureDelay: 80,
  selectAllDelay: 40,
}
```

### 3. Validación de Estado

Agregar validación antes de operaciones críticas:

```typescript
// En hotkeys.ts
if (chordPrefixes.has(prefix) && chordPrefixes.get(prefix)!.actions.size > 0) {
  log.warn("chord.prefix_already_active", { prefix });
  return;  // Ignorar prefix si ya está activo
}
```

### 4. Mutex para Operaciones Compartidas

Usar mutex para proteger operaciones compartidas:

```typescript
// En ffi.ts
let clipboardMutex = false;

export async function captureSelectedText(...) {
  while (clipboardMutex) {
    await Bun.sleep(10);
  }
  clipboardMutex = true;
  try {
    // ... operación
  } finally {
    clipboardMutex = false;
  }
}
```

---

## Próximos Pasos

1. **Reproducir los issues reportados** en un entorno controlado
2. **Agregar logging detallado** para capturar el timing exacto
3. **Implementar fixes** para los issues de alta prioridad
4. **Testing exhaustivo** con diferentes aplicaciones Windows
5. **Documentar** cualquier issue adicional encontrado
