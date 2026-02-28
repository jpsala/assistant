; Chord Hotkeys Module
; Handles two-step hotkeys like Alt+Q -> R without blocking.

global CHORD_PREFIX_MAP := Map()
global CHORD_PREFIX_HOTKEY_MAP := Map()
global CHORD_SUFFIX_HOTKEY_MAP := Map()
global CHORD_PENDING_PREFIX := ""
global CHORD_PENDING_UNTIL := 0
global CHORD_TIMEOUT_SEC := 0.9
global CHORD_EXECUTE_FN := ""

ChordSetTimeout(timeoutSeconds) {
    global CHORD_TIMEOUT_SEC
    if (timeoutSeconds > 0)
        CHORD_TIMEOUT_SEC := timeoutSeconds
}

ChordUnregisterAll() {
    global CHORD_PREFIX_MAP, CHORD_PREFIX_HOTKEY_MAP, CHORD_SUFFIX_HOTKEY_MAP, CHORD_EXECUTE_FN

    for prefixHotkey, _ in CHORD_PREFIX_HOTKEY_MAP {
        if (prefixHotkey != "")
            try Hotkey(prefixHotkey, "Off")
    }
    for _, suffixHotkey in CHORD_SUFFIX_HOTKEY_MAP {
        if (suffixHotkey != "")
            try Hotkey(suffixHotkey, "Off")
    }

    CHORD_PREFIX_MAP := Map()
    CHORD_PREFIX_HOTKEY_MAP := Map()
    CHORD_SUFFIX_HOTKEY_MAP := Map()
    CHORD_EXECUTE_FN := ""
    ChordClearPending()
}

ChordRegister(prefixMap, executeFn) {
    global CHORD_PREFIX_MAP, CHORD_PREFIX_HOTKEY_MAP, CHORD_SUFFIX_HOTKEY_MAP, CHORD_EXECUTE_FN

    CHORD_PREFIX_MAP := prefixMap
    CHORD_EXECUTE_FN := executeFn

    for prefixKey, _ in CHORD_PREFIX_MAP {
        registeredPrefix := ChordEnsureHookHotkey(prefixKey)
        try Hotkey(registeredPrefix, ChordHandlePrefix.Bind(prefixKey))
        CHORD_PREFIX_HOTKEY_MAP[registeredPrefix] := true
    }

    uniqueSuffixes := Map()
    for _, suffixMap in CHORD_PREFIX_MAP {
        for suffixKey, _ in suffixMap
            uniqueSuffixes[suffixKey] := true
    }

    for suffixKey, _ in uniqueSuffixes {
        suffixHotkey := ChordBuildSuffixHotkey(suffixKey)
        if (suffixHotkey = "")
            continue
        try Hotkey(suffixHotkey, ChordHandleSuffix.Bind(suffixKey), "Off")
        CHORD_SUFFIX_HOTKEY_MAP[suffixKey] := suffixHotkey
    }
}

ChordTryParseHotkeySpec(hotkeySpec, &prefixHotkeyOut, &suffixKeyOut) {
    prefixHotkeyOut := ""
    suffixKeyOut := ""

    spec := Trim(hotkeySpec)
    if (spec = "")
        return false

    if RegExMatch(spec, "i)^\s*(.+?)\s*->\s*(.+?)\s*$", &mArrow) {
        prefixHotkey := ChordNormalizeDisplayHotkeyToAhk(mArrow[1])
        if (prefixHotkey = "")
            prefixHotkey := Trim(mArrow[1])
        suffixKey := ChordNormalizeSuffixKey(mArrow[2])
        if (prefixHotkey != "" && suffixKey != "") {
            prefixHotkeyOut := prefixHotkey
            suffixKeyOut := suffixKey
            return true
        }
        return false
    }

    commaPos := InStr(spec, ",")
    if (commaPos <= 0)
        return false

    prefixCandidate := Trim(SubStr(spec, 1, commaPos - 1))
    prefixHotkey := ChordNormalizeDisplayHotkeyToAhk(prefixCandidate)
    if (prefixHotkey = "")
        prefixHotkey := prefixCandidate
    suffixKey := Trim(SubStr(spec, commaPos + 1))
    suffixKey := ChordNormalizeSuffixKey(suffixKey)

    if (prefixHotkey = "" || suffixKey = "")
        return false

    prefixHotkeyOut := prefixHotkey
    suffixKeyOut := suffixKey
    return true
}

