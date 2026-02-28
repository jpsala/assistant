#Requires AutoHotkey v2.0
#SingleInstance Force

; ============================================================
; AI Assistant — Daily text processing tool
; ============================================================

; Load modules
#Include lib/lang.ahk
#Include lib/prompts.ahk
#Include lib/api.ahk
#Include lib/chord-hotkeys.ahk
#Include lib/WebViewToo.ahk

; Prevent Alt hotkeys from activating app menus in the focused window.
A_MenuMaskKey := "vkE8"

; ============================================================
; LOAD CONFIG
; ============================================================
global API_KEYS := Map(
    "openrouter", "",
    "openai", "",
    "anthropic", "",
    "xai", ""
)

BuildEnvTemplate() {
    return "OPENROUTER_KEY=sk-or-v1-your-openrouter-key`n"
        . "OPENAI_API_KEY=sk-proj-your-openai-key`n"
        . "ANTHROPIC_API_KEY=sk-ant-api03-your-anthropic-key`n"
        . "XAI_API_KEY=xai-your-xai-key`n"
        . "AI_PROVIDER=openrouter`n"
        . "DEFAULT_MODEL=anthropic/claude-sonnet-4-5`n"
}

GetEnvValue(envContent, key) {
    if RegExMatch(envContent, "(?m)^\s*" . key . "\s*=\s*(.*)$", &m)
        return Trim(m[1])
    return ""
}

HasAnyApiKey(keysMap) {
    for _, key in keysMap {
        if (Trim(key) != "")
            return true
    }
    return false
}

GetProviderApiKey(provider) {
    global API_KEYS
    provider := NormalizeProvider(provider)
    return API_KEYS.Has(provider) ? Trim(API_KEYS[provider]) : ""
}

EnsureActiveProviderHasKey() {
    global API_PROVIDER, API_KEYS
    if (GetProviderApiKey(API_PROVIDER) != "")
        return

    for provider, key in API_KEYS {
        if (Trim(key) != "") {
            SaveSelectedProvider(provider)
            return
        }
    }
}

ProviderDisplayName(provider) {
    provider := NormalizeProvider(provider)
    switch provider {
    case "openrouter":
        return "OpenRouter"
    case "openai":
        return "OpenAI"
    case "anthropic":
        return "Anthropic"
    case "xai":
        return "xAI"
    default:
        return provider
    }
}

LoadEnv() {
    global API_KEYS, API_PROVIDER

    envPath := A_ScriptDir . "\.env"
    envExists := FileExist(envPath)
    envContent := envExists ? FileRead(envPath, "UTF-8") : ""
    savedKeys := LoadApiKeys()
    savedProvider := Trim(ReadSetting("provider"))

    if !envExists && !HasAnyApiKey(savedKeys) {
        FileAppend(BuildEnvTemplate(), envPath, "UTF-8-RAW")
        Run("notepad.exe " . envPath)
        MsgBox("No .env file found and no saved API keys.`n`nA template was created at:`n" . envPath . "`n`nPaste at least one API key and restart.", "AI Assistant", "Icon!")
        ExitApp()
    }

    API_KEYS["openrouter"] := GetEnvValue(envContent, "OPENROUTER_KEY")
    API_KEYS["openai"] := GetEnvValue(envContent, "OPENAI_API_KEY")
    API_KEYS["anthropic"] := GetEnvValue(envContent, "ANTHROPIC_API_KEY")
    API_KEYS["xai"] := GetEnvValue(envContent, "XAI_API_KEY")

    ; One-time migration of optional defaults from .env into settings.conf
    envProvider := GetEnvValue(envContent, "AI_PROVIDER")
    if (savedProvider = "" && envProvider != "")
        SaveSelectedProvider(envProvider)

    envDefaultModel := GetEnvValue(envContent, "DEFAULT_MODEL")
    modelKey := "model_" . API_PROVIDER
    if (envDefaultModel != "" && Trim(ReadSetting(modelKey)) = "")
        SaveSelectedModel(envDefaultModel, API_PROVIDER)

    ; Settings keys override .env values
    for provider, key in savedKeys {
        if (Trim(key) != "")
            API_KEYS[provider] := Trim(key)
    }

    if !HasAnyApiKey(API_KEYS) {
        if !envExists
            FileAppend(BuildEnvTemplate(), envPath, "UTF-8-RAW")
        Run("notepad.exe " . envPath)
        MsgBox("No API key configured.`n`nSet at least one key in .env or Settings and restart.", "AI Assistant", "Icon!")
        ExitApp()
    }

    EnsureActiveProviderHasKey()
}

LoadEnv()

; ============================================================
; TRAY SETUP
; ============================================================
A_IconTip := "AI Assistant"
iconPath := A_ScriptDir . "\icon.ico"
if FileExist(iconPath)
    TraySetIcon(iconPath)

tray := A_TrayMenu
tray.Delete()
mainWindowTrayLabel := "Main window`tAlt+Shift+W"
tray.Add(mainWindowTrayLabel, (*) => ShowMainWindow())
tray.Add("Prompt editor", (*) => ShowPromptEditor())
tray.Add("Settings", (*) => ShowSettings())
tray.Add()
tray.Add("Reload", (*) => Reload())
tray.Add("Exit", (*) => ExitApp())
tray.Default := mainWindowTrayLabel

; Tray menu item icons (shell32/imageres DLL icons — indices are 1-based)
shell32 := A_WinDir . "\System32\shell32.dll"
imgres  := A_WinDir . "\System32\imageres.dll"
if FileExist(iconPath)
    try tray.SetIcon(mainWindowTrayLabel, iconPath, 1)
try tray.SetIcon("Prompt editor", shell32, 272)   ; notepad/edit
try tray.SetIcon("Settings",      shell32, 71)    ; gear / properties
try tray.SetIcon("Reload",        imgres,  228)   ; circular arrows / refresh
try tray.SetIcon("Exit",          shell32, 131)   ; power / exit

OnMessage(0x404, TrayIconMessageHandler)
OnMessage(0x0084, WM_NCHITTEST_Handler)

; ============================================================
; DYNAMIC HOTKEYS
; ============================================================
global HOTKEY_MAP := Map()  ; actionId → ahkKey (currently registered)
global WINDOW_FOCUS_JOBS := Map()

; Action ID → callback function
HOTKEY_ACTIONS := Map(
    "mainWindow",   (*) => ShowMainWindow(),
    "goToCommand",  (*) => GoToCommand(),
    "promptPicker", (*) => ShowPickerWindow(),
    "reload",       (*) => Reload()
)

; Human-readable labels for the settings UI
HOTKEY_LABELS := Map(
    "mainWindow",   "Main window",
    "goToCommand",  "Go to Command",
    "promptPicker", "Prompt Picker",
    "reload",       "Reload"
)

RegisterHotkeys() {
    global HOTKEY_MAP, HOTKEY_ACTIONS
    config := LoadHotkeys()
    for actionId, ahkKey in config {
        ; Unregister old hotkey if it was registered
        if HOTKEY_MAP.Has(actionId) && HOTKEY_MAP[actionId] != "" {
            try Hotkey(HOTKEY_MAP[actionId], "Off")
        }
        ; Register new hotkey
        if (ahkKey != "" && HOTKEY_ACTIONS.Has(actionId)) {
            try Hotkey(ahkKey, HOTKEY_ACTIONS[actionId])
        }
        HOTKEY_MAP[actionId] := ahkKey
    }
}

RegisterSingleHotkey(actionId, newKey) {
    global HOTKEY_MAP, HOTKEY_ACTIONS
    ; Unregister old
    if HOTKEY_MAP.Has(actionId) && HOTKEY_MAP[actionId] != "" {
        try Hotkey(HOTKEY_MAP[actionId], "Off")
    }
    ; Register new
    if (newKey != "" && HOTKEY_ACTIONS.Has(actionId)) {
        try Hotkey(newKey, HOTKEY_ACTIONS[actionId])
    }
    HOTKEY_MAP[actionId] := newKey
    SaveHotkey(actionId, newKey)
}

SuspendDynamicHotkeys() {
    global HOTKEY_MAP
    for actionId, ahkKey in HOTKEY_MAP {
        if (ahkKey != "")
            try Hotkey(ahkKey, "Off")
    }
}

ResumeDynamicHotkeys() {
    global HOTKEY_MAP, HOTKEY_ACTIONS
    for actionId, ahkKey in HOTKEY_MAP {
        if (ahkKey != "" && HOTKEY_ACTIONS.Has(actionId))
            try Hotkey(ahkKey, HOTKEY_ACTIONS[actionId])
    }
}

SuspendPromptHotkeys() {
    global PROMPT_HOTKEY_MAP
    for _, hotkey in PROMPT_HOTKEY_MAP {
        if (hotkey != "")
            try Hotkey(hotkey, "Off")
    }
    ChordUnregisterAll()
}

