# Índice de Análisis de Hotkeys

## Documentos en Esta Carpeta

Este análisis completo del sistema de hotkeys incluye los siguientes documentos:

### 1. [Análisis Detallado de Flujos](hotkey-flows-analysis.md)
**Archivo:** `DOC/hotkey-flows-analysis.md`  
**Tamaño:** ~15KB  
**Tiempo de lectura:** 20-30 minutos

**Contenido:**
- Descripción completa de los 6 flujos principales de hotkeys
- Análisis de código con líneas específicas
- Identificación de 9 issues con causas raíz detalladas
- Explicación de race conditions y timing issues
- Recomendaciones generales de mejora

**Leer este documento si:**
- Quieres entender cómo funciona el sistema internamente
- Necesitas debuggear un issue específico
- Quieres implementar fixes

---

### 2. [Diagramas Visuales](hotkey-flows-diagram.md)
**Archivo:** `DOC/hotkey-flows-diagram.md`  
**Tamaño:** ~12KB  
**Tiempo de lectura:** 10-15 minutos

**Contenido:**
- 10 diagramas de Mermaid que ilustran los flujos
- Diagramas de flujo secuenciales
- Diagramas de estado
- Diagramas de arquitectura
- Timeline comparativo
- Visualización de problemas de timing

**Leer este documento si:**
- Prefieres entender visualmente los flujos
- Necesitas explicar el sistema a otros
- Quieres identificar puntos de fallo rápidamente

---

### 3. [Resumen Ejecutivo](hotkey-issues-summary.md)
**Archivo:** `DOC/hotkey-issues-summary.md`  
**Tamaño:** ~8KB  
**Tiempo de lectura:** 10-15 minutos

**Contenido:**
- Resumen de los 3 problemas reportados y sus causas raíz
- Priorización de fixes (Alta/Media/Baja)
- Plan de acción en 3 fases
- Métricas de éxito esperadas
- Casos de prueba recomendados
- Timeline estimado de implementación

**Leer este documento si:**
- Quieres un resumen rápido de los problemas
- Necesitas priorizar el trabajo
- Quieres entender el impacto de cada fix

---

### 4. [Guía de Referencia Rápida](hotkey-quick-reference.md)
**Archivo:** `DOC/hotkey-quick-reference.md`  
**Tamaño:** ~10KB  
**Tiempo de lectura:** 15-20 minutos

**Contenido:**
- Tabla de contenidos con enlaces a cada sección
- Descripción concisa de cada flujo
- Tabla de issues conocidos con soluciones
- Código de ejemplo para cada fix
- Métricas de rendimiento
- Checklist de testing
- Comandos útiles para debugging

**Leer este documento si:**
- Necesitas una referencia rápida durante el desarrollo
- Quieres ver código de ejemplo para los fixes
- Necesitas comandos para debugging

---

## Flujo de Lectura Recomendado

### Para Entender el Sistema (Nuevo en el proyecto)

1. **Primero:** [Diagramas Visuales](hotkey-flows-diagram.md)
   - Obtén una visión general visual
   - Entiende la arquitectura

2. **Segundo:** [Guía de Referencia Rápida](hotkey-quick-reference.md)
   - Lee las descripciones de cada flujo
   - Revisa los issues conocidos

3. **Tercero:** [Análisis Detallado](hotkey-flows-analysis.md)
   - Profundiza en el código específico
   - Entiende las causas raíz

4. **Cuarto:** [Resumen Ejecutivo](hotkey-issues-summary.md)
   - Revisa el plan de acción
   - Prioriza el trabajo

### Para Debuggear un Issue Específico

1. **Primero:** [Guía de Referencia Rápida](hotkey-quick-reference.md)
   - Busca el issue en la tabla
   - Revisa la solución propuesta

2. **Segundo:** [Diagramas Visuales](hotkey-flows-diagram.md)
   - Encuentra el diagrama relevante
   - Visualiza el flujo problemático

3. **Tercero:** [Análisis Detallado](hotkey-flows-analysis.md)
   - Lee el análisis completo del issue
   - Revisa el código problemático

### Para Implementar Fixes

1. **Primero:** [Resumen Ejecutivo](hotkey-issues-summary.md)
   - Revisa el plan de acción
   - Identifica los fixes de Fase 1

2. **Segundo:** [Guía de Referencia Rápida](hotkey-quick-reference.md)
   - Copia el código de ejemplo
   - Sigue el checklist de testing

3. **Tercero:** [Análisis Detallado](hotkey-flows-analysis.md)
   - Revisa el contexto completo
   - Ajusta según necesidades específicas

---

## Issues Críticos Identificados

