# Diagramas de Flujos de Hotkeys

## Diagrama 1: Flujo General del Sistema de Hotkeys

```mermaid
flowchart TD
    A[Usuario presiona Hotkey] --> B{¿Es Hotkey del Sistema?}
    
    B -->|Sí| C[handlePromptChat / handlePromptPicker]
    B -->|No| D{¿Es Hotkey de Prompt?}
    
    D -->|Sí| E[Callback del Prompt]
    D -->|No| F{¿Es Chord Prefix?}
    
    F -->|Sí| G[Activar Chord Mode]
    F -->|No| H[Ignorar]
    
    G --> I[Registrar Suffix Temporalmente<br/>900ms window]
    I --> J[Mostrar Chord Hint<br/>después de 400ms]
    J --> K{Usuario presiona Suffix?}
    
    K -->|Sí| L[Ejecutar Acción del Chord]
    K -->|No| M[Timeout: Limpiar Suffix<br/>después de 900ms]
    
    C --> N[showMainWindow / showPicker]
    E --> O{¿prompt.confirm?}
    
    O -->|Sí| P[showMainWindowWithContext]
    O -->|No| Q[silentReplace]
    
    P --> R[Capturar Texto]
    Q --> R
    
    R --> S{¿Texto vacío?}
    S -->|Sí| T{¿selectAllIfEmpty?}
    S -->|No| U[Procesar Texto]
    
    T -->|Sí| V[selectAllText + Recapturar]
    T -->|No| W[Error: No text selected]
    
    V --> X{¿Texto sigue vacío?}
    X -->|Sí| W
    X -->|No| U
    
    U --> Y[LLM Processing]
    Y --> Z[Pegar Resultado]
    
    L --> R
    
    style A fill:#e1f5ff
    style G fill:#fff4e1
    style Q fill:#e1ffe1
    style W fill:#ffe1e1
```

---

## Diagrama 2: Flujo Detallado de Chord Hotkey

```mermaid
sequenceDiagram
    participant U as Usuario
    participant HS as Hotkey System
    participant GS as GlobalShortcut
    participant CH as Chord Hint
    participant FFI as FFI (Windows API)
    participant App as Aplicación Destino

    Note over U,App: Flujo Normal (Exitoso)
    
    U->>HS: Presiona Alt+Shift+Q (Prefix)
    HS->>HS: releaseModifiers()
    HS->>HS: Guardar sourceHwnd
    HS->>GS: Registrar Suffix (Alt+R)
    Note over GS: 900ms window activo
    
    rect rgb(255, 244, 225)
        Note over HS,CH: Después de 400ms
        HS->>CH: Mostrar hint con opciones
    end
    
    U->>HS: Presiona Alt+R (Suffix) dentro de 900ms
    HS->>GS: Callback del Suffix
    GS->>HS: clearChordActivation()
    HS->>FFI: captureSelectedText()
    FFI->>App: Ctrl+C
    App-->>FFI: Texto seleccionado
    FFI-->>HS: {text, hwnd, savedClipboard}
    HS->>HS: Ejecutar acción del chord
    HS->>App: Aplicar resultado
    
    Note over U,App: Flujo con Problema (Doble Presión Rápida)
    
    U->>HS: Presiona Alt+Shift+Q (1er Prefix)
    HS->>GS: Registrar Suffix
    Note over GS: Timer: 900ms
    
    U->>HS: Presiona Alt+Shift+Q (2do Prefix) - MUY RÁPIDO
    HS->>HS: releaseModifiers() ← Libera teclas del suffix también
    HS->>GS: Re-registrar Suffix
    Note over GS: Timer se resetea: 900ms
    
    U->>HS: Presiona Alt+R (Suffix)
    Note over HS: ⚠️ Problema: Suffix puede no estar registrado aún
    Note over App: ⚠️ Windows interpreta como tecla normal
    App->>App: Escribe "R" en pantalla
    
    rect rgb(255, 225, 225)
        Note over HS,CH: 400ms después del 2do prefix
        HS->>CH: Mostrar hint ← Aparece DESPUÉS de escribir "R"
    end
```

---

## Diagrama 3: Flujo de selectAllIfEmpty

