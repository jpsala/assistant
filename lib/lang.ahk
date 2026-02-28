; Language Detection Module
; Detects Spanish vs English from text content

DetectLanguage(text) {
    ; Strong signals: Spanish-specific characters
    spanishChars := ["á", "é", "í", "ó", "ú", "ñ", "ü", "¿", "¡"]
    for char in spanishChars {
        if InStr(text, char)
            return "es"
    }

    ; Weaker signal: common Spanish words
    lowerText := StrLower(text)
    spanishWords := [" que ", " una ", " para ", " pero ", " como ",
                     " esto ", " con ", " por ", " los ", " las ",
                     " del ", " tiene ", " hace ", " está "]
    count := 0
    for w in spanishWords {
        if InStr(lowerText, w)
            count++
    }

    return (count >= 2) ? "es" : "en"
}
