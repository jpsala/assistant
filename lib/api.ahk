; API Module
; Multi-provider HTTP calls and JSON handling

SETTINGS_FILE := A_ScriptDir . "\settings.conf"
MODEL_CONFIG_FILE := A_ScriptDir . "\model.conf"
BACKEND_DEFAULT_URL := "http://127.0.0.1:8765"
DEFAULT_PROVIDER := "openrouter"
DEFAULT_MODELS := Map(
    "openrouter", "anthropic/claude-sonnet-4-5",
    "openai", "gpt-4.1-mini",
    "anthropic", "claude-3-5-sonnet-latest",
    "xai", "grok-3-mini"
)
VALID_PROVIDERS := ["openrouter", "openai", "anthropic", "xai"]
global BACKEND_READY := false
global BACKEND_BOOT_ATTEMPTED := false
global BUN_EXECUTABLE := ""

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

    if EnsureBackendServer()
        return CallProviderViaBackend(userMessage, systemPrompt, provider, model)

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

CallProviderViaBackend(userMessage, systemPrompt, provider, model) {
    payload := '{"provider":"' . EscJson(provider) . '","model":"' . EscJson(model) . '","systemPrompt":"' . EscJson(systemPrompt) . '","userMessage":"' . EscJson(userMessage) . '"}'
    rawJson := HttpRequest("POST", GetBackendBaseUrl() . "/v1/chat", payload, Map("Content-Type", "application/json"))
    if RegExMatch(rawJson, '"error"\s*:\s*"((?:[^"\\]|\\.)*)"', &mErr)
        throw Error(JsonUnescape(mErr[1]))
    if !RegExMatch(rawJson, '"content"\s*:\s*"((?:[^"\\]|\\.)*)"', &mContent)
        throw Error("Could not parse backend response: " . SubStr(rawJson, 1, 300))
    return Trim(JsonUnescape(mContent[1]))
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

HttpRequest(method, url, payload := "", headers := "") {
    whr := ComObject("WinHttp.WinHttpRequest.5.1")
    whr.Open(method, url, false)
    if IsObject(headers) {
        for headerName, headerValue in headers
            whr.SetRequestHeader(headerName, headerValue)
    }
    whr.Send(payload)
    if (whr.Status < 200 || whr.Status >= 300)
        throw Error("HTTP " . whr.Status . ": " . SubStr(ReadUTF8(whr), 1, 300))
    return ReadUTF8(whr)
}

GetBackendBaseUrl() {
    global BACKEND_DEFAULT_URL
    configured := Trim(ReadSetting("backend_url"))
    return configured != "" ? configured : BACKEND_DEFAULT_URL
}

BackendHealthCheck() {
    try {
        rawJson := HttpRequest("GET", GetBackendBaseUrl() . "/health")
        return InStr(rawJson, '"ok":true')
    } catch {
        return false
    }
}

FindBunExecutable() {
    global BUN_EXECUTABLE

    if (BUN_EXECUTABLE != "")
        return BUN_EXECUTABLE

    candidates := [
        EnvGet("BUN_EXE"),
        A_LocalAppData . "\Programs\Bun\bun.exe",
        A_UserProfile . "\.bun\bin\bun.exe"
    ]

    for _, candidate in candidates {
        candidate := Trim(candidate)
        if (candidate != "" && FileExist(candidate)) {
            BUN_EXECUTABLE := candidate
            return BUN_EXECUTABLE
        }
    }

    tempFile := A_Temp . "\ai-assistant-bun-path.txt"
    try FileDelete(tempFile)
    try {
        RunWait(A_ComSpec . ' /C where bun > "' . tempFile . '" 2>nul',, "Hide")
        if FileExist(tempFile) {
            path := Trim(FileRead(tempFile, "UTF-8"))
            if InStr(path, "`n")
                path := Trim(StrSplit(path, "`n")[1], "`r`n`t ")
            if (path != "" && FileExist(path)) {
                BUN_EXECUTABLE := path
                return BUN_EXECUTABLE
            }
        }
    }
    try FileDelete(tempFile)

    return ""
}

EnsureBackendServer() {
    global BACKEND_READY, BACKEND_BOOT_ATTEMPTED

    if (BACKEND_READY && BackendHealthCheck())
        return true

    if BackendHealthCheck() {
        BACKEND_READY := true
        return true
    }

    if BACKEND_BOOT_ATTEMPTED
        return false
    BACKEND_BOOT_ATTEMPTED := true

    backendEntry := A_ScriptDir . "\backend\src\index.ts"
    if !FileExist(backendEntry)
        return false

    bunExe := FindBunExecutable()
    if (bunExe = "")
        return false

    try Run('"' . bunExe . '" "' . backendEntry . '"', A_ScriptDir, "Hide")
    catch
        return false

    Loop 20 {
        Sleep(250)
        if BackendHealthCheck() {
            BACKEND_READY := true
            return true
        }
    }
    return false
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

BackendExtractJsonString(rawJson, key) {
    pattern := '"' . key . '"\s*:\s*"((?:[^"\\]|\\.)*)"'
    if RegExMatch(rawJson, pattern, &m)
        return JsonUnescape(m[1])
    return ""
}

BackendExtractJsonInt(rawJson, key, defaultValue := 0) {
    pattern := '"' . key . '"\s*:\s*(\d+)'
    if RegExMatch(rawJson, pattern, &m)
        return Integer(m[1])
    return defaultValue
}

BackendGetSettingsJson() {
    rawJson := HttpRequest("GET", GetBackendBaseUrl() . "/v1/settings")
    if RegExMatch(rawJson, '"error"\s*:\s*"((?:[^"\\]|\\.)*)"', &mErr)
        throw Error(JsonUnescape(mErr[1]))
    return rawJson
}

SyncRuntimeStateFromBackend() {
    global API_PROVIDER, API_MODEL, API_KEYS, MAX_TOKENS

    if !EnsureBackendServer()
        return false

    rawJson := BackendGetSettingsJson()
    API_PROVIDER := NormalizeProvider(BackendExtractJsonString(rawJson, "provider"))
    API_MODEL := BackendExtractJsonString(rawJson, "currentModel")
    if (Trim(API_MODEL) = "")
        API_MODEL := LoadSelectedModel(API_PROVIDER)

    API_KEYS["openrouter"] := Trim(BackendExtractJsonString(rawJson, "openrouterKey"))
    API_KEYS["openai"] := Trim(BackendExtractJsonString(rawJson, "openaiKey"))
    API_KEYS["anthropic"] := Trim(BackendExtractJsonString(rawJson, "anthropicKey"))
    API_KEYS["xai"] := Trim(BackendExtractJsonString(rawJson, "xaiKey"))
    MAX_TOKENS := BackendExtractJsonInt(rawJson, "maxTokens", MAX_TOKENS)
    return true
}

BackendSaveSelectedProvider(provider) {
    provider := NormalizeProvider(provider)
    payload := '{"provider":"' . EscJson(provider) . '"}'
    rawJson := HttpRequest("PUT", GetBackendBaseUrl() . "/v1/settings/provider", payload, Map("Content-Type", "application/json"))
    if RegExMatch(rawJson, '"error"\s*:\s*"((?:[^"\\]|\\.)*)"', &mErr)
        throw Error(JsonUnescape(mErr[1]))
    SyncRuntimeStateFromBackend()
}

BackendSaveSelectedModel(modelId, provider := "") {
    global API_PROVIDER

    if (provider = "")
        provider := API_PROVIDER
    provider := NormalizeProvider(provider)
    modelId := Trim(modelId)
    if (modelId = "")
        return

    payload := '{"provider":"' . EscJson(provider) . '","model":"' . EscJson(modelId) . '"}'
    rawJson := HttpRequest("PUT", GetBackendBaseUrl() . "/v1/settings/model", payload, Map("Content-Type", "application/json"))
    if RegExMatch(rawJson, '"error"\s*:\s*"((?:[^"\\]|\\.)*)"', &mErr)
        throw Error(JsonUnescape(mErr[1]))
    SyncRuntimeStateFromBackend()
}

BackendSaveApiKeys(keysMap) {
    payload := '{'
        . '"openrouterKey":"' . EscJson(keysMap["openrouter"]) . '",'
        . '"openaiKey":"' . EscJson(keysMap["openai"]) . '",'
        . '"anthropicKey":"' . EscJson(keysMap["anthropic"]) . '",'
        . '"xaiKey":"' . EscJson(keysMap["xai"]) . '"'
        . '}'
    rawJson := HttpRequest("PUT", GetBackendBaseUrl() . "/v1/settings/api-keys", payload, Map("Content-Type", "application/json"))
    if RegExMatch(rawJson, '"error"\s*:\s*"((?:[^"\\]|\\.)*)"', &mErr)
        throw Error(JsonUnescape(mErr[1]))
    SyncRuntimeStateFromBackend()
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
    "promptChat",   "!+w",
    "promptPicker", "",
    "iterativePromptPicker", "",
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
        else if (actionId = "promptChat" && settings.Has("hotkey_mainWindow")) {
            hotkeys[actionId] := settings["hotkey_mainWindow"]
            SaveSetting(confKey, hotkeys[actionId])
        }
        else if (actionId = "promptChat" && settings.Has("hotkey_writeWindow")) {
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

    if EnsureBackendServer()
        return FetchModelsViaBackend(provider)

    whr := ComObject("WinHttp.WinHttpRequest.5.1")
    whr.Open("GET", GetProviderModelsUrl(provider), false)
    ApplyProviderHeaders(whr, provider, apiKey)
    whr.Send()

    if (whr.Status < 200 || whr.Status >= 300)
        throw Error("HTTP " . whr.Status . " fetching models")

    rawJson := ReadUTF8(whr)
    return ParseModels(provider, rawJson)
}

FetchModelsViaBackend(provider) {
    rawJson := HttpRequest("GET", GetBackendBaseUrl() . "/v1/models?provider=" . provider)
    if RegExMatch(rawJson, '"error"\s*:\s*"((?:[^"\\]|\\.)*)"', &mErr)
        throw Error(JsonUnescape(mErr[1]))
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