```mermaid
flowchart TD
    A[Iniciar silentReplace] --> B[Capturar texto actual]
    B --> C{¿Texto vacío?}
    
    C -->|No| D[Procesar con LLM]
    C -->|Sí| E{¿selectAllIfEmpty activo?}
    
    E -->|No| F[Error: No text selected]
    E -->|Sí| G[selectAllText hwnd]
    
    G --> H[Esperar 40ms]
    H --> I[Enviar Ctrl+A]
    I --> J[Esperar 40ms]
    J --> K[Recapturar texto]
    
    K --> L{¿Texto sigue vacío?}
    L -->|Sí| F
    L -->|No| D
    
    D --> M[LLM Processing]
    M --> N[Pegar resultado]
    
    style F fill:#ffe1e1
    style G fill:#e1ffe1
    style K fill:#e1f5ff
```

---

## Diagrama 4: Flujo de Pausa/Reanudación de Hotkeys

```mermaid
stateDiagram-v2
    [*] --> HotkeysActivos: App inicia
    
    HotkeysActivos --> HotkeysPausados: Ventana abre<br/>onWindowOpen()
    note right of HotkeysPausados: hotkeyPauseDepth = 1<br/>unregisterAll()
    
    HotkeysPausados --> HotkeysPausados: Otra ventana abre<br/>onWindowOpen()
    note right of HotkeysPausados: hotkeyPauseDepth = 2<br/>Ya pausados, no hacer nada
    
    HotkeysPausados --> HotkeysPausados: Una ventana cierra<br/>onWindowClose()
    note right of HotkeysPausados: hotkeyPauseDepth = 1<br/>Aún pausados
    
    HotkeysPausados --> HotkeysActivos: Última ventana cierra<br/>onWindowClose()
    note right of HotkeysActivos: hotkeyPauseDepth = 0<br/>applySystemHotkeys()<br/>applyPromptHotkeys()
    
    HotkeysActivos --> [*]: App cierra
```

---

## Diagrama 5: Flujo de Captura de Texto (FFI)

```mermaid
flowchart TD
    A[captureSelectedText hwnd] --> B[Leer clipboard actual]
    B --> C[Limpiar clipboard]
    C --> D[releaseModifiers]
    D --> E[AttachThreadInput<br/>si es necesario]
    E --> F[SetForegroundWindow hwnd]
    F --> G[Esperar 80ms]
    
    G --> H[Intento 1/2]
    H --> I[Verificar ventana activa]
    I --> J[Limpiar clipboard]
    J --> K[Enviar Ctrl+C]
    K --> L[Leer clipboard con polling<br/>4 intentos, 75ms cada uno]
    L --> M{¿Texto no vacío?}
    
    M -->|Sí| N[Salir del loop]
    M -->|No| O{¿Más intentos?}
    O -->|Sí| P[Esperar 60ms]
    P --> H
    O -->|No| N
    
    N --> Q[Desadjuntar ThreadInput]
    Q --> R[Restaurar clipboard original]
    R --> S[Retornar {text, hwnd, savedClipboard}]
    
    style K fill:#fff4e1
    style L fill:#e1f5ff
```

---

## Diagrama 6: Problema de Timing en Chord (Issue 2.2)

```mermaid
sequenceDiagram
    participant U as Usuario
    participant W as App Windows
    participant HS as Hotkey System
    participant GS as GlobalShortcut

    Note over U,GS: Escenario: Presión muy rápida de Prefix y Suffix
    
    U->>W: Alt+Shift+Q (Prefix)
    W->>HS: Prefix callback
    HS->>HS: releaseModifiers()
    Note over HS: ⚠️ Libera Shift, Alt, Q
    
    HS->>GS: Registrar Alt+R como shortcut
    Note over GS: Registro síncrono
    
    U->>W: Alt+R (Suffix) - INMEDIATAMENTE
    Note over W: ⚠️ Alt+R aún NO registrado como shortcut
    W->>W: Windows interpreta como tecla normal
    W->>W: Escribe "R" en el campo de texto activo
    
    Note over GS: Registro de Alt+R se completa
    GS->>HS: Suffix callback se ejecuta
    HS->>W: Mostrar menú/chord hint
    Note over W: ⚠️ Aparece DESPUÉS de escribir "R"
    
    Note over U,GS: Solución propuesta: Delay antes de registrar suffix
    
    U->>W: Alt+Shift+Q (Prefix)
    W->>HS: Prefix callback
    HS->>HS: releaseModifiers()
    HS->>HS: Esperar 50ms
    HS->>GS: Registrar Alt+R como shortcut
    Note over GS: Registro con delay
    U->>W: Alt+R (Suffix)
    GS->>HS: Suffix callback se ejecuta
    HS->>W: Mostrar menú/chord hint
    Note over W: ✓ Aparece correctamente
```

