; API Module
; Multi-provider HTTP calls and JSON handling

SETTINGS_FILE := A_ScriptDir . "\settings.conf"
MODEL_CONFIG_FILE := A_ScriptDir . "\model.conf"
DEFAULT_PROVIDER := "openrouter"
DEFAULT_MODELS := Map(
    "openrouter", "anthropic/claude-sonnet-4-5",
    "openai", "gpt-4.1-mini",
    "anthropic", "claude-3-5-sonnet-latest",
    "xai", "grok-3-mini"
)
VALID_PROVIDERS := ["openrouter", "openai", "anthropic", "xai"]

API_PROVIDER := LoadSelectedProvider()
API_MODEL := LoadSelectedModel(API_PROVIDER)
global MAX_TOKENS := LoadMaxTokens()

; Compatibility wrapper for existing call sites
CallOpenRouter(userMessage, systemPrompt, apiKey, model := "") {
    return CallProvider(userMessage, systemPrompt, "openrouter", apiKey, model)
}

; Make a chat completion request to any supported provider
CallProvider(userMessage, systemPrompt, provider, apiKey, model := "") {
    global API_PROVIDER, API_MODEL

    provider := NormalizeProvider(provider)
    if (Trim(apiKey) = "")
        throw Error("Missing API key for provider: " . provider)

    if (model = "") {
        if (provider = API_PROVIDER)
            model := API_MODEL
        else
            model := LoadSelectedModel(provider)
    }

    payload := BuildPayload(provider, userMessage, systemPrompt, model)

    whr := ComObject("WinHttp.WinHttpRequest.5.1")
    whr.Open("POST", GetProviderChatUrl(provider), false)
    whr.SetRequestHeader("Content-Type", "application/json")
    ApplyProviderHeaders(whr, provider, apiKey)
    whr.Send(payload)

    if (whr.Status < 200 || whr.Status >= 300)
        throw Error("HTTP " . whr.Status . ": " . SubStr(ReadUTF8(whr), 1, 300))

    return ParseContent(provider, ReadUTF8(whr))
}

; Build provider-specific payload
BuildPayload(provider, userMsg, sysPrompt, model) {
    switch provider {
    case "anthropic":
        return '{"model":"' . model . '","max_tokens":' . MAX_TOKENS
            . ',"system":"' . EscJson(sysPrompt) . '","messages":['
            . '{"role":"user","content":"' . EscJson(userMsg) . '"}'
            . ']}'

    default:
        ; OpenRouter/OpenAI/xAI are OpenAI-compatible for this payload format
        return '{"model":"' . model . '","max_tokens":' . MAX_TOKENS . ',"messages":['
            . '{"role":"system","content":"' . EscJson(sysPrompt) . '"},'
            . '{"role":"user","content":"' . EscJson(userMsg) . '"}'
            . ']}'
    }
}

ApplyProviderHeaders(whr, provider, apiKey) {
    switch provider {
    case "openrouter":
        whr.SetRequestHeader("Authorization", "Bearer " . apiKey)
        whr.SetRequestHeader("HTTP-Referer", "https://ai-assistant.local")
        whr.SetRequestHeader("X-Title", "AI Assistant")

    case "openai", "xai":
        whr.SetRequestHeader("Authorization", "Bearer " . apiKey)

    case "anthropic":
        whr.SetRequestHeader("x-api-key", apiKey)
        whr.SetRequestHeader("anthropic-version", "2023-06-01")

    default:
        throw Error("Unsupported provider: " . provider)
    }
}

GetProviderChatUrl(provider) {
    switch provider {
    case "openrouter":
        return "https://openrouter.ai/api/v1/chat/completions"
    case "openai":
        return "https://api.openai.com/v1/chat/completions"
    case "anthropic":
        return "https://api.anthropic.com/v1/messages"
    case "xai":
        return "https://api.x.ai/v1/chat/completions"
    default:
        throw Error("Unsupported provider: " . provider)
    }
}

GetProviderModelsUrl(provider) {
    switch provider {
    case "openrouter":
        return "https://openrouter.ai/api/v1/models"
    case "openai":
        return "https://api.openai.com/v1/models"
    case "anthropic":
        return "https://api.anthropic.com/v1/models"
    case "xai":
        return "https://api.x.ai/v1/models"
    default:
        throw Error("Unsupported provider: " . provider)
    }
}