ResumePromptHotkeys() {
    global COMMAND_HOTKEYS
    RegisterPromptHotkeys(COMMAND_HOTKEYS)
}

RegisterHotkeys()

; ============================================================
; GO TO COMMAND — opens Main window and focuses command picker
; ============================================================
GoToCommand() {
    global wvGui, wvReady
    ShowMainWindow()
    if (wvReady)
        wvGui.ExecuteScriptAsync("focusCommands()")
}

; ============================================================
; WEBVIEW MAIN WINDOW (Alt+Shift+W)
; ============================================================
global wvGui := ""
global wvReady := false

InitMainWindow() {
    global wvGui
    ; Pre-create WebView GUI hidden so first Show is instant
    dllPath := A_ScriptDir "\lib\" (A_PtrSize * 8) "bit\WebView2Loader.dll"
    wvGui := WebViewGui("+AlwaysOnTop +Resize +MinSize400x400 -Caption", "AI Assistant",, {DllPath: dllPath})
    wvGui.OnEvent("Close", MainWindowClose)
    if (A_IsCompiled)
        wvGui.Control.BrowseFolder(A_ScriptDir)
    wvGui.Control.wv.add_WebMessageReceived(WebMessageHandler)
    wvGui.Navigate("ui/index.html")
}

ShowMainWindow() {
    global wvGui, wvReady

    if !IsObject(wvGui)
        InitMainWindow()

    GetActiveMonitorWorkArea(&ml, &mt, &mr, &mb)
    savedW := ReadSetting("main_w")
    savedH := ReadSetting("main_h")
    w := (savedW != "" && Integer(savedW) >= 400) ? savedW : 584
    h := (savedH != "" && Integer(savedH) >= 400) ? savedH : 600
    x := ml + (mr - ml - w) // 2
    y := mt + (mb - mt - h) // 3
    wvGui.Show("x" . x . " y" . y . " w" . w . " h" . h)
    if (wvReady)
        SendClipboardToUI()
    ScheduleWindowFocus("main", wvGui, wvReady ? "focusPrompt()" : "", 1800)
}

; ============================================================
; JS → AHK MESSAGE HANDLER (main window)
; ============================================================
WebMessageHandler(wv, msg) {
    try data := msg.WebMessageAsJson
    catch
        return

    ; Parse action — only extract the action name here, defer all work
    if !RegExMatch(data, '"action"\s*:\s*"(\w+)"', &m)
        return

    ; IMPORTANT: Never call ExecuteScript (sync) inside this callback — it deadlocks.
    ; Defer everything via SetTimer so it runs outside the WebView callback.
    SetTimer(HandleAction.Bind(m[1]), -1)
}

HandleAction(action) {
    global wvGui, wvReady, API_PROVIDER, API_MODEL, COMMAND_PROMPTS, COMMAND_MODELS, COMMAND_PROVIDERS

    switch action {
    case "ready":
        wvReady := true
        SendClipboardToUI()
        SendCommandsToUI()
        SendModelToUI()
        SendCommandHotkeyToUI()
        ScheduleWindowFocus("main", wvGui, "focusPrompt()", 1200)

    case "submit":
        promptText := wvGui.ExecuteScript("document.getElementById('prompt').value")
        clipText := wvGui.ExecuteScript("document.getElementById('clipboard-preview').value")
        cmdName := Trim(wvGui.ExecuteScript("document.getElementById('command-input').value"))
        modelOverride := ""
        providerOverride := ""
        if (cmdName != "" && COMMAND_MODELS.Has(cmdName))
            modelOverride := COMMAND_MODELS[cmdName]
        if (cmdName != "" && COMMAND_PROVIDERS.Has(cmdName))
            providerOverride := COMMAND_PROVIDERS[cmdName]
        ProcessPrompt(promptText, clipText, modelOverride, providerOverride)

    case "commandSelected":
        cmdName := Trim(wvGui.ExecuteScript("document.getElementById('command-input').value"))
        if COMMAND_PROMPTS.Has(cmdName) {
            promptText := COMMAND_PROMPTS[cmdName]
            wvGui.ExecuteScriptAsync('setPromptText("' . EscJson(promptText) . '")')
        }
        ; Show command override (provider/model) when present, otherwise show app default
        if (cmdName != "" && (COMMAND_MODELS.Has(cmdName) || COMMAND_PROVIDERS.Has(cmdName))) {
            displayProvider := COMMAND_PROVIDERS.Has(cmdName) ? NormalizeProvider(COMMAND_PROVIDERS[cmdName]) : API_PROVIDER
            displayModel := COMMAND_MODELS.Has(cmdName) ? COMMAND_MODELS[cmdName] : LoadSelectedModel(displayProvider)
            wvGui.ExecuteScriptAsync('setModelDisplay("' . EscJson(ProviderDisplayName(displayProvider) . " · " . displayModel) . '")')
        } else
            SendModelToUI()

    case "copy":
        resultText := wvGui.ExecuteScript("document.getElementById('result').value")
        if (Trim(resultText) != "") {
            A_Clipboard := resultText
            ClipWait(2)
            wvGui.ExecuteScriptAsync('setStatus("Copied to clipboard!")')
        }

    case "clear":
        wvGui.ExecuteScriptAsync("clearFields()")

    case "minimize":
        StopWindowFocus("main")
        wvGui.Minimize()

    case "hide":
        StopWindowFocus("main")
        wvGui.Hide()

    case "settings":
        ShowSettings()

    case "promptEditor":
        ShowPromptEditor()
    }
}

SendClipboardToUI() {
    global wvGui
    clipText := A_Clipboard
    escaped := EscJson(clipText)
    wvGui.ExecuteScriptAsync('setClipboardPreview("' . escaped . '")')
}

SendModelToUI() {
    global wvGui, API_PROVIDER, API_MODEL
    wvGui.ExecuteScriptAsync('setModelDisplay("' . EscJson(ProviderDisplayName(API_PROVIDER) . " · " . API_MODEL) . '")')
}

SendCommandsToUI() {
    global wvGui
    wvGui.ExecuteScriptAsync("setCommands(" . BuildCommandsJson() . ")")
}

SendCommandHotkeyToUI() {
    global wvGui, wvReady, HOTKEY_MAP
    if !IsObject(wvGui) || !wvReady
        return
    ahkKey := HOTKEY_MAP.Has("goToCommand") ? HOTKEY_MAP["goToCommand"] : ""
    wvGui.ExecuteScriptAsync('setCommandHotkey("' . EscJson(ahkKey) . '")')
}

BuildCommandsJson() {
    global ALL_COMMAND_NAMES, COMMAND_MODELS, COMMAND_HOTKEYS
    json := "["
    for i, name in ALL_COMMAND_NAMES {
        if (i > 1)
            json .= ","
        model   := COMMAND_MODELS.Has(name)  ? EscJson(COMMAND_MODELS[name])  : ""
        hotkey  := COMMAND_HOTKEYS.Has(name) ? EscJson(COMMAND_HOTKEYS[name]) : ""
        json .= '{"name":"' . EscJson(name) . '","model":"' . model . '","hotkey":"' . hotkey . '"}'
    }
    json .= "]"
    return json
}

ProcessPrompt(promptText, clipText, modelOverride := "", providerOverride := "") {
    global wvGui, API_PROVIDER, API_MODEL

    if (Trim(promptText) = "") {
        wvGui.ExecuteScriptAsync('setStatus("Write a prompt or select a command")')
        return
    }
    if (Trim(clipText) = "") {
        wvGui.ExecuteScriptAsync('setStatus("Clipboard is empty — copy some text first")')
        return
    }

    provider := (Trim(providerOverride) != "") ? NormalizeProvider(providerOverride) : API_PROVIDER
    apiKey := GetProviderApiKey(provider)
    if (apiKey = "") {
        wvGui.ExecuteScriptAsync('setStatus("Missing API key for ' . EscJson(ProviderDisplayName(provider)) . '")')
        return
    }

    ; Use command-specific model or provider default
    if (Trim(modelOverride) != "")
        useModel := modelOverride
    else if (provider = API_PROVIDER)
        useModel := API_MODEL
    else
        useModel := LoadSelectedModel(provider)

    wvGui.ExecuteScriptAsync('setResult("")')
    wvGui.ExecuteScriptAsync('setStatus("Processing with ' . EscJson(ProviderDisplayName(provider) . " · " . useModel) . '...")')

    userMessage := promptText . "`n`n---`n`n" . clipText
    lang := DetectLanguage(clipText)
    sysPrompt := GetSystemPrompt("fix", lang)
        . "`n`nThe user will give you a prompt/instruction followed by the text to work with (separated by ---). Follow the prompt instructions. Return ONLY the result, no explanations."

    try {
        result := CallProvider(userMessage, sysPrompt, provider, apiKey, useModel)
        wvGui.ExecuteScriptAsync('setResult("' . EscJson(result) . '")')
        wvGui.ExecuteScriptAsync('setStatus("Done — ' . StrLen(result) . ' chars (' . EscJson(ProviderDisplayName(provider) . " · " . useModel) . ')")')
    } catch as e {
        wvGui.ExecuteScriptAsync('setResult("Error: ' . EscJson(e.Message) . '")')
        wvGui.ExecuteScriptAsync('setStatus("Error")')
    }
}