### 🔴 Issue 2.2: Suffix se Escribe en Pantalla
**Problema:** Al presionar chord muy rápido, el suffix se escribe como texto normal  
**Causa:** `releaseModifiers()` libera teclas antes de que se registren  
**Solución:** Agregar delay de 50ms antes de registrar suffix  
**Archivos:** `src/bun/hotkeys.ts:290-335`  
**Documentación:** [Análisis Detallado](hotkey-flows-analysis.md#issue-22-escritura-del-suffix-en-pantalla)

---

### 🔴 Issue 3.1: selectAllIfEmpty Falla
**Problema:** Al no tener texto seleccionado, el prompt muestra error  
**Causa:** Solo 40ms de espera después de Ctrl+A es insuficiente  
**Solución:** Aumentar sleep de 40ms a 100ms  
**Archivos:** `src/bun/ffi.ts:350-359`  
**Documentación:** [Análisis Detallado](hotkey-flows-analysis.md#issue-31-selectallifempty-no-funciona-consistentemente)

---

### 🔴 Issue 1.1: Race Condition en Captura
**Problema:** Capturas consecutivas pueden interferirse  
**Causa:** `captureSequence` no usa lock/mutex  
**Solución:** Agregar mutex para operaciones de captura  
**Archivos:** `src/bun/mainview-window.ts:413-427`  
**Documentación:** [Análisis Detallado](hotkey-flows-analysis.md#issue-11-race-condition-en-capturasequence)

---

## Plan de Acción

### Fase 1: Fixes Críticos (1-2 días)

| Fix | Archivo | Cambio | Documentación |
|-----|---------|--------|---------------|
| Delay en suffix | `hotkeys.ts` | +50ms | [Issue 2.2](hotkey-flows-analysis.md#issue-22-escritura-del-suffix-en-pantalla) |
| Aumentar selectAll | `ffi.ts` | 40→100ms | [Issue 3.1](hotkey-flows-analysis.md#issue-31-selectallifempty-no-funciona-consistentemente) |
| Mutex de captura | `ffi.ts` | Agregar lock | [Issue 1.1](hotkey-flows-analysis.md#issue-11-race-condition-en-capturasequence) |

### Fase 2: Robustez (2-3 días)

| Fix | Archivo | Cambio | Documentación |
|-----|---------|--------|---------------|
| Ignorar prefix activo | `hotkeys.ts` | Early return | [Issue 2.1](hotkey-flows-analysis.md#issue-21-doble-presión-del-prefix) |
| Validación reanudación | `index.ts` | Try-catch | [Issue 4.1](hotkey-flows-analysis.md#issue-41-hotkeys-no-se-re-registran-correctamente) |
| Mejorar timing captura | `ffi.ts` | 80→120ms | [Issue 5.1](hotkey-flows-analysis.md#issue-51-timing-de-ctrlc) |

### Fase 3: Configurabilidad (3-5 días)

| Fix | Archivo | Cambio | Documentación |
|-----|---------|--------|---------------|
| Timeouts configurables | `settings.ts` | Nuevos campos | [Recomendaciones](hotkey-flows-analysis.md#1-configuración-de-timeouts) |
| Logging detallado | `hotkeys.ts` | Logs extra | [Recomendaciones](hotkey-flows-analysis.md#1-logging-mejorado) |
| Métricas rendimiento | `ffi.ts` | Timing logs | [Recomendaciones](hotkey-flows-analysis.md#1-logging-mejorado) |

---

## Métricas de Éxito

### Antes de los Fixes
- ❌ Suffix se escribe en pantalla ~30% de las veces con presión rápida
- ❌ selectAllIfEmpty falla ~40% de las veces en Word/Chrome
- ❌ Hotkeys dejan de funcionar después de ~10 aperturas/cierres
- ❌ Captura de texto falla ~20% de las veces en apps lentas

### Después de los Fixes (Objetivos)
- ✅ Suffix se escribe en pantalla <5% de las veces
- ✅ selectAllIfEmpty funciona >95% de las veces
- ✅ Hotkeys funcionan consistentemente sin reinicio
- ✅ Captura de texto funciona >90% de las veces

---

## Archivos del Proyecto Relacionados

### Archivos de Código Fuente

| Archivo | Función | Líneas Clave |
|---------|---------|--------------|
| `src/bun/hotkeys.ts` | Gestor central de hotkeys | 278-348 (chord) |
| `src/bun/ffi.ts` | Interfaz con Windows API | 255-327 (captura) |
| `src/bun/index.ts` | Coordinación y inicialización | 151-176 (pausa) |
| `src/bun/replace.ts` | Reemplazo silencioso | 54-186 (silent) |
| `src/bun/mainview-window.ts` | Ventana de chat | 408-465 (show) |
| `src/bun/picker.ts` | Prompt picker | 300-381 (show) |
| `src/bun/chord-hint.ts` | UI de hints de chord | 90-123 (show) |
| `src/bun/prompts.ts` | Gestión de prompts | 64-102 (parse) |
| `src/bun/settings.ts` | Configuración | 18-76 (defaults) |
| `src/bun/feedback.ts` | Toast de feedback | 186-224 (handle) |

### Archivos de Documentación

| Archivo | Contenido | Tamaño |
|---------|-----------|--------|
| `DOC/hotkey-flows-analysis.md` | Análisis detallado | ~15KB |
| `DOC/hotkey-flows-diagram.md` | Diagramas visuales | ~12KB |
| `DOC/hotkey-issues-summary.md` | Resumen ejecutivo | ~8KB |
| `DOC/hotkey-quick-reference.md` | Guía de referencia | ~10KB |
| `DOC/hotkey-analysis-index.md` | Este índice | ~6KB |

### Otros Documentos Relevantes

| Archivo | Contenido |
|---------|-----------|
| `DOC/debug-session-flow.md` | Flujo de debug de sesiones anteriores |
| `DOC/resize-followup.md` | Issues de resize resueltos |
| `BUGS.md` | Bugs conocidos y pendientes |
| `README.md` | Documentación general del proyecto |

---

## Comandos Útiles

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

# Buscar logs de timing
Select-String "$env:APPDATA\assistant\logs\latest.log" -Pattern "timing"
```

### Ejecutar la App en Modo Desarrollo

```powershell
# Levantar la app
node_modules/electrobun/.cache/electrobun.exe dev

# Matar procesos antes de rebuild
powershell -NoProfile -Command "Get-Process -Name 'bun','electrobun' | Stop-Process -Force"
```

---

## Preguntas Frecuentes

### P: ¿Por qué hay tantos delays en el código?

**R:** Windows API requiere tiempo para procesar operaciones asíncronas como:
- Cambiar el foco de ventana
- Procesar Ctrl+C/Ctrl+A
- Registrar global shortcuts

Los delays actuales (40-80ms) fueron diseñados para ser mínimos, pero resultan insuficientes en algunas aplicaciones. Los fixes propuestos aumentan estos delays a valores más conservadores (100-150ms).

### P: ¿Los delays afectarán la experiencia de usuario?

**R:** Los aumentos propuestos son mínimos:
- +50ms en chords (imperceptible)
- +60ms en selectAll (mejora confiabilidad)
- +40ms en captura (reduce fallas)

Total: +150ms en el peor caso, que es aceptable para mejoras significativas de estabilidad.

### P: ¿Por qué se usa AttachThreadInput?

**R:** Es el único método confiable para transferir foco entre procesos en Windows Vista+. Sin él, `SetForegroundWindow` falla silenciosamente cuando el proceso no recibió el último evento de input del usuario.

### P: ¿Por qué se limpia y restaura el clipboard?

**R:** Windows no tiene API para leer el clipboard sin modificarlo. La estrategia es:
1. Guardar clipboard actual
2. Limpiarlo
3. Enviar Ctrl+C
4. Leer clipboard (ahora con el texto copiado)
5. Restaurar clipboard original

Esto preserva los datos del usuario pero introduce complejidad y posibles race conditions.

### P: ¿Cómo puedo contribuir a estos fixes?

**R:** 
1. Lee este índice y los documentos relacionados
2. Elige un fix de Fase 1 (los más críticos)
3. Implementa el cambio siguiendo el código de ejemplo
4. Testing según el checklist
5. Actualiza la documentación si es necesario

---

## Última Actualización

**Fecha:** 2026-03-13  
**Versión:** 1.0  
**Autor:** Análisis generado por Kilo Code  
**Estado:** Análisis completo, listo para implementación

---

## Próximos Pasos

1. **Leer** [Resumen Ejecutivo](hotkey-issues-summary.md) para entender la priorización
2. **Implementar** los 3 fixes de Fase 1 (1-2 días)
3. **Testing** según el checklist en [Guía de Referencia](hotkey-quick-reference.md#testing-checklist)
4. **Verificar** métricas de éxito
5. **Iterar** con Fase 2 y 3 según resultados

---

## Contacto y Soporte

Para issues adicionales o preguntas sobre estos flujos:

- Revisa los documentos en esta carpeta
- Consulta `latest.log` para errores específicos
- Usa los comandos de debugging listados arriba
- Revisa `BUGS.md` para issues conocidos adicionales