---

## Diagrama 7: Problema de selectAllIfEmpty (Issue 3.1)

```mermaid
sequenceDiagram
    participant U as Usuario
    participant HS as Hotkey System
    participant FFI as FFI (Windows API)
    participant App as Aplicación (ej: Word)

    Note over U,App: Escenario: Texto no seleccionado, selectAllIfEmpty activo
    
    U->>HS: Presiona hotkey de prompt
    HS->>FFI: captureSelectedText()
    FFI->>App: Ctrl+C
    App-->>FFI: Texto vacío (nada seleccionado)
    FFI-->>HS: {text: "", hwnd, savedClipboard}
    
    HS->>HS: ¿Texto vacío? Sí
    HS->>HS: ¿selectAllIfEmpty? Sí
    
    HS->>FFI: selectAllText(hwnd)
    FFI->>App: Ctrl+A
    Note over App: ⚠️ Word necesita tiempo para procesar selección
    Note over FFI: Solo espera 40ms
    
    FFI->>FFI: captureSelectedText(hwnd)
    FFI->>App: Ctrl+C
    Note over App: ⚠️ Ctrl+C se envía ANTES de que la selección se complete
    App-->>FFI: Texto vacío (selección no completada)
    FFI-->>HS: {text: "", hwnd, savedClipboard}
    
    HS->>HS: ¿Texto sigue vacío? Sí
    HS->>U: Error: "No text is selected"
    
    Note over U,App: Solución propuesta: Aumentar delay después de Ctrl+A
    
    U->>HS: Presiona hotkey de prompt
    HS->>FFI: captureSelectedText()
    FFI->>App: Ctrl+C
    App-->>FFI: Texto vacío
    FFI-->>HS: {text: "", hwnd, savedClipboard}
    
    HS->>FFI: selectAllText(hwnd)
    FFI->>App: Ctrl+A
    Note over FFI: Espera 100ms ← Aumentado
    FFI->>FFI: captureSelectedText(hwnd)
    FFI->>App: Ctrl+C
    App-->>FFI: Texto seleccionado ✓
    FFI-->>HS: {text: "texto completo", hwnd, savedClipboard}
    
    HS->>HS: ¿Texto vacío? No
    HS->>FFI: Procesar con LLM
    FFI-->>HS: Resultado
    HS->>App: Pegar resultado ✓
```

---

## Diagrama 8: Arquitectura del Sistema de Hotkeys

```mermaid
graph TB
    subgraph "Capa de Aplicación"
        A[Usuario]
        B[Aplicación Windows<br/>Word, Chrome, etc.]
    end
    
    subgraph "Capa de Hotkeys"
        C[GlobalShortcut<br/>Electrobun API]
        D[hotkeys.ts<br/>Gestor Central]
        E[chord-hint.ts<br/>UI de Hints]
    end
    
    subgraph "Capa de FFI"
        F[ffi.ts<br/>Windows API]
        G[user32.dll<br/>SetForegroundWindow<br/>SendInput]
        H[kernel32.dll<br/>GlobalAlloc<br/>GetCurrentThreadId]
    end
    
    subgraph "Capa de Lógica"
        I[index.ts<br/>Coordinación]
        J[replace.ts<br/>Reemplazo Silencioso]
        K[prompts.ts<br/>Gestión de Prompts]
        L[settings.ts<br/>Configuración]
    end
    
    subgraph "Capa de Ventanas"
        M[mainview-window.ts<br/>Chat Window]
        N[picker.ts<br/>Prompt Picker]
        O[settings-window.ts<br/>Settings]
        P[editor-window.ts<br/>Prompt Editor]
    end
    
    A -->|Presiona hotkey| C
    C -->|Callback| D
    D -->|Mostrar hint| E
    D -->|Capturar texto| F
    F -->|Win32 API| G
    F -->|Win32 API| H
    D -->|Ejecutar acción| I
    I -->|Reemplazar| J
    I -->|Cargar prompts| K
    I -->|Leer config| L
    I -->|Abrir ventana| M
    I -->|Abrir ventana| N
    I -->|Abrir ventana| O
    I -->|Abrir ventana| P
    M -->|Pegar texto| B
    N -->|Pegar texto| B
    
    style C fill:#e1f5ff
    style D fill:#fff4e1
    style F fill:#e1ffe1
    style I fill:#ffe1f5
```

---