ChordNormalizeDisplayHotkeyToAhk(displayHotkey) {
    raw := Trim(displayHotkey)
    if (raw = "")
        return ""
    if RegExMatch(raw, "^\s*\+")
        return Trim(raw)

    ; Keep plain AHK notation unchanged.
    if RegExMatch(raw, "[\^\!\#]") {
        if RegExMatch(raw, "^\s*\+")
            return Trim(raw)
        if InStr(raw, " ")
            return ""
        return Trim(raw)
    }

    mods := ""
    keyName := ""
    for _, token in StrSplit(raw, "+") {
        t := StrLower(Trim(token))
        if (t = "")
            continue
        switch t {
        case "ctrl", "control":
            mods .= "^"
        case "alt":
            mods .= "!"
        case "shift":
            mods .= "+"
        case "win", "meta", "cmd", "command":
            mods .= "#"
        default:
            keyName := t
        }
    }

    if (keyName = "")
        return ""

    normalizedKey := ChordNormalizeSuffixKey(keyName)
    if (normalizedKey = "")
        return ""
    if (normalizedKey = "esc")
        normalizedKey := "Esc"
    else if (normalizedKey = "pgup")
        normalizedKey := "PgUp"
    else if (normalizedKey = "pgdn")
        normalizedKey := "PgDn"
    else if (normalizedKey = "space")
        normalizedKey := "Space"
    else if (normalizedKey = "up")
        normalizedKey := "Up"
    else if (normalizedKey = "down")
        normalizedKey := "Down"
    else if (normalizedKey = "left")
        normalizedKey := "Left"
    else if (normalizedKey = "right")
        normalizedKey := "Right"
    else if (normalizedKey = "home")
        normalizedKey := "Home"
    else if (normalizedKey = "end")
        normalizedKey := "End"
    else if (normalizedKey = "tab")
        normalizedKey := "Tab"
    else if (normalizedKey = "enter")
        normalizedKey := "Enter"
    else if (normalizedKey = "backspace")
        normalizedKey := "Backspace"
    else if (normalizedKey = "delete")
        normalizedKey := "Delete"
    else if (normalizedKey = "insert")
        normalizedKey := "Insert"
    else if RegExMatch(normalizedKey, "^f([1-9]|1[0-2])$")
        normalizedKey := StrUpper(normalizedKey)

    return mods . normalizedKey
}

ChordNormalizeSuffixKey(keySpec) {
    key := Trim(keySpec)
    if (key = "")
        return ""

    key := RegExReplace(key, "[\^\!\+\#]")
    key := Trim(key)
    if (key = "")
        return ""

    lower := StrLower(key)
    switch lower {
    case "esc", "escape":
        return "esc"
    case "space", "spacebar":
        return "space"
    case "pgup", "pageup":
        return "pgup"
    case "pgdn", "pagedown":
        return "pgdn"
    case "up", "arrowup":
        return "up"
    case "down", "arrowdown":
        return "down"
    case "left", "arrowleft":
        return "left"
    case "right", "arrowright":
        return "right"
    case "tab":
        return "tab"
    case "enter", "return":
        return "enter"
    case "backspace":
        return "backspace"
    case "delete", "del":
        return "delete"
    case "insert", "ins":
        return "insert"
    case "home":
        return "home"
    case "end":
        return "end"
    }

    if RegExMatch(lower, "^f([1-9]|1[0-2])$")
        return lower
    if (StrLen(lower) = 1)
        return lower
    return ""
}