; Parse assistant text from provider response
ParseContent(provider, json) {
    if (provider = "anthropic") {
        if RegExMatch(json, '"text"\s*:\s*"((?:[^"\\]|\\.)*)"', &mText)
            return Trim(JsonUnescape(mText[1]))
    } else {
        if RegExMatch(json, '"content"\s*:\s*"((?:[^"\\]|\\.)*)"', &mContent)
            return Trim(JsonUnescape(mContent[1]))
    }
    throw Error("Could not parse API response: " . SubStr(json, 1, 300))
}

; Read HTTP response body as UTF-8 (WinHttp.ResponseText assumes ANSI)
ReadUTF8(whr) {
    oADO := ComObject("ADODB.Stream")
    oADO.Type := 1  ; Binary
    oADO.Open()
    oADO.Write(whr.ResponseBody)
    oADO.Position := 0
    oADO.Type := 2  ; Text
    oADO.Charset := "UTF-8"
    result := oADO.ReadText()
    oADO.Close()
    return result
}

; Escape a string for use inside a JSON string value
EscJson(s) {
    s := StrReplace(s, "\", "\\")
    s := StrReplace(s, '"', '\"')
    s := StrReplace(s, "`n", "\n")
    s := StrReplace(s, "`r", "\r")
    s := StrReplace(s, "`t", "\t")
    return s
}

JsonUnescape(s) {
    s := StrReplace(s, "\\/", "/")
    s := StrReplace(s, "\n", "`n")
    s := StrReplace(s, "\r", "")
    s := StrReplace(s, "\t", "`t")
    s := StrReplace(s, '\"', '"')
    s := StrReplace(s, "\\", "\")
    return s
}

; ============================================================
; MODEL + PROVIDER SELECTION — persistence + defaults
; ============================================================

NormalizeProvider(provider) {
    global DEFAULT_PROVIDER
    p := StrLower(Trim(provider))
    return IsValidProvider(p) ? p : DEFAULT_PROVIDER
}

IsValidProvider(provider) {
    global VALID_PROVIDERS
    for _, p in VALID_PROVIDERS {
        if (p = provider)
            return true
    }
    return false
}

GetProviderDefaultModel(provider) {
    global DEFAULT_MODELS, DEFAULT_PROVIDER
    return DEFAULT_MODELS.Has(provider) ? DEFAULT_MODELS[provider] : DEFAULT_MODELS[DEFAULT_PROVIDER]
}

LoadSelectedProvider() {
    global DEFAULT_PROVIDER
    provider := StrLower(Trim(ReadSetting("provider")))
    return IsValidProvider(provider) ? provider : DEFAULT_PROVIDER
}

SaveSelectedProvider(provider) {
    global API_PROVIDER, API_MODEL
    provider := NormalizeProvider(provider)
    API_PROVIDER := provider
    SaveSetting("provider", provider)
    API_MODEL := LoadSelectedModel(provider)
}

LoadSelectedModel(provider := "") {
    global MODEL_CONFIG_FILE

    if (provider = "")
        provider := LoadSelectedProvider()

    provider := NormalizeProvider(provider)
    settingKey := "model_" . provider

    saved := Trim(ReadSetting(settingKey))
    if (saved != "")
        return saved

    ; Legacy fallback for old single-model config
    if (provider = "openrouter" && FileExist(MODEL_CONFIG_FILE)) {
        legacy := Trim(FileRead(MODEL_CONFIG_FILE, "UTF-8"))
        if (legacy != "")
            return legacy
    }

    return GetProviderDefaultModel(provider)
}

SaveSelectedModel(modelId, provider := "") {
    global API_MODEL, API_PROVIDER, MODEL_CONFIG_FILE

    if (provider = "")
        provider := API_PROVIDER

    provider := NormalizeProvider(provider)
    modelId := Trim(modelId)
    if (modelId = "")
        return

    SaveSetting("model_" . provider, modelId)

    if (provider = API_PROVIDER)
        API_MODEL := modelId

    ; Legacy write for compatibility with old OpenRouter-only config
    if (provider = "openrouter") {
        try FileDelete(MODEL_CONFIG_FILE)
        FileAppend(modelId, MODEL_CONFIG_FILE, "UTF-8")
    }
}

; ============================================================
; SETTINGS — generic persistence (settings.conf key=value)
; ============================================================

ReadSettingsFile() {
    global SETTINGS_FILE
    lines := Map()
    if FileExist(SETTINGS_FILE) {
        content := FileRead(SETTINGS_FILE, "UTF-8")
        ; Strip BOM if present
        if (SubStr(content, 1, 1) = Chr(0xFEFF))
            content := SubStr(content, 2)
        Loop Parse, content, "`n", "`r" {
            if RegExMatch(A_LoopField, "^([\w]+)\s*=\s*(.*)$", &m)
                lines[m[1]] := m[2]
        }
    }
    return lines
}

ReadSetting(key) {
    settings := ReadSettingsFile()
    return settings.Has(key) ? settings[key] : ""
}

SaveSetting(key, value) {
    global SETTINGS_FILE
    lines := ReadSettingsFile()
    lines[key] := value
    out := ""
    for k, v in lines
        out .= k . "=" . v . "`n"
    try FileDelete(SETTINGS_FILE)
    FileAppend(out, SETTINGS_FILE, "UTF-8-RAW")
}

SaveSettingBatch(keys) {
    global SETTINGS_FILE
    lines := ReadSettingsFile()
    for k, v in keys
        lines[k] := v
    out := ""
    for k, v in lines
        out .= k . "=" . v . "`n"
    try FileDelete(SETTINGS_FILE)
    FileAppend(out, SETTINGS_FILE, "UTF-8-RAW")
}

; ============================================================
; API KEYS — persistence (settings.conf)
; ============================================================

LoadApiKeys() {
    keys := Map(
        "openrouter", Trim(ReadSetting("api_key_openrouter")),
        "openai", Trim(ReadSetting("api_key_openai")),
        "anthropic", Trim(ReadSetting("api_key_anthropic")),
        "xai", Trim(ReadSetting("api_key_xai"))
    )
    return keys
}

SaveApiKey(provider, apiKey) {
    provider := NormalizeProvider(provider)
    SaveSetting("api_key_" . provider, Trim(apiKey))
}

; ============================================================
; MAX TOKENS
; ============================================================

LoadMaxTokens() {
    ; Honour a manually set value in settings.conf, otherwise use a
    ; sensible default that covers virtually all text-processing tasks.
    settings := ReadSettingsFile()
    if settings.Has("max_tokens")
        return Integer(settings["max_tokens"])
    return 8192
}

; ============================================================
; HOTKEYS — persistence
; ============================================================

; Default hotkey assignments (AHK format)
HOTKEY_DEFAULTS := Map(
    "mainWindow",   "!+w",
    "goToCommand",  "!j",
    "promptPicker", "",
    "reload",       ""
)

; Load hotkey assignments from settings.conf
LoadHotkeys() {
    settings := ReadSettingsFile()
    hotkeys := Map()
    for actionId, defaultKey in HOTKEY_DEFAULTS {
        confKey := "hotkey_" . actionId
        if settings.Has(confKey)
            hotkeys[actionId] := settings[confKey]
        else if (actionId = "mainWindow" && settings.Has("hotkey_writeWindow")) {
            hotkeys[actionId] := settings["hotkey_writeWindow"]
            SaveSetting(confKey, hotkeys[actionId])
        }
        else
            hotkeys[actionId] := defaultKey
    }
    return hotkeys
}

; Save a single hotkey to settings.conf
SaveHotkey(actionId, ahkKey) {
    SaveSetting("hotkey_" . actionId, ahkKey)
}

; Fetch available models from selected provider
; Returns JSON array string: [{"id":"...","name":"..."},...]
FetchModels(provider, apiKey) {
    provider := NormalizeProvider(provider)
    if (Trim(apiKey) = "")
        throw Error("Missing API key for provider: " . provider)

    whr := ComObject("WinHttp.WinHttpRequest.5.1")
    whr.Open("GET", GetProviderModelsUrl(provider), false)
    ApplyProviderHeaders(whr, provider, apiKey)
    whr.Send()

    if (whr.Status < 200 || whr.Status >= 300)
        throw Error("HTTP " . whr.Status . " fetching models")

    rawJson := ReadUTF8(whr)
    return ParseModels(provider, rawJson)
}

ParseModels(provider, rawJson) {
    result := "["
    pos := 1
    first := true

    while (pos := RegExMatch(rawJson, '"id"\s*:\s*"((?:[^"\\]|\\.)*)"', &mId, pos)) {
        modelId := JsonUnescape(mId[1])
        modelName := modelId

        nearby := SubStr(rawJson, pos, 700)

        if (provider = "openrouter") {
            if RegExMatch(nearby, '"name"\s*:\s*"((?:[^"\\]|\\.)*)"', &mName)
                modelName := JsonUnescape(mName[1])
        } else if (provider = "anthropic") {
            if RegExMatch(nearby, '"display_name"\s*:\s*"((?:[^"\\]|\\.)*)"', &mDisplay)
                modelName := JsonUnescape(mDisplay[1])
        }

        if (!first)
            result .= ","
        result .= '{"id":"' . EscJson(modelId) . '","name":"' . EscJson(modelName) . '"}'
        first := false
        pos += mId.Len
    }

    result .= "]"
    return result
}