## Diagrama 9: Timeline de un Chord Exitoso vs Fallido

```mermaid
gantt
    title Timeline de Chord Hotkey
    dateFormat X
    axisFormat %L ms
    
    section Chord Exitoso
    Presionar Prefix (Alt+Shift+Q) :a1, 0, 50
    releaseModifiers() :a2, 50, 10
    Registrar Suffix (Alt+R) :a3, 60, 20
    Esperar 400ms :a4, 80, 400
    Mostrar Chord Hint :a5, 480, 50
    Presionar Suffix (Alt+R) :a6, 600, 50
    Ejecutar Acción :a7, 650, 100
    
    section Chord Fallido (Presión Rápida)
    Presionar Prefix (Alt+Shift+Q) :b1, 0, 50
    releaseModifiers() :b2, 50, 10
    Registrar Suffix (Alt+R) :b3, 60, 20
    Presionar Prefix (Alt+Shift+Q) :b4, 80, 50
    releaseModifiers() :b5, 130, 10
    Re-registrar Suffix (Alt+R) :b6, 140, 20
    Presionar Suffix (Alt+R) :b7, 160, 50
    ⚠️ Suffix no registrado aún :crit, 160, 50
    Windows escribe "R" :crit, 160, 50
    Esperar 400ms :b8, 180, 400
    Mostrar Chord Hint :b9, 580, 50
    ⚠️ Aparece después de escribir "R" :crit, 580, 50
```

---

## Diagrama 10: Estado de ChordPrefixes

```mermaid
stateDiagram-v2
    [*] --> Inactivo
    
    Inactivo --> PrefixPresionado: Alt+Shift+Q
    note right of PrefixPresionado: actions: Map vacío<br/>timer: null<br/>hintTimer: null<br/>sourceHwnd: null
    
    PrefixPresionado --> SuffixRegistrados: Registrar suffixes
    note right of SuffixRegistrados: actions: {Alt+R → callback}<br/>timer: 900ms<br/>hintTimer: 400ms<br/>sourceHwnd: ventana activa
    
    SuffixRegistrados --> HintVisible: 400ms pasan
    note right of HintVisible: Mostrar ventana de hint
    
    HintVisible --> SuffixEjecutado: Alt+R presionado
    note right of SuffixEjecutado: clearChordActivation()<br/>Ejecutar callback
    
    SuffixRegistrados --> Timeout: 900ms pasan
    note right of Timeout: clearChordActivation()
    
    SuffixRegistrados --> PrefixPresionado: Alt+Shift+Q de nuevo
    note right of PrefixPresionado: ⚠️ Timer se resetea<br/>Suffix se re-registran
    
    SuffixEjecutado --> Inactivo
    Timeout --> Inactivo
    
    note right of SuffixRegistrados
    Posible Issue: Si prefix se presiona dos veces
    rápidamente, el timer se resetea y los
    suffix se re-registran, causando confusión
    end note
```

---

## Notas sobre los Diagramas

### Diagrama 1: Flujo General
Muestra la ruta principal desde que el usuario presiona un hotkey hasta que se ejecuta la acción. Los colores indican:
- 🔵 Azul: Inicio del flujo
- 🟡 Amarillo: Chord mode
- 🟢 Verde: Reemplazo silencioso
- 🔴 Rojo: Error

### Diagrama 2: Flujo de Chord
Compara el flujo exitoso con el flujo problemático de doble presión. El área naranja muestra el timing crítico.

### Diagrama 3: selectAllIfEmpty
Muestra el flujo de selección automática cuando no hay texto seleccionado. El área roja indica el punto de fallo.

### Diagrama 4: Pausa/Reanudación
Muestra cómo el sistema maneja múltiples ventanas abiertas usando un contador de profundidad.

### Diagrama 5: Captura de Texto
Detalle del proceso de captura vía FFI, incluyendo los reintentos y polling del clipboard.

### Diagrama 6: Problema de Timing
Ilustra visualmente el Issue 2.2 y la solución propuesta con delay.

### Diagrama 7: Problema de selectAllIfEmpty
Muestra por qué selectAllIfEmpty falla y cómo el aumento de delay lo soluciona.

### Diagrama 8: Arquitectura
Vista general de las capas del sistema y sus interacciones.

### Diagrama 9: Timeline
Compara visualmente el timing de un chord exitoso vs fallido.

### Diagrama 10: Estado de ChordPrefixes
Máquina de estados que muestra las transiciones del sistema de chords.