ChordBuildSuffixHotkey(suffixKey) {
    switch suffixKey {
    case "esc":
        return "$*Esc"
    case "space":
        return "$*Space"
    case "pgup":
        return "$*PgUp"
    case "pgdn":
        return "$*PgDn"
    case "up":
        return "$*Up"
    case "down":
        return "$*Down"
    case "left":
        return "$*Left"
    case "right":
        return "$*Right"
    case "tab":
        return "$*Tab"
    case "enter":
        return "$*Enter"
    case "backspace":
        return "$*Backspace"
    case "delete":
        return "$*Delete"
    case "insert":
        return "$*Insert"
    case "home":
        return "$*Home"
    case "end":
        return "$*End"
    default:
        if RegExMatch(suffixKey, "^f([1-9]|1[0-2])$")
            return "$*" . StrUpper(suffixKey)
        if (StrLen(suffixKey) = 1)
            return "$*" . suffixKey
    }
    return ""
}

ChordEnsureHookHotkey(hotkeySpec) {
    key := Trim(hotkeySpec)
    if (key = "")
        return ""
    if (SubStr(key, 1, 1) = "$")
        return key
    return "$" . key
}

ChordEnableSuffixes(prefixHotkey) {
    global CHORD_PREFIX_MAP, CHORD_SUFFIX_HOTKEY_MAP
    if !CHORD_PREFIX_MAP.Has(prefixHotkey)
        return

    for suffixKey, _ in CHORD_PREFIX_MAP[prefixHotkey] {
        if CHORD_SUFFIX_HOTKEY_MAP.Has(suffixKey)
            try Hotkey(CHORD_SUFFIX_HOTKEY_MAP[suffixKey], "On")
    }
}

ChordDisableSuffixes() {
    global CHORD_SUFFIX_HOTKEY_MAP
    for _, suffixHotkey in CHORD_SUFFIX_HOTKEY_MAP {
        if (suffixHotkey != "")
            try Hotkey(suffixHotkey, "Off")
    }
}

ChordClearPending(*) {
    global CHORD_PENDING_PREFIX, CHORD_PENDING_UNTIL
    try SetTimer(ChordClearPending, 0)
    CHORD_PENDING_PREFIX := ""
    CHORD_PENDING_UNTIL := 0
    ChordDisableSuffixes()
}

ChordHandleSuffix(suffixKey, *) {
    global CHORD_PENDING_PREFIX, CHORD_PENDING_UNTIL, CHORD_PREFIX_MAP, CHORD_EXECUTE_FN
    if (CHORD_PENDING_PREFIX = "")
        return
    if (A_TickCount > CHORD_PENDING_UNTIL) {
        ChordClearPending()
        return
    }

    prefixHotkey := CHORD_PENDING_PREFIX
    ChordClearPending()
    if !CHORD_PREFIX_MAP.Has(prefixHotkey)
        return

    suffixMap := CHORD_PREFIX_MAP[prefixHotkey]
    if !suffixMap.Has(suffixKey)
        return

    commandName := suffixMap[suffixKey]
    if IsObject(CHORD_EXECUTE_FN)
        SetTimer(CHORD_EXECUTE_FN.Bind(commandName), -1)
}

ChordHandlePrefix(prefixHotkey, *) {
    global CHORD_PREFIX_MAP, CHORD_TIMEOUT_SEC, CHORD_PENDING_PREFIX, CHORD_PENDING_UNTIL
    if !CHORD_PREFIX_MAP.Has(prefixHotkey)
        return

    try SetTimer(ChordClearPending, 0)
    ChordClearPending()
    CHORD_PENDING_PREFIX := prefixHotkey
    CHORD_PENDING_UNTIL := A_TickCount + Round(CHORD_TIMEOUT_SEC * 1000)
    ChordEnableSuffixes(prefixHotkey)
    SetTimer(ChordClearPending, -Round(CHORD_TIMEOUT_SEC * 1000))
}