; ============================================================
; SETTINGS WINDOW
; ============================================================
global settingsGui := ""
global settingsReady := false

ShowSettings() {
    global settingsGui, settingsReady

    if IsObject(settingsGui) {
        GetActiveMonitorWorkArea(&ml, &mt, &mr, &mb)
        WinGetPos(,, &curW, &curH, settingsGui.Hwnd)
        x := ml + (mr - ml - curW) // 2
        y := mt + (mb - mt - curH) // 3
        settingsGui.Show("x" . x . " y" . y)
        ScheduleWindowFocus("settings", settingsGui, settingsReady ? "document.getElementById('provider-select').focus()" : "", 1200)
        return
    }

    dllPath := A_ScriptDir "\lib\" (A_PtrSize * 8) "bit\WebView2Loader.dll"
    settingsGui := WebViewGui("+AlwaysOnTop +Resize +MinSize300x200 -Caption", "Settings",, {DllPath: dllPath})
    settingsGui.OnEvent("Close", SaveSettingsSize)
    if (A_IsCompiled)
        settingsGui.Control.BrowseFolder(A_ScriptDir)

    ; Listen for messages from JS
    settingsGui.Control.wv.add_WebMessageReceived(SettingsMessageHandler)

    settingsGui.Navigate("ui/settings.html")
    ; Restore saved size or use default (min 300x200)
    savedW := ReadSetting("settings_w")
    savedH := ReadSetting("settings_h")
    w := (savedW != "" && Integer(savedW) >= 300) ? savedW : 450
    h := (savedH != "" && Integer(savedH) >= 200) ? savedH : 400
    GetActiveMonitorWorkArea(&ml, &mt, &mr, &mb)
    x := ml + (mr - ml - w) // 2
    y := mt + (mb - mt - h) // 3
    settingsGui.Show("x" . x . " y" . y . " w" . w . " h" . h)
    ScheduleWindowFocus("settings", settingsGui, settingsReady ? "document.getElementById('provider-select').focus()" : "", 1200)
}

SaveSettingsSize(*) {
    global settingsGui
    StopWindowFocus("settings")
    try {
        settingsGui.GetPos(,, &w, &h)
        if (w > 0 && h > 0)
            SaveSettingBatch(Map("settings_w", w, "settings_h", h))
        settingsGui.Hide()
    }
    ResumeDynamicHotkeys()
    return 1
}

SettingsMessageHandler(wv, msg) {
    try data := msg.WebMessageAsJson
    catch
        return

    if !RegExMatch(data, '"action"\s*:\s*"(\w+)"', &m)
        return

    SetTimer(HandleSettingsAction.Bind(m[1], data), -1)
}

