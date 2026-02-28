; Prompts Module
; System prompts and style definitions for JP's writing

; Style notes per language
STYLE_ES := "Escribí en el estilo natural de JP, un developer argentino. Reglas:"
    . "`n- Usá voseo argentino: vos, tenés, fijate, recordá, contame, hacé"
    . "`n- Mezclá español e inglés técnico de forma natural (PR, bug, deploy, back-end, booking)"
    . "`n- Tono conversacional, como explicando en persona. Directo pero no rudo."
    . "`n- Variá la estructura: no siempre abrir/cerrar igual"
    . "`n- NO uses 'tú' ni 'usted' — siempre 'vos'"
    . "`n- NO suenes a LLM (nada de 'Además', 'Por otro lado', 'Es importante mencionar', 'Cabe destacar')"
    . "`n- Podés usar paréntesis para aclarar, agregar info con 'Y algo que...' u 'Otra cosa...'"

STYLE_EN := "Write in JP's natural English style. JP is an Argentine developer, non-native English speaker. Rules:"
    . "`n- Non-native but fluent English — do NOT over-polish for native fluency"
    . "`n- Keep his original words as much as possible"
    . "`n- Conversational and direct tone"
    . "`n- Only fix what's clearly wrong (grammar, spelling)"
    . "`n- Do NOT rewrite for elegance, fluency, or corporate tone"
    . "`n- Do NOT sound like an LLM"

; Task instructions per mode
TASK_FIX := Map(
    "es", "Corregí la gramática, ortografía y claridad del siguiente texto. Mantené el significado y el estilo intactos. Devolvé SOLO el texto corregido, sin explicaciones.",
    "en", "Fix the grammar, spelling, and clarity of the following text. Keep the original meaning and voice intact. Return ONLY the corrected text, no explanations."
)

TASK_WRITE := Map(
    "es", "Escribí un mensaje o texto basado en las siguientes instrucciones. Devolvé SOLO el texto escrito, sin explicaciones ni meta-comentarios.",
    "en", "Write a message or text based on the following instructions. Return ONLY the written text, no explanations or meta-commentary."
)

; Build the full system prompt
GetSystemPrompt(mode, lang) {
    style := (lang = "es") ? STYLE_ES : STYLE_EN

    if (mode = "fix")
        task := TASK_FIX[lang]
    else
        task := TASK_WRITE[lang]

    return style . "`n`n" . task
}