ExtractJsonString(rawJson, key) {
    pattern := '"' . key . '"\s*:\s*"((?:[^"\\]|\\.)*)"'
    if RegExMatch(rawJson, pattern, &m) {
        value := m[1]
        value := StrReplace(value, "\n", "`n")
        value := StrReplace(value, "\r", "")
        value := StrReplace(value, "\t", "`t")
        value := StrReplace(value, '\"', '"')
        value := StrReplace(value, "\\", "\")
        return value
    }
    return ""
}

HandleSettingsAction(action, rawJson) {
    global settingsGui, settingsReady, API_PROVIDER, API_MODEL, API_KEYS, wvGui, wvReady, editorGui, editorReady

    switch action {
    case "ready":
        settingsReady := true
        ; Send current settings
        settingsGui.ExecuteScriptAsync('setCurrentProvider("' . EscJson(API_PROVIDER) . '")')
        settingsGui.ExecuteScriptAsync('setCurrentModel("' . EscJson(API_MODEL) . '")')
        SendApiKeysToSettings()
        SendHotkeysToSettings()
        SendAutostartToSettings()
        ; Fetch and send available models
        FetchAndSendModels()
        ScheduleWindowFocus("settings", settingsGui, "document.getElementById('provider-select').focus()", 800)

    case "modelSelected":
        selectedId := settingsGui.ExecuteScript("currentModelId")
        if (Trim(selectedId) != "") {
            SaveSelectedModel(selectedId, API_PROVIDER)
            settingsGui.ExecuteScriptAsync('setStatus("Model saved for ' . EscJson(ProviderDisplayName(API_PROVIDER)) . ': ' . EscJson(selectedId) . '")')
            ; Update main window if open
            if IsObject(wvGui) && wvReady
                SendModelToUI()
        }

    case "providerSelected":
        selectedProvider := ExtractJsonString(rawJson, "provider")
        if (selectedProvider != "") {
            SaveSelectedProvider(selectedProvider)
            EnsureActiveProviderHasKey()
            settingsGui.ExecuteScriptAsync('setCurrentProvider("' . EscJson(API_PROVIDER) . '")')
            settingsGui.ExecuteScriptAsync('setCurrentModel("' . EscJson(API_MODEL) . '")')
            FetchAndSendModels()
            settingsGui.ExecuteScriptAsync('setStatus("Provider saved: ' . EscJson(ProviderDisplayName(API_PROVIDER)) . '")')
            if IsObject(wvGui) && wvReady
                SendModelToUI()
            if IsObject(editorGui) && editorReady
                SendModelsToEditor()
        }

    case "saveApiKeys":
        API_KEYS["openrouter"] := Trim(ExtractJsonString(rawJson, "openrouterKey"))
        API_KEYS["openai"] := Trim(ExtractJsonString(rawJson, "openaiKey"))
        API_KEYS["anthropic"] := Trim(ExtractJsonString(rawJson, "anthropicKey"))
        API_KEYS["xai"] := Trim(ExtractJsonString(rawJson, "xaiKey"))

        SaveApiKey("openrouter", API_KEYS["openrouter"])
        SaveApiKey("openai", API_KEYS["openai"])
        SaveApiKey("anthropic", API_KEYS["anthropic"])
        SaveApiKey("xai", API_KEYS["xai"])

        EnsureActiveProviderHasKey()
        settingsGui.ExecuteScriptAsync('setCurrentProvider("' . EscJson(API_PROVIDER) . '")')
        settingsGui.ExecuteScriptAsync('setCurrentModel("' . EscJson(API_MODEL) . '")')
        FetchAndSendModels()

        if HasAnyApiKey(API_KEYS)
            settingsGui.ExecuteScriptAsync('setStatus("API keys saved")')
        else
            settingsGui.ExecuteScriptAsync('setStatus("Saved, but no API keys configured")')

        if IsObject(wvGui) && wvReady
            SendModelToUI()
        if IsObject(editorGui) && editorReady
            SendModelsToEditor()

    case "hotkeyChanged":
        ; Parse id and key directly from the JSON message (no ExecuteScript needed)
        actionId := ExtractJsonString(rawJson, "id")
        ahkKey := ExtractJsonString(rawJson, "key")
        ; key:"" (clear) is valid — regex still matches empty capture
        if (actionId != "") {
            try {
                RegisterSingleHotkey(actionId, ahkKey)
                settingsGui.ExecuteScriptAsync('setStatus("Hotkey saved")')
                if (actionId = "goToCommand")
                    SendCommandHotkeyToUI()
            } catch as e {
                settingsGui.ExecuteScriptAsync('setStatus("Error: ' . EscJson(e.Message) . '")')
            }
        }

    case "setAutostart":
        enable := InStr(rawJson, '"enabled":true') ? true : false
        SetAutostart(enable)
        msg := enable ? "Added to Windows startup" : "Removed from Windows startup"
        settingsGui.ExecuteScriptAsync('setStatus("' . EscJson(msg) . '")')

    case "startRecording":
        SuspendDynamicHotkeys()

    case "stopRecording":
        ResumeDynamicHotkeys()

    case "refreshModels":
        settingsGui.ExecuteScriptAsync('setStatus("Fetching models...")')
        FetchAndSendModels()

    case "minimize":
        StopWindowFocus("settings")
        settingsGui.Minimize()

    case "close":
        StopWindowFocus("settings")
        try {
            settingsGui.GetPos(,, &w, &h)
            if (w > 0 && h > 0)
                SaveSettingBatch(Map("settings_w", w, "settings_h", h))
        }
        settingsGui.Hide()
        ResumeDynamicHotkeys()
    }
}

FetchAndSendModels() {
    global settingsGui, API_PROVIDER
    provider := API_PROVIDER
    apiKey := GetProviderApiKey(provider)

    if (apiKey = "") {
        settingsGui.ExecuteScriptAsync("setModels([])")
        settingsGui.ExecuteScriptAsync('setStatus("Missing API key for ' . EscJson(ProviderDisplayName(provider)) . '")')
        return
    }

    try {
        modelsJson := FetchModels(provider, apiKey)
        settingsGui.ExecuteScriptAsync("setModels(" . modelsJson . ")")
        settingsGui.ExecuteScriptAsync('setStatus("Loaded models for ' . EscJson(ProviderDisplayName(provider)) . '")')
    } catch as e {
        settingsGui.ExecuteScriptAsync('setStatus("Error loading models: ' . EscJson(e.Message) . '")')
    }
}

SendApiKeysToSettings() {
    global settingsGui, API_KEYS
    json := '{'
        . '"openrouter":"' . EscJson(API_KEYS["openrouter"]) . '",'
        . '"openai":"' . EscJson(API_KEYS["openai"]) . '",'
        . '"anthropic":"' . EscJson(API_KEYS["anthropic"]) . '",'
        . '"xai":"' . EscJson(API_KEYS["xai"]) . '"'
        . '}'
    settingsGui.ExecuteScriptAsync("setApiKeys(" . json . ")")
}

SendHotkeysToSettings() {
    global settingsGui, HOTKEY_MAP, HOTKEY_LABELS
    ; Build JSON: [{id, label, ahkKey}, ...]
    json := "["
    first := true
    for actionId, ahkKey in HOTKEY_MAP {
        if !first
            json .= ","
        label := HOTKEY_LABELS.Has(actionId) ? HOTKEY_LABELS[actionId] : actionId
        json .= '{"id":"' . EscJson(actionId) . '","label":"' . EscJson(label) . '","ahkKey":"' . EscJson(ahkKey) . '"}'
        first := false
    }
    json .= "]"
    settingsGui.ExecuteScriptAsync("setHotkeys(" . json . ")")
}

GetAutostart() {
    try {
        val := RegRead("HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run", "ai-assistant")
        return val != ""
    } catch {
        return false
    }
}

SetAutostart(enable) {
    regKey := "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
    if enable {
        val := '"' . A_AhkPath . '" "' . A_ScriptFullPath . '"'
        RegWrite(val, "REG_SZ", regKey, "ai-assistant")
    } else {
        try RegDelete(regKey, "ai-assistant")
    }
}

SendAutostartToSettings() {
    global settingsGui
    settingsGui.ExecuteScriptAsync("setAutostart(" . (GetAutostart() ? "true" : "false") . ")")
}

; ============================================================
; PROMPT PICKER WINDOW
; ============================================================
global pickerGui := ""
global pickerReady := false
global pickerPrevWin := 0

InitPickerWindow() {
    global pickerGui
    dllPath := A_ScriptDir "\lib\" (A_PtrSize * 8) "bit\WebView2Loader.dll"
    pickerGui := WebViewGui("+AlwaysOnTop -Caption", "Prompt Picker",, {DllPath: dllPath})
    pickerGui.OnEvent("Close", PickerWindowClose)
    if (A_IsCompiled)
        pickerGui.Control.BrowseFolder(A_ScriptDir)
    pickerGui.Control.wv.add_WebMessageReceived(PickerMessageHandler)
    pickerGui.Navigate("ui/picker.html")
}

ShowPickerWindow() {
    global pickerGui, pickerReady, pickerPrevWin

    if !IsObject(pickerGui)
        InitPickerWindow()

    ; Remember where focus was so we can restore it on close/pick
    pickerPrevWin := WinExist("A")

    ; Center on active monitor, slightly above middle
    GetActiveMonitorWorkArea(&ml, &mt, &mr, &mb)
    w := 420
    h := 320
    x := ml + (mr - ml - w) // 2
    y := mt + (mb - mt - h) // 3
    pickerGui.Show("x" . x . " y" . y . " w" . w . " h" . h)
    ScheduleWindowFocus("picker", pickerGui, pickerReady ? "resetAndFocus()" : "", 1800)
}

PickerMessageHandler(wv, msg) {
    try data := msg.WebMessageAsJson
    catch
        return
    if !RegExMatch(data, '"action"\s*:\s*"(\w+)"', &m)
        return
    SetTimer(HandlePickerAction.Bind(m[1], data), -1)
}

HandlePickerAction(action, rawJson) {
    global pickerGui, pickerReady, pickerPrevWin

    switch action {
    case "ready":
        pickerReady := true
        SendCommandsToPickerUI()
        ScheduleWindowFocus("picker", pickerGui, "resetAndFocus()", 1000)

    case "pick":
        promptName := ""
        if RegExMatch(rawJson, '"name"\s*:\s*"((?:[^"\\]|\\.)*)"', &mName)
            promptName := StrReplace(mName[1], '\"', '"')
        StopWindowFocus("picker")
        pickerGui.Hide()
        if (pickerPrevWin)
            WinActivate("ahk_id " . pickerPrevWin)
        if (promptName != "")
            SetTimer(ExecutePromptSilently.Bind(promptName), -100)

    case "close":
        StopWindowFocus("picker")
        pickerGui.Hide()
        if (pickerPrevWin)
            WinActivate("ahk_id " . pickerPrevWin)
    }
}

PickerWindowClose(*) {
    global pickerGui
    StopWindowFocus("picker")
    pickerGui.Hide()
    return 1
}

SendCommandsToPickerUI() {
    global pickerGui, pickerReady
    if !IsObject(pickerGui) || !pickerReady
        return
    pickerGui.ExecuteScriptAsync("setCommands(" . BuildCommandsJson() . ")")
}

; ============================================================
; PROMPT EDITOR WINDOW
; ============================================================
global editorGui := ""
global editorReady := false

ShowPromptEditor() {
    global editorGui, editorReady

    if IsObject(editorGui) {
        GetActiveMonitorWorkArea(&ml, &mt, &mr, &mb)
        WinGetPos(,, &curW, &curH, editorGui.Hwnd)
        x := ml + (mr - ml - curW) // 2
        y := mt + (mb - mt - curH) // 3
        editorGui.Show("x" . x . " y" . y)
        if (editorReady)
            SendPromptsToEditor()
        ScheduleWindowFocus("editor", editorGui, editorReady ? "document.getElementById('prompt-filter').focus()" : "", 1200)
        return
    }

    dllPath := A_ScriptDir "\lib\" (A_PtrSize * 8) "bit\WebView2Loader.dll"
    editorGui := WebViewGui("+AlwaysOnTop +Resize +MinSize500x400 -Caption", "Prompt Editor",, {DllPath: dllPath})
    editorGui.OnEvent("Close", EditorWindowClose)
    if (A_IsCompiled)
        editorGui.Control.BrowseFolder(A_ScriptDir)
    editorGui.Control.wv.add_WebMessageReceived(EditorMessageHandler)
    editorGui.Navigate("ui/prompt-editor.html")
    GetActiveMonitorWorkArea(&ml, &mt, &mr, &mb)
    savedW := ReadSetting("editor_w")
    savedH := ReadSetting("editor_h")
    w := (savedW != "" && Integer(savedW) >= 500) ? savedW : 600
    h := (savedH != "" && Integer(savedH) >= 400) ? savedH : 550
    x := ml + (mr - ml - w) // 2
    y := mt + (mb - mt - h) // 3
    editorGui.Show("x" . x . " y" . y . " w" . w . " h" . h)
    ScheduleWindowFocus("editor", editorGui, editorReady ? "document.getElementById('prompt-filter').focus()" : "", 1200)
}

EditorMessageHandler(wv, msg) {
    try data := msg.WebMessageAsJson
    catch
        return
    if !RegExMatch(data, '"action"\s*:\s*"(\w+)"', &m)
        return
    SetTimer(HandleEditorAction.Bind(m[1], data), -1)
}

HandleEditorAction(action, rawJson := "") {
    global editorGui, editorReady, COMMAND_PROMPTS, COMMAND_MODELS, COMMAND_PROVIDERS, COMMAND_HOTKEYS, COMMAND_CONFIRMS, ALL_COMMAND_NAMES, wvGui, wvReady, API_PROVIDER

    switch action {
    case "ready":
        editorReady := true
        ; Defensive restore in case recording mode previously suspended hotkeys.
        ResumeDynamicHotkeys()
        ResumePromptHotkeys()
        SendPromptsToEditor()
        editorGui.ExecuteScriptAsync('setDefaultProvider("' . EscJson(API_PROVIDER) . '")')
        SendModelsToEditor(API_PROVIDER)
        ScheduleWindowFocus("editor", editorGui, "document.getElementById('prompt-filter').focus()", 800)

    case "providerChanged":
        selectedProvider := ExtractJsonString(rawJson, "provider")
        if (selectedProvider = "")
            selectedProvider := API_PROVIDER
        SendModelsToEditor(selectedProvider)

    case "startRecording":
        SuspendDynamicHotkeys()
        SuspendPromptHotkeys()

    case "stopRecording":
        ResumeDynamicHotkeys()
        ResumePromptHotkeys()

    case "savePrompt":
        ; Read fields from JS
        newName := editorGui.ExecuteScript("document.getElementById('prompt-name').value")
        newProvider := editorGui.ExecuteScript("document.getElementById('prompt-provider').value")
        newModel := editorGui.ExecuteScript("document.getElementById('prompt-model').value")
        newText := editorGui.ExecuteScript("document.getElementById('prompt-text').value")
        newHotkey := editorGui.ExecuteScript("document.getElementById('prompt-hotkey').dataset.ahkKey || ''")
        newConfirm := editorGui.ExecuteScript("document.getElementById('prompt-confirm').checked ? '1' : ''")
        oldName := editorGui.ExecuteScript("selectedName")
        isFile := editorGui.ExecuteScript("isFilePrompt")
        if (Trim(newProvider) != "")
            newProvider := NormalizeProvider(newProvider)

        if (Trim(newName) = "") {
            editorGui.ExecuteScriptAsync('setStatus("Name cannot be empty")')
            return
        }
        ; For @file prompts, only save model/hotkey changes (text is read-only)
        if (isFile = "true") {
            ; Update provider/model in memory
            if (Trim(newProvider) != "")
                COMMAND_PROVIDERS[newName] := Trim(newProvider)
            else if COMMAND_PROVIDERS.Has(newName)
                COMMAND_PROVIDERS.Delete(newName)
            if (Trim(newModel) != "")
                COMMAND_MODELS[newName] := Trim(newModel)
            else if COMMAND_MODELS.Has(newName)
                COMMAND_MODELS.Delete(newName)
            ; Update hotkey in memory
            if (Trim(newHotkey) != "")
                COMMAND_HOTKEYS[newName] := Trim(newHotkey)
            else if COMMAND_HOTKEYS.Has(newName)
                COMMAND_HOTKEYS.Delete(newName)
            if (newConfirm != "")
                COMMAND_CONFIRMS[newName] := true
            else if COMMAND_CONFIRMS.Has(newName)
                COMMAND_CONFIRMS.Delete(newName)
        } else {
            ; Remove old name if renamed
            if (oldName != "" && oldName != newName) {
                if COMMAND_PROMPTS.Has(oldName)
                    COMMAND_PROMPTS.Delete(oldName)
                if COMMAND_MODELS.Has(oldName)
                    COMMAND_MODELS.Delete(oldName)
                if COMMAND_PROVIDERS.Has(oldName)
                    COMMAND_PROVIDERS.Delete(oldName)
                if COMMAND_HOTKEYS.Has(oldName)
                    COMMAND_HOTKEYS.Delete(oldName)
                if COMMAND_CONFIRMS.Has(oldName)
                    COMMAND_CONFIRMS.Delete(oldName)
            }
            ; Update in memory
            COMMAND_PROMPTS[newName] := newText
            if (Trim(newProvider) != "")
                COMMAND_PROVIDERS[newName] := Trim(newProvider)
            else if COMMAND_PROVIDERS.Has(newName)
                COMMAND_PROVIDERS.Delete(newName)
            if (Trim(newModel) != "")
                COMMAND_MODELS[newName] := Trim(newModel)
            else if COMMAND_MODELS.Has(newName)
                COMMAND_MODELS.Delete(newName)
            if (Trim(newHotkey) != "")
                COMMAND_HOTKEYS[newName] := Trim(newHotkey)
            else if COMMAND_HOTKEYS.Has(newName)
                COMMAND_HOTKEYS.Delete(newName)
            if (newConfirm != "")
                COMMAND_CONFIRMS[newName] := true
            else if COMMAND_CONFIRMS.Has(newName)
                COMMAND_CONFIRMS.Delete(newName)
        }

        ; Re-register prompt hotkeys to reflect changes
        RegisterPromptHotkeys(COMMAND_HOTKEYS)

        ; Rebuild name list
        RebuildCommandNames()

        ; Save to prompts.json
        SavePromptsJson()

        ; Refresh editor and main window
        SendPromptsToEditor()
        editorGui.ExecuteScriptAsync('onSaved("' . EscJson(newName) . '")')
        ResumeDynamicHotkeys()
        ResumePromptHotkeys()
        if IsObject(wvGui) && wvReady
            SendCommandsToUI()

    case "deletePrompt":
        delName := editorGui.ExecuteScript("selectedName")
        if (delName = "" || !COMMAND_PROMPTS.Has(delName))
            return

        COMMAND_PROMPTS.Delete(delName)
        if COMMAND_PROVIDERS.Has(delName)
            COMMAND_PROVIDERS.Delete(delName)
        if COMMAND_MODELS.Has(delName)
            COMMAND_MODELS.Delete(delName)
        if COMMAND_HOTKEYS.Has(delName)
            COMMAND_HOTKEYS.Delete(delName)
        if COMMAND_CONFIRMS.Has(delName)
            COMMAND_CONFIRMS.Delete(delName)

        RegisterPromptHotkeys(COMMAND_HOTKEYS)
        RebuildCommandNames()
        SavePromptsJson()
        SendPromptsToEditor()
        editorGui.ExecuteScriptAsync('setStatus("Deleted: ' . EscJson(delName) . '")')
        if IsObject(wvGui) && wvReady
            SendCommandsToUI()

    case "minimize":
        StopWindowFocus("editor")
        editorGui.Minimize()
        ResumeDynamicHotkeys()
        ResumePromptHotkeys()

    case "close":
        StopWindowFocus("editor")
        editorGui.Hide()
        ResumeDynamicHotkeys()
        ResumePromptHotkeys()
    }
}

SendModelsToEditor(provider := "") {
    global editorGui, API_PROVIDER
    if (Trim(provider) = "")
        provider := API_PROVIDER
    provider := NormalizeProvider(provider)
    apiKey := GetProviderApiKey(provider)

    if (apiKey = "") {
        editorGui.ExecuteScriptAsync("setModels([])")
        editorGui.ExecuteScriptAsync('setStatus("Missing API key for ' . EscJson(ProviderDisplayName(provider)) . '")')
        return
    }

    try {
        modelsJson := FetchModels(provider, apiKey)
        editorGui.ExecuteScriptAsync("setModels(" . modelsJson . ")")
        if (provider = API_PROVIDER)
            editorGui.ExecuteScriptAsync('setDefaultProvider("' . EscJson(provider) . '")')
        editorGui.ExecuteScriptAsync('setStatus("Models loaded from ' . EscJson(ProviderDisplayName(provider)) . '")')
    } catch as e {
        editorGui.ExecuteScriptAsync('setStatus("Error loading models: ' . EscJson(e.Message) . '")')
    }
}

ExtractPromptDirectives(rawValue, &providerOut, &modelOut, &bodyOut) {
    providerOut := ""
    modelOut := ""
    bodyOut := rawValue

    ; Parse optional metadata lines from the top:
    ; @provider:<id>
    ; @model:<id>
    while true {
        nlPos := InStr(bodyOut, "`n")
        if (nlPos > 0) {
            line := Trim(SubStr(bodyOut, 1, nlPos - 1))
            rest := LTrim(SubStr(bodyOut, nlPos + 1))
        } else {
            line := Trim(bodyOut)
            rest := ""
        }

        lower := StrLower(line)
        if (SubStr(lower, 1, 10) = "@provider:") {
            candidateProvider := StrLower(Trim(SubStr(line, 11)))
            if IsValidProvider(candidateProvider)
                providerOut := candidateProvider
            bodyOut := rest
            continue
        }
        if (SubStr(lower, 1, 7) = "@model:") {
            modelOut := Trim(SubStr(line, 8))
            bodyOut := rest
            continue
        }
        break
    }
}

StripPromptMetadata(rawValue, &bodyOut) {
    bodyOut := rawValue

    while true {
        nlPos := InStr(bodyOut, "`n")
        if (nlPos > 0) {
            line := Trim(SubStr(bodyOut, 1, nlPos - 1))
            rest := LTrim(SubStr(bodyOut, nlPos + 1))
        } else {
            line := Trim(bodyOut)
            rest := ""
        }

        lower := StrLower(line)
        if (SubStr(lower, 1, 10) = "@provider:"
         || SubStr(lower, 1, 7) = "@model:"
         || SubStr(lower, 1, 8) = "@hotkey:"
         || SubStr(lower, 1, 9) = "@confirm:") {
            bodyOut := rest
            continue
        }
        break
    }
}

SendPromptsToEditor() {
    global editorGui, COMMAND_PROMPTS, COMMAND_MODELS, COMMAND_PROVIDERS, COMMAND_HOTKEYS, COMMAND_CONFIRMS, ALL_COMMAND_NAMES, PROMPTS_FILE
    ; Build JSON array: [{name, prompt, provider, model, hotkey, confirm, isFile}, ...]
    ; Need to check which entries are @file: by re-reading prompts.json
    fileEntries := Map()
    if FileExist(PROMPTS_FILE) {
        raw := FileRead(PROMPTS_FILE, "UTF-8")
        pos := 1
        while (pos := RegExMatch(raw, '"((?:[^"\\]|\\.)*?)"\s*:\s*"((?:[^"\\]|\\.)*?)"', &m, pos)) {
            key := StrReplace(m[1], '\"', '"')
            val := StrReplace(m[2], '\"', '"')
            val := StrReplace(val, "\\n", "`n")
            val := StrReplace(val, "\\\\", "\")
            StripPromptMetadata(val, &body)
            if (SubStr(body, 1, 6) = "@file:")
                fileEntries[key] := true
            pos += m.Len
        }
    }

    json := "["
    for i, name in ALL_COMMAND_NAMES {
        if (i > 1)
            json .= ","
        promptVal := COMMAND_PROMPTS.Has(name) ? COMMAND_PROMPTS[name] : ""
        providerVal := COMMAND_PROVIDERS.Has(name) ? COMMAND_PROVIDERS[name] : ""
        modelVal := COMMAND_MODELS.Has(name) ? COMMAND_MODELS[name] : ""
        hotkeyVal := COMMAND_HOTKEYS.Has(name) ? COMMAND_HOTKEYS[name] : ""
        confirmVal := (COMMAND_CONFIRMS.Has(name) && COMMAND_CONFIRMS[name]) ? "true" : "false"
        isFile := fileEntries.Has(name) ? "true" : "false"
        json .= '{"name":"' . EscJson(name) . '","prompt":"' . EscJson(promptVal) . '","provider":"' . EscJson(providerVal) . '","model":"' . EscJson(modelVal) . '","hotkey":"' . EscJson(hotkeyVal) . '","confirm":' . confirmVal . ',"isFile":' . isFile . '}'
    }
    json .= "]"
    editorGui.ExecuteScriptAsync("setPrompts(" . json . ")")
}

RebuildCommandNames() {
    global COMMAND_PROMPTS, ALL_COMMAND_NAMES
    ; Preserve order: keep existing names in order, append new ones
    newNames := []
    ; First keep existing ordered names that still exist
    for i, name in ALL_COMMAND_NAMES {
        if COMMAND_PROMPTS.Has(name)
            newNames.Push(name)
    }
    ; Add any new names not in the list
    for name, val in COMMAND_PROMPTS {
        found := false
        for i, existing in newNames {
            if (existing = name) {
                found := true
                break
            }
        }
        if !found
            newNames.Push(name)
    }
    ALL_COMMAND_NAMES := newNames
}

SavePromptsJson() {
    global COMMAND_PROMPTS, COMMAND_MODELS, COMMAND_PROVIDERS, COMMAND_HOTKEYS, COMMAND_CONFIRMS, ALL_COMMAND_NAMES, PROMPTS_FILE, PROMPTS_LAST_MOD

    ; Read original to preserve @file: entries
    fileRefs := Map()
    if FileExist(PROMPTS_FILE) {
        raw := FileRead(PROMPTS_FILE, "UTF-8")
        pos := 1
        while (pos := RegExMatch(raw, '"((?:[^"\\]|\\.)*?)"\s*:\s*"((?:[^"\\]|\\.)*?)"', &m, pos)) {
            key := StrReplace(m[1], '\"', '"')
            val := StrReplace(m[2], '\"', '"')
            val := StrReplace(val, "\\n", "`n")
            val := StrReplace(val, "\\\\", "\")
            StripPromptMetadata(val, &body)
            if (SubStr(body, 1, 6) = "@file:")
                fileRefs[key] := body
            pos += m.Len
        }
    }

    ; Build JSON
    json := "{`n"
    for i, name in ALL_COMMAND_NAMES {
        if (i > 1)
            json .= ",`n"

        ; Determine value to write
        providerPrefix := ""
        if COMMAND_PROVIDERS.Has(name)
            providerPrefix := Trim(COMMAND_PROVIDERS[name])

        modelPrefix := ""
        if COMMAND_MODELS.Has(name)
            modelPrefix := Trim(COMMAND_MODELS[name])

        prefix := ""
        if (providerPrefix != "")
            prefix .= "@provider:" . providerPrefix . "`n"
        if (modelPrefix != "")
            prefix .= "@model:" . modelPrefix . "`n"

        if fileRefs.Has(name) {
            hotkeyPrefix := ""
            if COMMAND_HOTKEYS.Has(name)
                hotkeyPrefix := Trim(COMMAND_HOTKEYS[name])
            if (hotkeyPrefix != "")
                prefix .= "@hotkey:" . hotkeyPrefix . "`n"
            if (COMMAND_CONFIRMS.Has(name) && COMMAND_CONFIRMS[name])
                prefix .= "@confirm:true`n"

            val := fileRefs[name]
            val := prefix . val
            json .= '  "' . EscJsonFile(name) . '": "' . EscJsonFile(val) . '"'
        } else {
            hotkeyPrefix := ""
            if COMMAND_HOTKEYS.Has(name)
                hotkeyPrefix := Trim(COMMAND_HOTKEYS[name])
            if (hotkeyPrefix != "")
                prefix .= "@hotkey:" . hotkeyPrefix . "`n"
            if (COMMAND_CONFIRMS.Has(name) && COMMAND_CONFIRMS[name])
                prefix .= "@confirm:true`n"

            promptVal := COMMAND_PROMPTS.Has(name) ? COMMAND_PROMPTS[name] : ""
            promptVal := prefix . promptVal
            json .= '  "' . EscJsonFile(name) . '": "' . EscJsonFile(promptVal) . '"'
        }
    }
    json .= "`n}`n"

    ; Write file
    try FileDelete(PROMPTS_FILE)
    FileAppend(json, PROMPTS_FILE, "UTF-8")
    PROMPTS_LAST_MOD := FileGetTime(PROMPTS_FILE, "M")
}

; Escape for writing to JSON file (newlines as \\n so LoadPrompts can decode them)
EscJsonFile(s) {
    s := StrReplace(s, "\", "\\")
    s := StrReplace(s, '"', '\"')
    s := StrReplace(s, "`n", "\\n")
    s := StrReplace(s, "`r", "\r")
    s := StrReplace(s, "`t", "\t")
    return s
}

ParseDirectiveBool(rawValue) {
    v := StrLower(Trim(rawValue))
    if (v = "")
        return true
    return (v = "1" || v = "true" || v = "yes" || v = "on")
}

global promptConfirmGui := ""
global promptConfirmReady := false
global promptConfirmDone := false
global promptConfirmCancelled := true
global promptConfirmPromptResult := ""
global promptConfirmInputResult := ""
global promptConfirmName := ""

ShowPromptConfirmDialog(promptName, initialPrompt, initialInput, &outPrompt, &outInput) {
    global promptConfirmGui, promptConfirmReady, promptConfirmDone, promptConfirmCancelled
    global promptConfirmPromptResult, promptConfirmInputResult, promptConfirmName

    if !IsObject(promptConfirmGui)
        InitPromptConfirmWindow()

    promptConfirmName := promptName
    promptConfirmDone := false
    promptConfirmCancelled := true
    promptConfirmPromptResult := initialPrompt
    promptConfirmInputResult := initialInput

    GetActiveMonitorWorkArea(&ml, &mt, &mr, &mb)
    w := 760
    h := 560
    x := ml + (mr - ml - w) // 2
    y := mt + (mb - mt - h) // 3
    promptConfirmGui.Show("x" . x . " y" . y . " w" . w . " h" . h)
    if (promptConfirmReady)
        SendPromptConfirmData()
    ScheduleWindowFocus("promptConfirm", promptConfirmGui, promptConfirmReady ? "focusPromptField()" : "", 2500)

    while !promptConfirmDone
        Sleep(20)

    try promptConfirmGui.Hide()

    outPrompt := promptConfirmPromptResult
    outInput := promptConfirmInputResult
    return !promptConfirmCancelled
}

InitPromptConfirmWindow() {
    global promptConfirmGui

    dllPath := A_ScriptDir "\lib\" (A_PtrSize * 8) "bit\WebView2Loader.dll"
    promptConfirmGui := WebViewGui("+AlwaysOnTop +Resize +MinSize520x320 -Caption", "Confirm Prompt",, {DllPath: dllPath})
    promptConfirmGui.OnEvent("Close", PromptConfirmWindowClose)
    if (A_IsCompiled)
        promptConfirmGui.Control.BrowseFolder(A_ScriptDir)
    promptConfirmGui.Control.wv.add_WebMessageReceived(PromptConfirmMessageHandler)
    promptConfirmGui.Navigate("ui/prompt-confirm.html")
}

PromptConfirmWindowClose(*) {
    global promptConfirmDone, promptConfirmCancelled, promptConfirmGui
    promptConfirmCancelled := true
    promptConfirmDone := true
    StopWindowFocus("promptConfirm")
    if IsObject(promptConfirmGui)
        promptConfirmGui.Hide()
    return 1
}

PromptConfirmMessageHandler(wv, msg) {
    try data := msg.WebMessageAsJson
    catch
        return
    if !RegExMatch(data, '"action"\s*:\s*"(\w+)"', &m)
        return
    SetTimer(HandlePromptConfirmAction.Bind(m[1], data), -1)
}

SendPromptConfirmData() {
    global promptConfirmGui, promptConfirmReady, promptConfirmName, promptConfirmPromptResult, promptConfirmInputResult
    if !IsObject(promptConfirmGui) || !promptConfirmReady
        return
    json := '{'
        . '"name":"' . EscJson(promptConfirmName) . '",'
        . '"prompt":"' . EscJson(promptConfirmPromptResult) . '",'
        . '"input":"' . EscJson(promptConfirmInputResult) . '"'
        . '}'
    promptConfirmGui.ExecuteScriptAsync("setConfirmData(" . json . ")")
}

HandlePromptConfirmAction(action, rawJson := "") {
    global promptConfirmGui, promptConfirmReady, promptConfirmDone, promptConfirmCancelled
    global promptConfirmPromptResult, promptConfirmInputResult

    switch action {
    case "ready":
        promptConfirmReady := true
        SendPromptConfirmData()
        ScheduleWindowFocus("promptConfirm", promptConfirmGui, "focusPromptField()", 1000)

    case "confirm":
        promptVal := ExtractJsonString(rawJson, "prompt")
        inputVal := ExtractJsonString(rawJson, "input")
        if (Trim(promptVal) = "") {
            promptConfirmGui.ExecuteScriptAsync('setStatus("Prompt cannot be empty")')
            return
        }
        promptConfirmPromptResult := promptVal
        promptConfirmInputResult := inputVal
        promptConfirmCancelled := false
        promptConfirmDone := true
        StopWindowFocus("promptConfirm")

    case "cancel":
        promptConfirmCancelled := true
        promptConfirmDone := true
        StopWindowFocus("promptConfirm")

    case "minimize":
        if IsObject(promptConfirmGui)
            promptConfirmGui.Minimize()

    case "close":
        promptConfirmCancelled := true
        promptConfirmDone := true
        StopWindowFocus("promptConfirm")
    }
}

; ============================================================
; PROMPTS: loaded from prompts.json, auto-reloaded on change
; ============================================================
global COMMAND_PROMPTS := Map()
global COMMAND_PROVIDERS := Map()
global COMMAND_MODELS := Map()
global COMMAND_HOTKEYS := Map()
global COMMAND_CONFIRMS := Map()
global PROMPT_HOTKEY_MAP := Map()
global ALL_COMMAND_NAMES := []
global PROMPTS_FILE := A_ScriptDir . "\prompts.json"
global PROMPTS_LAST_MOD := ""
ChordSetTimeout(0.9)

LoadPrompts() {
    global COMMAND_PROMPTS, COMMAND_PROVIDERS, COMMAND_MODELS, COMMAND_HOTKEYS, COMMAND_CONFIRMS, ALL_COMMAND_NAMES, PROMPTS_FILE, PROMPTS_LAST_MOD

    if !FileExist(PROMPTS_FILE) {
        ShowTip("prompts.json not found!", 5000)
        return
    }

    PROMPTS_LAST_MOD := FileGetTime(PROMPTS_FILE, "M")
    content := FileRead(PROMPTS_FILE, "UTF-8")

    ; Validate: must be a JSON object (starts with { and ends with })
    if !RegExMatch(Trim(content), "^\{[\s\S]*\}$") {
        ShowTip("prompts.json is not valid JSON (missing braces)", 5000)
        return
    }

    ; Parse flat JSON object: { "key": "value", ... }
    newPrompts := Map()
    newProviders := Map()
    newModels := Map()
    newHotkeys := Map()
    newConfirms := Map()
    newNames := []
    pos := 1
    while (pos := RegExMatch(content, '"((?:[^"\\]|\\.)*?)"\s*:\s*"((?:[^"\\]|\\.)*?)"', &m, pos)) {
        key := StrReplace(m[1], '\"', '"')
        val := StrReplace(m[2], '\"', '"')
        val := StrReplace(val, "\\n", "`n")
        val := StrReplace(val, "\\\\", "\")

        ; Extract optional metadata directives before loading body
        ExtractPromptDirectives(val, &providerId, &modelId, &bodyVal)
        if (providerId != "")
            newProviders[key] := providerId
        if (modelId != "")
            newModels[key] := modelId

        ; Parse additional directives left at the top (supports mixed order).
        loop {
            nlPos := InStr(bodyVal, "`n")
            if (nlPos > 0) {
                line := Trim(SubStr(bodyVal, 1, nlPos - 1))
                rest := LTrim(SubStr(bodyVal, nlPos + 1))
            } else {
                line := Trim(bodyVal)
                rest := ""
            }

            lower := StrLower(line)
            if (SubStr(lower, 1, 10) = "@provider:") {
                candidateProvider := StrLower(Trim(SubStr(line, 11)))
                if IsValidProvider(candidateProvider)
                    newProviders[key] := candidateProvider
                bodyVal := rest
                continue
            }
            if (SubStr(lower, 1, 7) = "@model:") {
                newModels[key] := Trim(SubStr(line, 8))
                bodyVal := rest
                continue
            }
            if (SubStr(lower, 1, 8) = "@hotkey:") {
                newHotkeys[key] := Trim(SubStr(line, 9))
                bodyVal := rest
                continue
            }
            if (SubStr(lower, 1, 9) = "@confirm:") {
                if ParseDirectiveBool(SubStr(line, 10))
                    newConfirms[key] := true
                else if newConfirms.Has(key)
                    newConfirms.Delete(key)
                bodyVal := rest
                continue
            }
            break
        }

        ; Support @file: references — load content from external file
        if (SubStr(bodyVal, 1, 6) = "@file:") {
            filePath := A_ScriptDir . "\" . SubStr(bodyVal, 7)
            if FileExist(filePath)
                bodyVal := FileRead(filePath, "UTF-8")
            else
                bodyVal := "ERROR: File not found: " . filePath
        }

        newPrompts[key] := bodyVal
        newNames.Push(key)
        pos += m.Len
    }

    ; Validate: at least one command was parsed
    if (newNames.Length = 0) {
        ShowTip("prompts.json has no valid commands", 5000)
        return
    }

    COMMAND_PROMPTS := newPrompts
    COMMAND_PROVIDERS := newProviders
    COMMAND_MODELS := newModels
    COMMAND_CONFIRMS := newConfirms
    ALL_COMMAND_NAMES := newNames
    RegisterPromptHotkeys(newHotkeys)
}

RegisterPromptHotkeys(newHotkeys) {
    global PROMPT_HOTKEY_MAP, COMMAND_HOTKEYS
    ; Unregister all previously registered prompt hotkeys
    for name, key in PROMPT_HOTKEY_MAP {
        if (key != "")
            try Hotkey(key, "Off")
    }
    PROMPT_HOTKEY_MAP := Map()
    COMMAND_HOTKEYS := newHotkeys
    ChordUnregisterAll()

    ; Register simple hotkeys directly; collect two-step chord mappings for module registration.
    chordPrefixMap := Map()
    for name, key in newHotkeys {
        key := Trim(key)
        if (key = "")
            continue

        prefixHotkey := ""
        suffixKey := ""
        if ChordTryParseHotkeySpec(key, &prefixHotkey, &suffixKey) {
            if !chordPrefixMap.Has(prefixHotkey)
                chordPrefixMap[prefixHotkey] := Map()
            chordPrefixMap[prefixHotkey][suffixKey] := name
            continue
        }

        try Hotkey(key, ExecutePromptSilently.Bind(name))
        PROMPT_HOTKEY_MAP[name] := key
    }

    ChordRegister(chordPrefixMap, ExecutePromptSilently)
}

ExecutePromptSilently(promptName, *) {
    global COMMAND_PROMPTS, COMMAND_MODELS, COMMAND_PROVIDERS, COMMAND_CONFIRMS, API_PROVIDER, API_MODEL

    if !COMMAND_PROMPTS.Has(promptName) {
        ShowTip("Prompt not found: " . promptName, 3000)
        return
    }

    ShowTip(promptName . " - preparando...", 12000)

    targetWin := WinExist("A")

    ; Save full clipboard (including non-text formats)
    savedClip := ClipboardAll()
    savedText := A_Clipboard
    A_Clipboard := ""

    ; Try to copy any active selection
    Send("^c")
    hasSelection := ClipWait(0.25)

    if (hasSelection && Trim(A_Clipboard) != "") {
        inputText := A_Clipboard
    } else {
        ; No selection — use previous text clipboard content.
        inputText := savedText
    }

    if (Trim(inputText) = "") {
        ShowTip("No text to process", 2500)
        A_Clipboard := savedClip
        return
    }

    promptText := COMMAND_PROMPTS[promptName]
    if (COMMAND_CONFIRMS.Has(promptName) && COMMAND_CONFIRMS[promptName]) {
        accepted := ShowPromptConfirmDialog(promptName, promptText, inputText, &promptText, &inputText)
        if !accepted {
            ShowTip("Cancelled", 1500)
            A_Clipboard := savedClip
            return
        }
        if (Trim(inputText) = "") {
            ShowTip("No text to process", 2500)
            A_Clipboard := savedClip
            return
        }
        if (targetWin)
            try WinActivate("ahk_id " . targetWin)
    }
    providerOverride := COMMAND_PROVIDERS.Has(promptName) ? COMMAND_PROVIDERS[promptName] : ""
    provider := (Trim(providerOverride) != "") ? NormalizeProvider(providerOverride) : API_PROVIDER
    useModel := COMMAND_MODELS.Has(promptName) ? COMMAND_MODELS[promptName]
        : (provider = API_PROVIDER ? API_MODEL : LoadSelectedModel(provider))
    apiKey := GetProviderApiKey(provider)
    if (apiKey = "") {
        ShowTip("Missing API key for " . ProviderDisplayName(provider), 4000)
        A_Clipboard := savedClip
        return
    }

    runLabel := ProviderDisplayName(provider) . " · " . useModel
    ShowTip(promptName . " - solicitud lista, enviando...", 12000)

    try {
        lang := DetectLanguage(inputText)
        sysPrompt := GetSystemPrompt("fix", lang)
            . "`n`nThe user will give you a prompt/instruction followed by the text to work with (separated by ---). Follow the prompt instructions. Return ONLY the result, no explanations."
        userMessage := promptText . "`n`n---`n`n" . inputText
        ShowTip(promptName . " - modelo procesando (" . runLabel . ")...", 30000)
        result := CallProvider(userMessage, sysPrompt, provider, apiKey, useModel)

        A_Clipboard := result
        ClipWait(0.4)
        Send("^v")
        ; Delay restore asynchronously so paste can complete without blocking this thread.
        SetTimer((*) => (A_Clipboard := savedClip), -300)
        ShowTip("Done — " . StrLen(result) . " chars (" . runLabel . ")", 2000)
    } catch as e {
        ShowTip("Error: " . e.Message, 4000)
        A_Clipboard := savedClip
    }
}

CheckPromptsReload() {
    global PROMPTS_FILE, PROMPTS_LAST_MOD, wvGui, wvReady
    if !FileExist(PROMPTS_FILE)
        return
    currentMod := FileGetTime(PROMPTS_FILE, "M")
    if (currentMod != PROMPTS_LAST_MOD) {
        LoadPrompts()
        ; Update WebViews if open and ready
        if IsObject(wvGui) && wvReady
            SendCommandsToUI()
        SendCommandsToPickerUI()
        ShowTip("Prompts reloaded (" . ALL_COMMAND_NAMES.Length . " commands)", 2000)
    }
}

; Load prompts at startup
LoadPrompts()

; Check for changes every 5 seconds
SetTimer(CheckPromptsReload, 5000)

; Startup beep (audible feedback on reload)
SoundBeep(800, 100)

; Pre-load WebViews in background (deferred so they don't block startup)
SetTimer(InitMainWindow, -500)
SetTimer(InitPickerWindow, -800)
SetTimer(InitPromptConfirmWindow, -1100)

; ============================================================
; RESIZE BORDER — WM_NCHITTEST override for -Caption windows
; ============================================================
WM_NCHITTEST_Handler(wParam, lParam, msg, hwnd) {
    global wvGui, settingsGui, editorGui
    isOurs := (IsObject(wvGui)       && hwnd = wvGui.Hwnd)
           || (IsObject(settingsGui) && hwnd = settingsGui.Hwnd)
           || (IsObject(editorGui)   && hwnd = editorGui.Hwnd)
    if !isOurs
        return 0
    mx := lParam & 0xFFFF
    my := (lParam >> 16) & 0xFFFF
    if (mx >= 0x8000)
        mx -= 0x10000
    if (my >= 0x8000)
        my -= 0x10000
    WinGetPos(&wx, &wy, &ww, &wh, hwnd)
    bz := 6
    onLeft   := (mx < wx + bz)
    onRight  := (mx >= wx + ww - bz)
    onTop    := (my < wy + bz)
    onBottom := (my >= wy + wh - bz)
    if (onTop && onLeft)
        return 13  ; HTTOPLEFT
    if (onTop && onRight)
        return 14  ; HTTOPRIGHT
    if (onBottom && onLeft)
        return 16  ; HTBOTTOMLEFT
    if (onBottom && onRight)
        return 17  ; HTBOTTOMRIGHT
    if (onLeft)
        return 10  ; HTLEFT
    if (onRight)
        return 11  ; HTRIGHT
    if (onTop)
        return 12  ; HTTOP
    if (onBottom)
        return 15  ; HTBOTTOM
    return 0
}

; ============================================================
; CLOSE HANDLERS — return 1 to prevent default action
; ============================================================
MainWindowClose(*) {
    global wvGui
    StopWindowFocus("main")
    try {
        wvGui.GetPos(,, &w, &h)
        if (w > 0 && h > 0)
            SaveSettingBatch(Map("main_w", w, "main_h", h))
    }
    wvGui.Hide()
    return 1
}

TrayIconMessageHandler(wParam, lParam, msg, hwnd) {
    static WM_LBUTTONUP := 0x202
    if (lParam = WM_LBUTTONUP) {
        A_TrayMenu.Show()
        return 0
    }
}

EditorWindowClose(*) {
    global editorGui
    StopWindowFocus("editor")
    try {
        editorGui.GetPos(,, &w, &h)
        if (w > 0 && h > 0)
            SaveSettingBatch(Map("editor_w", w, "editor_h", h))
    }
    editorGui.Hide()
    ; Ensure recording-state suspensions are always reverted on native close paths.
    ResumeDynamicHotkeys()
    ResumePromptHotkeys()
    return 1
}

; ============================================================
; UTILITIES
; ============================================================

ScheduleWindowFocus(windowKey, guiObj, focusScript := "", durationMs := 1800, intervalMs := 80) {
    global WINDOW_FOCUS_JOBS
    if !IsObject(guiObj)
        return
    WINDOW_FOCUS_JOBS[windowKey] := Map(
        "gui", guiObj,
        "focusScript", focusScript,
        "until", A_TickCount + durationMs,
        "interval", intervalMs
    )
    SetTimer(EnsureWindowFocus.Bind(windowKey), -10)
}

StopWindowFocus(windowKey) {
    global WINDOW_FOCUS_JOBS
    if WINDOW_FOCUS_JOBS.Has(windowKey)
        WINDOW_FOCUS_JOBS.Delete(windowKey)
}

EnsureWindowFocus(windowKey) {
    global WINDOW_FOCUS_JOBS
    if !WINDOW_FOCUS_JOBS.Has(windowKey)
        return

    state := WINDOW_FOCUS_JOBS[windowKey]
    guiObj := state["gui"]
    if !IsObject(guiObj) {
        WINDOW_FOCUS_JOBS.Delete(windowKey)
        return
    }

    hwndSpec := "ahk_id " . guiObj.Hwnd
    if !WinExist(hwndSpec) {
        WINDOW_FOCUS_JOBS.Delete(windowKey)
        return
    }

    try WinActivate(hwndSpec)
    focusScript := state["focusScript"]
    if (focusScript != "")
        try guiObj.ExecuteScriptAsync(focusScript)

    if (A_TickCount < state["until"])
        SetTimer(EnsureWindowFocus.Bind(windowKey), -state["interval"])
    else
        WINDOW_FOCUS_JOBS.Delete(windowKey)
}

; Returns the work area of the monitor containing the active window.
; Falls back to the primary monitor if no active window is found.
GetActiveMonitorWorkArea(&outLeft, &outTop, &outRight, &outBottom) {
    try {
        WinGetPos(&wx, &wy, &ww, &wh, "A")
        cx := wx + ww // 2
        cy := wy + wh // 2
    } catch {
        cx := -99999  ; force fallback
        cy := -99999
    }
    loop MonitorGetCount() {
        MonitorGetWorkArea(A_Index, &ml, &mt, &mr, &mb)
        if (cx >= ml && cx < mr && cy >= mt && cy < mb) {
            outLeft := ml, outTop := mt, outRight := mr, outBottom := mb
            return
        }
    }
    ; Fallback: primary monitor
    MonitorGetWorkArea(MonitorGetPrimary(), &ml, &mt, &mr, &mb)
    outLeft := ml, outTop := mt, outRight := mr, outBottom := mb
}

ShowTip(msg, duration := 2500) {
    ToolTip(msg)
    SetTimer(() => ToolTip(), -duration)
}
