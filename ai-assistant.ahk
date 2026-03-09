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
global NEEDS_SETUP := false

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
    global API_KEYS, API_PROVIDER, NEEDS_SETUP, ENV_FILE

    envPath := ENV_FILE
    envExists := FileExist(envPath)
    envContent := envExists ? FileRead(envPath, "UTF-8") : ""
    savedKeys := LoadApiKeys()
    savedProvider := Trim(ReadSetting("provider"))

    if !envExists && !HasAnyApiKey(savedKeys) {
        FileAppend(BuildEnvTemplate(), envPath, "UTF-8-RAW")
        envExists := true
        envContent := FileRead(envPath, "UTF-8")
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
        NEEDS_SETUP := true
        return false
    }

    EnsureActiveProviderHasKey()
    NEEDS_SETUP := false
    return true
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
promptChatTrayLabel := "Prompt Chat`tAlt+Shift+W"
tray.Add(promptChatTrayLabel, (*) => ShowPromptChat())
tray.Add("Setup", (*) => ShowSetupWizard())
tray.Add("Prompt editor", (*) => ShowPromptEditor())
tray.Add("Settings", (*) => ShowSettings())
tray.Add()
tray.Add("Reload", (*) => Reload())
tray.Add("Exit", (*) => ExitApp())
tray.Default := promptChatTrayLabel

; Tray menu item icons (shell32/imageres DLL icons — indices are 1-based)
shell32 := A_WinDir . "\System32\shell32.dll"
imgres  := A_WinDir . "\System32\imageres.dll"
if FileExist(iconPath)
    try tray.SetIcon(promptChatTrayLabel, iconPath, 1)
try tray.SetIcon("Setup",         shell32, 278)   ; wizard / setup
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
global RESIZABLE_WINDOW_HWNDS := Map()

; Action ID → callback function
HOTKEY_ACTIONS := Map(
    "promptChat",   (*) => ShowPromptChat(true),
    "promptPicker", (*) => ShowPickerWindow(),
    "iterativePromptPicker", (*) => ShowPickerWindow("iterative"),
    "reload",       (*) => Reload()
)

; Human-readable labels for the settings UI
HOTKEY_LABELS := Map(
    "promptChat",   "Prompt Chat",
    "promptPicker", "Prompt Picker",
    "iterativePromptPicker", "Prompt Chat Picker",
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
; SETTINGS WINDOW
; ============================================================
global settingsGui := ""
global settingsReady := false

EnsureBackendForView(viewName) {
    if EnsureBackendServer()
        return true

    MsgBox(
        viewName . " needs the local Bun backend, but it could not be started.`n`n"
        . "Make sure the bundled runtime files are present or that bun.exe is available to the app process.",
        "AI Assistant",
        "Icon!"
    )
    return false
}

ShowSettings() {
    global settingsGui, settingsReady

    if !EnsureBackendForView("Settings")
        return

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
    RegisterResizableWindow(settingsGui)
    settingsGui.OnEvent("Close", SaveSettingsSize)
    if (A_IsCompiled)
        settingsGui.Control.BrowseFolder(A_ScriptDir)

    ; Listen for messages from JS
    settingsGui.Control.wv.add_WebMessageReceived(SettingsMessageHandler)

    settingsGui.Navigate("ui/settings.html")
    ; Restore saved size or use default (min 300x200)
    GetPersistedWindowSize("settings", 300, 200, 450, 400, &w, &h)
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
        PersistWindowSize(settingsGui, "settings")
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

ExtractJsonBool(rawJson, key) {
    pattern := '"' . key . '"\s*:\s*(true|false)'
    if RegExMatch(rawJson, pattern, &m)
        return (m[1] = "true")
    return false
}

AppendDebugLog(message) {
    global DEBUG_LOG_FILE
    try DirCreate(A_ScriptDir . "\data")
    timestamp := FormatTime(, "yyyy-MM-dd HH:mm:ss")
    FileAppend(timestamp . " | " . message . "`n", DEBUG_LOG_FILE, "UTF-8")
}

HandleSettingsAction(action, rawJson) {
    global settingsGui, settingsReady, API_PROVIDER, API_MODEL, API_KEYS, editorGui, editorReady

    switch action {
    case "ready":
        settingsReady := true
        try SyncRuntimeStateFromBackend()
        SendAutostartToSettings()
        ScheduleWindowFocus("settings", settingsGui, "document.getElementById('provider-select').focus()", 800)

    case "modelSelected":
        selectedId := settingsGui.ExecuteScript("currentModelId")
        if (Trim(selectedId) != "") {
            if EnsureBackendServer()
                BackendSaveSelectedModel(selectedId, API_PROVIDER)
            else
                SaveSelectedModel(selectedId, API_PROVIDER)
            settingsGui.ExecuteScriptAsync('setStatus("Model saved for ' . EscJson(ProviderDisplayName(API_PROVIDER)) . ': ' . EscJson(selectedId) . '")')
        }

    case "providerSelected":
        selectedProvider := ExtractJsonString(rawJson, "provider")
        if (selectedProvider != "") {
            if EnsureBackendServer()
                BackendSaveSelectedProvider(selectedProvider)
            else
                SaveSelectedProvider(selectedProvider)
            EnsureActiveProviderHasKey()
            settingsGui.ExecuteScriptAsync('setStatus("Provider saved: ' . EscJson(ProviderDisplayName(API_PROVIDER)) . '")')
        }

    case "saveApiKeys":
        API_KEYS["openrouter"] := Trim(ExtractJsonString(rawJson, "openrouterKey"))
        API_KEYS["openai"] := Trim(ExtractJsonString(rawJson, "openaiKey"))
        API_KEYS["anthropic"] := Trim(ExtractJsonString(rawJson, "anthropicKey"))
        API_KEYS["xai"] := Trim(ExtractJsonString(rawJson, "xaiKey"))

        if EnsureBackendServer()
            BackendSaveApiKeys(API_KEYS)
        else {
            SaveApiKey("openrouter", API_KEYS["openrouter"])
            SaveApiKey("openai", API_KEYS["openai"])
            SaveApiKey("anthropic", API_KEYS["anthropic"])
            SaveApiKey("xai", API_KEYS["xai"])
        }

        EnsureActiveProviderHasKey()

        if HasAnyApiKey(API_KEYS)
            settingsGui.ExecuteScriptAsync('setStatus("API keys saved")')
        else
            settingsGui.ExecuteScriptAsync('setStatus("Saved, but no API keys configured")')

    case "reloadHotkeys":
        try {
            RegisterHotkeys()
            settingsGui.ExecuteScriptAsync('setStatus("Hotkeys reloaded")')
        } catch as e {
            settingsGui.ExecuteScriptAsync('setStatus("Error: ' . EscJson(e.Message) . '")')
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
        settingsGui.ExecuteScriptAsync('setStatus("Model refresh is handled by the backend UI")')

    case "minimize":
        StopWindowFocus("settings")
        settingsGui.Minimize()

    case "close":
        StopWindowFocus("settings")
        try {
            PersistWindowSize(settingsGui, "settings")
        }
        settingsGui.Hide()
        ResumeDynamicHotkeys()
    }
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

EnsureConfiguredForUse(featureName := "This feature") {
    global NEEDS_SETUP
    if !NEEDS_SETUP
        return true

    ShowSetupWizard()
    ShowTip(featureName . " needs initial setup first", 2500)
    return false
}

; ============================================================
; SETUP WINDOW
; ============================================================
global setupGui := ""
global setupReady := false

ShowSetupWizard() {
    global setupGui, setupReady

    if !EnsureBackendForView("Setup")
        return

    if IsObject(setupGui) {
        GetActiveMonitorWorkArea(&ml, &mt, &mr, &mb)
        WinGetPos(,, &curW, &curH, setupGui.Hwnd)
        x := ml + (mr - ml - curW) // 2
        y := mt + (mb - mt - curH) // 3
        setupGui.Show("x" . x . " y" . y)
        ScheduleWindowFocus("setup", setupGui, setupReady ? "focusPrimaryField()" : "", 1200)
        return
    }

    dllPath := A_ScriptDir "\lib\" (A_PtrSize * 8) "bit\WebView2Loader.dll"
    setupGui := WebViewGui("+AlwaysOnTop +Resize +MinSize420x360 -Caption", "Setup",, {DllPath: dllPath})
    RegisterResizableWindow(setupGui)
    setupGui.OnEvent("Close", SetupWindowClose)
    if (A_IsCompiled)
        setupGui.Control.BrowseFolder(A_ScriptDir)
    setupGui.Control.wv.add_WebMessageReceived(SetupMessageHandler)
    setupGui.Navigate("ui/setup.html")
    GetPersistedWindowSize("setup", 420, 360, 560, 520, &w, &h)
    GetActiveMonitorWorkArea(&ml, &mt, &mr, &mb)
    x := ml + (mr - ml - w) // 2
    y := mt + (mb - mt - h) // 3
    setupGui.Show("x" . x . " y" . y . " w" . w . " h" . h)
    ScheduleWindowFocus("setup", setupGui, setupReady ? "focusPrimaryField()" : "", 1200)
}

SetupWindowClose(*) {
    global setupGui
    StopWindowFocus("setup")
    try {
        PersistWindowSize(setupGui, "setup")
        setupGui.Hide()
    }
    return 1
}

SetupMessageHandler(wv, msg) {
    try data := msg.WebMessageAsJson
    catch
        return

    if !RegExMatch(data, '"action"\s*:\s*"(\w+)"', &m)
        return

    SetTimer(HandleSetupAction.Bind(m[1], data), -1)
}

HandleSetupAction(action, rawJson := "") {
    global setupGui, setupReady, NEEDS_SETUP

    switch action {
    case "ready":
        setupReady := true
        ScheduleWindowFocus("setup", setupGui, "focusPrimaryField()", 1000)

    case "complete":
        NEEDS_SETUP := false
        try SyncRuntimeStateFromBackend()
        StopWindowFocus("setup")
        PersistWindowSize(setupGui, "setup")
        setupGui.Hide()

    case "openSettings":
        ShowSettings()

    case "close":
        StopWindowFocus("setup")
        PersistWindowSize(setupGui, "setup")
        setupGui.Hide()
    }
}

; ============================================================
; PROMPT PICKER WINDOW
; ============================================================
global pickerGui := ""
global pickerReady := false
global pickerPrevWin := 0
global pickerMode := "silent"
global pickerFocusConfirmed := false

InitPickerWindow() {
    global pickerGui
    dllPath := A_ScriptDir "\lib\" (A_PtrSize * 8) "bit\WebView2Loader.dll"
    pickerGui := WebViewGui("+AlwaysOnTop +Resize +MinSize320x220 -Caption", "Prompt Picker",, {DllPath: dllPath})
    RegisterResizableWindow(pickerGui)
    pickerGui.OnEvent("Close", PickerWindowClose)
    if (A_IsCompiled)
        pickerGui.Control.BrowseFolder(A_ScriptDir)
    pickerGui.Control.wv.add_WebMessageReceived(PickerMessageHandler)
    pickerGui.Navigate("ui/picker.html")
}

ShowPickerWindow(mode := "silent") {
    global pickerGui, pickerReady, pickerPrevWin, pickerMode, pickerFocusConfirmed

    if !EnsureConfiguredForUse("Prompt Picker")
        return

    if !EnsureBackendForView("Prompt Picker")
        return

    if !IsObject(pickerGui)
        InitPickerWindow()

    pickerMode := mode
    pickerFocusConfirmed := false

    ; Remember where focus was so we can restore it on close/pick
    pickerPrevWin := WinExist("A")
    SendCommandsToPickerUI()

    ; Center on active monitor, slightly above middle
    GetActiveMonitorWorkArea(&ml, &mt, &mr, &mb)
    GetPersistedWindowSize("picker", 320, 220, 420, 320, &w, &h)
    x := ml + (mr - ml - w) // 2
    y := mt + (mb - mt - h) // 3
    pickerGui.Show("x" . x . " y" . y . " w" . w . " h" . h)
    ForcePickerFocus("show")
    if pickerReady
        pickerGui.ExecuteScriptAsync("resetAndFocus()")
    ScheduleWindowFocus("picker", pickerGui, pickerReady ? "ensureInputFocus()" : "", 1800)
    SetTimer(ForcePickerFocus.Bind("retry-1"), -80)
    SetTimer(ForcePickerFocus.Bind("retry-2"), -180)
    SetTimer(ForcePickerFocus.Bind("retry-3"), -320)
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
    global pickerGui, pickerReady, pickerPrevWin, pickerMode, pickerFocusConfirmed

    switch action {
    case "ready":
        pickerReady := true
        SendCommandsToPickerUI()
        AppendDebugLog("picker ready")
        try {
            if WinExist("ahk_id " . pickerGui.Hwnd)
                pickerGui.ExecuteScriptAsync("resetAndFocus()")
        }
        ForcePickerFocus("ready")
        ScheduleWindowFocus("picker", pickerGui, "ensureInputFocus()", 1000)

    case "focusReport":
        source := ExtractJsonString(rawJson, "source")
        activeTag := ExtractJsonString(rawJson, "activeTag")
        hasWindowFocus := ExtractJsonBool(rawJson, "hasWindowFocus")
        inputFocused := ExtractJsonBool(rawJson, "inputFocused")
        AppendDebugLog("picker focus-report source=" . source . " window=" . hasWindowFocus . " input=" . inputFocused . " active=" . activeTag)
        if (hasWindowFocus && inputFocused) {
            pickerFocusConfirmed := true
            StopWindowFocus("picker")
        }

    case "pick":
        promptName := ""
        if RegExMatch(rawJson, '"name"\s*:\s*"((?:[^"\\]|\\.)*)"', &mName)
            promptName := StrReplace(mName[1], '\"', '"')
        StopWindowFocus("picker")
        PersistWindowSize(pickerGui, "picker")
        pickerGui.Hide()
        TryActivateWindow(pickerPrevWin, "picker-pick-restore")
        if (promptName != "") {
            if (pickerMode = "iterative")
                SetTimer(OpenIterativePromptFlow.Bind(promptName), -100)
            else
                SetTimer(ExecutePromptSilently.Bind(promptName), -100)
        }
        pickerMode := "silent"

    case "close":
        StopWindowFocus("picker")
        PersistWindowSize(pickerGui, "picker")
        pickerGui.Hide()
        TryActivateWindow(pickerPrevWin, "picker-close-restore")
        pickerMode := "silent"
    }
}

PickerWindowClose(*) {
    global pickerGui
    StopWindowFocus("picker")
    PersistWindowSize(pickerGui, "picker")
    pickerGui.Hide()
    return 1
}

SendCommandsToPickerUI() {
    global pickerGui, pickerReady
    if !IsObject(pickerGui) || !pickerReady
        return
    pickerGui.ExecuteScriptAsync("setPromptCatalog(" . BuildPickerCatalogJson() . ")")
}

BuildPickerCatalogJson() {
    global ALL_COMMAND_NAMES, COMMAND_HOTKEYS, COMMAND_MODELS
    json := "["
    for i, name in ALL_COMMAND_NAMES {
        if (i > 1)
            json .= ","
        hotkeyVal := COMMAND_HOTKEYS.Has(name) ? EscJson(COMMAND_HOTKEYS[name]) : ""
        modelId := COMMAND_MODELS.Has(name) ? EscJson(COMMAND_MODELS[name]) : ""
        json .= '{"name":"' . EscJson(name) . '","hotkey":"' . hotkeyVal . '","model":"' . modelId . '"}'
    }
    json .= "]"
    return json
}

ForcePickerFocus(source := "manual") {
    global pickerGui, pickerReady, pickerFocusConfirmed
    if !IsObject(pickerGui)
        return
    if (pickerFocusConfirmed && source != "show" && source != "ready")
        return

    hwndSpec := "ahk_id " . pickerGui.Hwnd
    if !WinExist(hwndSpec)
        return

    try WinActivate(hwndSpec)
    try pickerGui.Control.MoveFocus(0)
    if pickerReady
        try pickerGui.ExecuteScriptAsync("ensureInputFocus(); reportFocusState(" . '"' . EscJson(source) . '"' . ")")
    AppendDebugLog("picker force-focus source=" . source . " activeWindow=" . (WinActive(hwndSpec) ? "true" : "false"))
}

TryActivateWindow(hwnd, source := "") {
    if !hwnd
        return false

    hwndSpec := "ahk_id " . hwnd
    if !WinExist(hwndSpec) {
        if (source != "")
            AppendDebugLog("activate-skip source=" . source . " hwnd=" . hwnd . " exists=false")
        return false
    }

    try {
        WinActivate(hwndSpec)
        if (source != "")
            AppendDebugLog("activate-ok source=" . source . " hwnd=" . hwnd)
        return true
    } catch {
        if (source != "")
            AppendDebugLog("activate-failed source=" . source . " hwnd=" . hwnd)
        return false
    }
}

; ============================================================
; ITERATIVE WORKSPACE WINDOW
; ============================================================
global iterativeGui := ""
global iterativeReady := false
global iterativeTargetWin := 0
global iterativeSessionJson := ""
global iterativePendingSession := false

ShowPromptChat(captureInput := false) {
    global iterativeSessionJson

    if !EnsureConfiguredForUse("Prompt Chat")
        return

    if captureInput {
        targetWin := WinExist("A")
        inputText := CaptureActiveSelectionText(false)
        ResetPromptChatSession(inputText, targetWin)
    } else if (iterativeSessionJson = "") {
        ResetPromptChatSession()
    }
    ShowIterativeWindow()
}

ResetPromptChatSession(originalText := "", targetWin := 0) {
    global iterativeTargetWin, iterativeSessionJson, iterativePendingSession
    iterativeTargetWin := targetWin
    iterativeSessionJson := BuildBlankPromptChatSessionJson(originalText)
    iterativePendingSession := true
}

CaptureActiveSelectionText(fallbackToClipboard := true) {
    savedClip := ClipboardAll()
    savedText := A_Clipboard
    A_Clipboard := ""

    Send("^c")
    hasSelection := ClipWait(0.25)
    if (hasSelection && Trim(A_Clipboard) != "")
        inputText := A_Clipboard
    else if fallbackToClipboard
        inputText := savedText
    else
        inputText := ""

    A_Clipboard := savedClip
    return inputText
}

OpenIterativePromptFlow(promptName, *) {
    global COMMAND_PROMPTS, COMMAND_MODELS, COMMAND_PROVIDERS, API_PROVIDER, API_MODEL
    global iterativeTargetWin, iterativeSessionJson, iterativePendingSession

    if !COMMAND_PROMPTS.Has(promptName) {
        ShowTip("Prompt not found: " . promptName, 3000)
        return
    }

    ShowTip(promptName . " - preparando Prompt Chat...", 12000)

    targetWin := WinExist("A")
    savedClip := ClipboardAll()
    savedText := A_Clipboard
    A_Clipboard := ""

    Send("^c")
    hasSelection := ClipWait(0.25)
    if (hasSelection && Trim(A_Clipboard) != "")
        inputText := A_Clipboard
    else
        inputText := savedText

    A_Clipboard := savedClip

    if (Trim(inputText) = "") {
        ShowTip("No text to process", 2500)
        return
    }

    promptText := COMMAND_PROMPTS[promptName]
    providerOverride := COMMAND_PROVIDERS.Has(promptName) ? COMMAND_PROVIDERS[promptName] : ""
    provider := (Trim(providerOverride) != "") ? NormalizeProvider(providerOverride) : API_PROVIDER
    useModel := COMMAND_MODELS.Has(promptName) ? COMMAND_MODELS[promptName]
        : (provider = API_PROVIDER ? API_MODEL : LoadSelectedModel(provider))
    apiKey := GetProviderApiKey(provider)
    if (apiKey = "") {
        ShowTip("Missing API key for " . ProviderDisplayName(provider), 4000)
        return
    }

    runLabel := ProviderDisplayName(provider) . " · " . useModel
    ShowTip(promptName . " - modelo procesando (" . runLabel . ")...", 30000)

    try {
        lang := DetectLanguage(inputText)
        sysPrompt := GetSystemPrompt("fix", lang)
            . "`n`nThe user will give you a prompt/instruction followed by the text to work with (separated by ---). Follow the prompt instructions. Return ONLY the result, no explanations."
        userMessage := promptText . "`n`n---`n`n" . inputText
        result := CallProvider(userMessage, sysPrompt, provider, apiKey, useModel)

        iterativeTargetWin := targetWin
        iterativeSessionJson := BuildIterativeSessionJson(promptName, inputText, promptText, result, provider, useModel)
        iterativePendingSession := true
        ShowIterativeWindow()
        ShowTip("Prompt Chat listo (" . runLabel . ")", 2000)
    } catch as e {
        ShowTip("Error: " . e.Message, 4000)
    }
}

InitIterativeWindow() {
    global iterativeGui

    dllPath := A_ScriptDir "\lib\" (A_PtrSize * 8) "bit\WebView2Loader.dll"
    iterativeGui := WebViewGui("+AlwaysOnTop +Resize +MinSize760x520 -Caption", "Prompt Chat",, {DllPath: dllPath})
    RegisterResizableWindow(iterativeGui)
    iterativeGui.OnEvent("Close", IterativeWindowClose)
    if (A_IsCompiled)
        iterativeGui.Control.BrowseFolder(A_ScriptDir)
    iterativeGui.Control.wv.add_WebMessageReceived(IterativeMessageHandler)
    iterativeGui.Navigate("ui/iterative.html")
}

ShowIterativeWindow() {
    global iterativeGui, iterativeReady, iterativePendingSession

    if !EnsureBackendForView("Prompt Chat")
        return

    if !IsObject(iterativeGui)
        InitIterativeWindow()

    GetActiveMonitorWorkArea(&ml, &mt, &mr, &mb)
    GetPersistedWindowSize("iterative", 760, 520, 1040, 760, &w, &h)
    x := ml + (mr - ml - w) // 2
    y := mt + (mb - mt - h) // 3
    iterativeGui.Show("x" . x . " y" . y . " w" . w . " h" . h)
    if (iterativeReady && iterativePendingSession)
        SendIterativeStateToUI()
    ScheduleWindowFocus("iterative", iterativeGui, iterativeReady ? "focusComposer()" : "", 1600)
}

IterativeWindowClose(*) {
    global iterativeGui
    StopWindowFocus("iterative")
    PersistWindowSize(iterativeGui, "iterative")
    iterativeGui.Hide()
    return 1
}

IterativeMessageHandler(wv, msg) {
    try data := msg.WebMessageAsJson
    catch
        return
    if !RegExMatch(data, '"action"\s*:\s*"(\w+)"', &m)
        return
    SetTimer(HandleIterativeAction.Bind(m[1], data), -1)
}

HandleIterativeAction(action, rawJson := "") {
    global iterativeGui, iterativeReady, iterativeTargetWin
    global COMMAND_PROMPTS, COMMAND_MODELS, COMMAND_PROVIDERS, API_PROVIDER, API_MODEL

    switch action {
    case "ready":
        iterativeReady := true
        SendIterativeStateToUI()
        ScheduleWindowFocus("iterative", iterativeGui, "focusComposer()", 1000)

    case "send":
        latestMessage := iterativeGui.ExecuteScript("window.__promptChatPendingMessage || ''")
        transcript := iterativeGui.ExecuteScript("window.__promptChatPendingTranscript || ''")
        provider := NormalizeProvider(iterativeGui.ExecuteScript("window.__promptChatPendingProvider || ''"))
        if (Trim(provider) = "")
            provider := API_PROVIDER
        model := iterativeGui.ExecuteScript("window.__promptChatPendingModel || ''")

        if (Trim(latestMessage) = "") {
            iterativeGui.ExecuteScriptAsync('setStatus("Message cannot be empty")')
            return
        }
        if (Trim(transcript) = "") {
            iterativeGui.ExecuteScriptAsync('setStatus("Conversation payload is empty")')
            return
        }

        apiKey := GetProviderApiKey(provider)
        if (apiKey = "") {
            iterativeGui.ExecuteScriptAsync('setStatus("Missing API key for ' . EscJson(ProviderDisplayName(provider)) . '")')
            return
        }
        if (Trim(model) = "")
            model := (provider = API_PROVIDER ? API_MODEL : LoadSelectedModel(provider))

        iterativeGui.ExecuteScriptAsync('setStatus("Processing with ' . EscJson(ProviderDisplayName(provider) . " · " . model) . '...")')
        try {
            lang := DetectLanguage(transcript)
            sysPrompt := GetSystemPrompt("fix", lang)
                . "`n`nYou are continuing a chat conversation."
                . "`nThe user message contains structured context with labels like ORIGINAL TEXT, CONVERSATION, User, and Assistant."
                . "`nThose labels are metadata for you, not text to rewrite or repeat."
                . "`nAnswer only the latest user turn."
                . "`nDo not quote, summarize, or reproduce the full transcript unless the user explicitly asks for that."
                . "`nDo not include labels like ORIGINAL TEXT, CONVERSATION, User, or Assistant in your reply."
                . "`nReturn only the assistant reply text."
            userMessage := "Use the transcript below only as conversation context.`n`n"
                . "Reply to the latest user message only.`n`n"
                . "=== TRANSCRIPT START ===`n"
                . transcript
                . "`n=== TRANSCRIPT END ==="
            result := CallProvider(userMessage, sysPrompt, provider, apiKey, model)
            iterativeGui.ExecuteScriptAsync("onAssistantReply(" . BuildIterativeAssistantReplyJson(result, provider, model) . ")")
            iterativeGui.ExecuteScriptAsync("clearPendingSendPayload()")
        } catch as e {
            iterativeGui.ExecuteScriptAsync('setStatus("Error: ' . EscJson(e.Message) . '")')
        }

    case "copyOutput":
        outText := ExtractJsonString(rawJson, "text")
        A_Clipboard := outText
        iterativeGui.ExecuteScriptAsync('setStatus("Output copied to clipboard")')

    case "replaceSelection":
        outText := ExtractJsonString(rawJson, "text")
        if (Trim(outText) = "") {
            iterativeGui.ExecuteScriptAsync('setStatus("Nothing to replace")')
            return
        }
        if !iterativeTargetWin {
            A_Clipboard := outText
            iterativeGui.ExecuteScriptAsync('setStatus("No target window found — output copied to clipboard")')
            return
        }

        savedClip := ClipboardAll()
        try {
            A_Clipboard := outText
            ClipWait(0.4)
            WinActivate("ahk_id " . iterativeTargetWin)
            Sleep(80)
            Send("^v")
            SetTimer((*) => (A_Clipboard := savedClip), -300)
            iterativeGui.ExecuteScriptAsync('setStatus("Replaced selection in target window")')
        } catch {
            A_Clipboard := savedClip
            iterativeGui.ExecuteScriptAsync('setStatus("Could not replace in target window — clipboard restored")')
        }

    case "minimize":
        StopWindowFocus("iterative")
        iterativeGui.Minimize()

    case "close":
        StopWindowFocus("iterative")
        PersistWindowSize(iterativeGui, "iterative")
        iterativeGui.Hide()
    }
}

SendIterativeStateToUI() {
    global iterativeGui, iterativeReady, iterativeSessionJson, iterativePendingSession
    if !IsObject(iterativeGui) || !iterativeReady
        return
    iterativeGui.ExecuteScriptAsync("setPromptCatalog(" . BuildPromptCatalogJson() . ")")
    iterativeGui.ExecuteScriptAsync("setConversationData(" . (iterativeSessionJson != "" ? iterativeSessionJson : "{}") . ")")
    iterativePendingSession := false
}

SendCommandsToIterativeUI() {
    global iterativeGui, iterativeReady
    if !IsObject(iterativeGui) || !iterativeReady
        return
    iterativeGui.ExecuteScriptAsync("setPromptCatalog(" . BuildPromptCatalogJson() . ")")
}

BuildPromptCatalogJson() {
    global ALL_COMMAND_NAMES, COMMAND_PROMPTS, COMMAND_PROVIDERS, COMMAND_MODELS
    json := "["
    for i, name in ALL_COMMAND_NAMES {
        if (i > 1)
            json .= ","
        promptBody := COMMAND_PROMPTS.Has(name) ? EscJson(COMMAND_PROMPTS[name]) : ""
        providerId := COMMAND_PROVIDERS.Has(name) ? EscJson(COMMAND_PROVIDERS[name]) : ""
        modelId := COMMAND_MODELS.Has(name) ? EscJson(COMMAND_MODELS[name]) : ""
        json .= '{"name":"' . EscJson(name) . '","prompt":"' . promptBody . '","provider":"' . providerId . '","model":"' . modelId . '"}'
    }
    json .= "]"
    return json
}

BuildIterativeAssistantReplyJson(outputText, provider, model) {
    return '{'
        . '"content":"' . EscJson(outputText) . '",'
        . '"provider":"' . EscJson(provider) . '",'
        . '"providerLabel":"' . EscJson(ProviderDisplayName(provider)) . '",'
        . '"model":"' . EscJson(model) . '"'
        . '}'
}

BuildIterativeSessionJson(commandName, originalText, promptText, outputText, provider, model) {
    userEntry := '{'
        . '"role":"user",'
        . '"content":"' . EscJson(promptText) . '",'
        . '"label":"' . EscJson(commandName) . '"'
        . '}'
    assistantEntry := '{'
        . '"role":"assistant",'
        . '"content":"' . EscJson(outputText) . '",'
        . '"providerLabel":"' . EscJson(ProviderDisplayName(provider)) . '",'
        . '"model":"' . EscJson(model) . '"'
        . '}'
    return '{'
        . '"original":"' . EscJson(originalText) . '",'
        . '"provider":"' . EscJson(provider) . '",'
        . '"providerLabel":"' . EscJson(ProviderDisplayName(provider)) . '",'
        . '"model":"' . EscJson(model) . '",'
        . '"messages":[' . userEntry . ',' . assistantEntry . ']'
        . '}'
}

BuildBlankPromptChatSessionJson(originalText := "") {
    global API_PROVIDER, API_MODEL
    return '{'
        . '"original":"' . EscJson(originalText) . '",'
        . '"provider":"' . EscJson(API_PROVIDER) . '",'
        . '"providerLabel":"' . EscJson(ProviderDisplayName(API_PROVIDER)) . '",'
        . '"model":"' . EscJson(API_MODEL) . '",'
        . '"messages":[]'
        . '}'
}

; ============================================================
; PROMPT EDITOR WINDOW
; ============================================================
global editorGui := ""
global editorReady := false

ShowPromptEditor() {
    global editorGui, editorReady

    if !EnsureBackendForView("Prompt Editor")
        return

    if IsObject(editorGui) {
        GetActiveMonitorWorkArea(&ml, &mt, &mr, &mb)
        WinGetPos(,, &curW, &curH, editorGui.Hwnd)
        x := ml + (mr - ml - curW) // 2
        y := mt + (mb - mt - curH) // 3
        editorGui.Show("x" . x . " y" . y)
        ScheduleWindowFocus("editor", editorGui, editorReady ? "document.getElementById('prompt-filter').focus()" : "", 1200)
        return
    }

    dllPath := A_ScriptDir "\lib\" (A_PtrSize * 8) "bit\WebView2Loader.dll"
    editorGui := WebViewGui("+AlwaysOnTop +Resize +MinSize500x400 -Caption", "Prompt Editor",, {DllPath: dllPath})
    RegisterResizableWindow(editorGui)
    editorGui.OnEvent("Close", EditorWindowClose)
    if (A_IsCompiled)
        editorGui.Control.BrowseFolder(A_ScriptDir)
    editorGui.Control.wv.add_WebMessageReceived(EditorMessageHandler)
    editorGui.Navigate("ui/prompt-editor.html")
    GetActiveMonitorWorkArea(&ml, &mt, &mr, &mb)
    GetPersistedWindowSize("editor", 500, 400, 600, 550, &w, &h)
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
    global editorGui, editorReady, COMMAND_PROMPTS, COMMAND_MODELS, COMMAND_PROVIDERS, COMMAND_HOTKEYS, COMMAND_CONFIRMS, ALL_COMMAND_NAMES, API_PROVIDER

    switch action {
    case "ready":
        editorReady := true
        ; Defensive restore in case recording mode previously suspended hotkeys.
        ResumeDynamicHotkeys()
        ResumePromptHotkeys()
        ScheduleWindowFocus("editor", editorGui, "document.getElementById('prompt-filter').focus()", 800)

    case "startRecording":
        SuspendDynamicHotkeys()
        SuspendPromptHotkeys()

    case "stopRecording":
        ResumeDynamicHotkeys()
        ResumePromptHotkeys()

    case "promptsChanged":
        LoadPrompts()
        SendCommandsToIterativeUI()
        ResumeDynamicHotkeys()
        ResumePromptHotkeys()

    case "minimize":
        StopWindowFocus("editor")
        editorGui.Minimize()
        ResumeDynamicHotkeys()
        ResumePromptHotkeys()

    case "close":
        StopWindowFocus("editor")
        PersistWindowSize(editorGui, "editor")
        editorGui.Hide()
        ResumeDynamicHotkeys()
        ResumePromptHotkeys()
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

EnsurePromptDirectoryStorage() {
    global PROMPTS_LEGACY_FILE, PROMPTS_DIR

    if !FileExist(PROMPTS_LEGACY_FILE)
        return

    if !DirExist(PROMPTS_DIR)
        DirCreate(PROMPTS_DIR)

    legacyPrompts := Map()
    legacyProviders := Map()
    legacyModels := Map()
    legacyHotkeys := Map()
    legacyConfirms := Map()
    legacyNames := []
    LoadLegacyPromptsJson(PROMPTS_LEGACY_FILE, &legacyPrompts, &legacyProviders, &legacyModels, &legacyHotkeys, &legacyConfirms, &legacyNames)

    preferredPaths := Map(
        "Como yo (español)", PROMPTS_DIR . "\como-yo.md",
        "Like me (English)", PROMPTS_DIR . "\like-me.md"
    )
    usedPaths := Map()

    for _, name in legacyNames {
        path := preferredPaths.Has(name) ? preferredPaths[name] : GetUniquePromptFilePath(name, usedPaths)
        WritePromptFile(
            path,
            name,
            legacyPrompts[name],
            legacyProviders.Has(name) ? legacyProviders[name] : "",
            legacyModels.Has(name) ? legacyModels[name] : "",
            legacyHotkeys.Has(name) ? legacyHotkeys[name] : "",
            legacyConfirms.Has(name) && legacyConfirms[name]
        )
        usedPaths[path] := true
    }

    try FileDelete(PROMPTS_LEGACY_FILE)
}

LoadLegacyPromptsJson(jsonPath, &outPrompts, &outProviders, &outModels, &outHotkeys, &outConfirms, &outNames) {
    outPrompts := Map()
    outProviders := Map()
    outModels := Map()
    outHotkeys := Map()
    outConfirms := Map()
    outNames := []

    if !FileExist(jsonPath)
        return

    content := FileRead(jsonPath, "UTF-8")
    pos := 1
    while (pos := RegExMatch(content, '"((?:[^"\\]|\\.)*?)"\s*:\s*"((?:[^"\\]|\\.)*?)"', &m, pos)) {
        key := StrReplace(m[1], '\"', '"')
        val := StrReplace(m[2], '\"', '"')
        val := StrReplace(val, "\\n", "`n")
        val := StrReplace(val, "\\\\", "\")

        ExtractPromptDirectives(val, &providerId, &modelId, &bodyVal)
        if (providerId != "")
            outProviders[key] := providerId
        if (modelId != "")
            outModels[key] := modelId

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
            if (SubStr(lower, 1, 8) = "@hotkey:") {
                outHotkeys[key] := Trim(SubStr(line, 9))
                bodyVal := rest
                continue
            }
            if (SubStr(lower, 1, 9) = "@confirm:") {
                if ParseDirectiveBool(SubStr(line, 10))
                    outConfirms[key] := true
                bodyVal := rest
                continue
            }
            break
        }

        outPrompts[key] := bodyVal
        outNames.Push(key)
        pos += m.Len
    }
}

ParsePromptFile(filePath, &nameOut, &bodyOut, &providerOut, &modelOut, &hotkeyOut, &confirmOut) {
    content := FileRead(filePath, "UTF-8")
    lines := StrSplit(content, "`n", "`r")
    nameOut := ""
    bodyOut := ""
    providerOut := ""
    modelOut := ""
    hotkeyOut := ""
    confirmOut := false
    bodyStarted := false

    for _, rawLine in lines {
        line := bodyStarted ? rawLine : Trim(rawLine)
        lower := StrLower(line)
        if !bodyStarted && (SubStr(lower, 1, 6) = "@name:") {
            nameOut := Trim(SubStr(line, 7))
            continue
        }
        if !bodyStarted && (SubStr(lower, 1, 10) = "@provider:") {
            providerOut := NormalizeProvider(Trim(SubStr(line, 11)))
            continue
        }
        if !bodyStarted && (SubStr(lower, 1, 7) = "@model:") {
            modelOut := Trim(SubStr(line, 8))
            continue
        }
        if !bodyStarted && (SubStr(lower, 1, 8) = "@hotkey:") {
            hotkeyOut := Trim(SubStr(line, 9))
            continue
        }
        if !bodyStarted && (SubStr(lower, 1, 9) = "@confirm:") {
            confirmOut := ParseDirectiveBool(SubStr(line, 10))
            continue
        }
        if !bodyStarted && Trim(line) = "" {
            bodyStarted := true
            continue
        }
        bodyStarted := true
        bodyOut .= (bodyOut = "" ? "" : "`n") . rawLine
    }

    if (Trim(nameOut) = "")
        return
}

WritePromptFile(filePath, promptName, promptBody, providerId := "", modelId := "", hotkeyVal := "", confirmVal := false) {
    content := "@name:" . promptName . "`n"
    if (Trim(providerId) != "")
        content .= "@provider:" . providerId . "`n"
    if (Trim(modelId) != "")
        content .= "@model:" . modelId . "`n"
    if (Trim(hotkeyVal) != "")
        content .= "@hotkey:" . hotkeyVal . "`n"
    if confirmVal
        content .= "@confirm:true`n"
    content .= "`n" . promptBody

    try FileDelete(filePath)
    FileAppend(content, filePath, "UTF-8")
}

GetUniquePromptFilePath(promptName, usedPaths) {
    global PROMPTS_DIR
    baseName := SanitizePromptFileName(promptName)
    if (baseName = "")
        baseName := "prompt"
    candidate := PROMPTS_DIR . "\" . baseName . ".md"
    idx := 2
    while (usedPaths.Has(candidate) || FileExist(candidate)) {
        candidate := PROMPTS_DIR . "\" . baseName . "-" . idx . ".md"
        idx += 1
    }
    return candidate
}

SanitizePromptFileName(promptName) {
    fileName := Trim(promptName)
    fileName := RegExReplace(fileName, '[<>:"/\\|?*\x00-\x1F]', "-")
    fileName := RegExReplace(fileName, "\s+", "-")
    fileName := RegExReplace(fileName, "-{2,}", "-")
    fileName := Trim(fileName, "-. ")
    return fileName
}

GetPromptsStorageFingerprint() {
    global PROMPTS_DIR
    if !DirExist(PROMPTS_DIR)
        return ""
    dirStamp := FileGetTime(PROMPTS_DIR, "M")
    fileCount := 0
    totalSize := 0
    Loop Files, PROMPTS_DIR . "\*.md", "F" {
        fileCount += 1
        totalSize += A_LoopFileSize
    }
    return dirStamp . "|" . fileCount . "|" . totalSize
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
    GetPersistedWindowSize("confirm", 520, 320, 760, 560, &w, &h)
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
    RegisterResizableWindow(promptConfirmGui)
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
    if IsObject(promptConfirmGui) {
        PersistWindowSize(promptConfirmGui, "confirm")
        promptConfirmGui.Hide()
    }
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
        PersistWindowSize(promptConfirmGui, "confirm")

    case "cancel":
        promptConfirmCancelled := true
        promptConfirmDone := true
        StopWindowFocus("promptConfirm")
        PersistWindowSize(promptConfirmGui, "confirm")

    case "minimize":
        if IsObject(promptConfirmGui)
            promptConfirmGui.Minimize()

    case "close":
        promptConfirmCancelled := true
        promptConfirmDone := true
        StopWindowFocus("promptConfirm")
        PersistWindowSize(promptConfirmGui, "confirm")
    }
}

; ============================================================
; PROMPTS: loaded from prompt files under prompts/, auto-reloaded on change
; ============================================================
global COMMAND_PROMPTS := Map()
global COMMAND_PROVIDERS := Map()
global COMMAND_MODELS := Map()
global COMMAND_HOTKEYS := Map()
global COMMAND_CONFIRMS := Map()
global PROMPT_HOTKEY_MAP := Map()
global PROMPT_FILE_PATHS := Map()
global ALL_COMMAND_NAMES := []
global PROMPTS_LAST_MOD := ""
ChordSetTimeout(0.9)

LoadPrompts() {
    global COMMAND_PROMPTS, COMMAND_PROVIDERS, COMMAND_MODELS, COMMAND_HOTKEYS, COMMAND_CONFIRMS
    global ALL_COMMAND_NAMES, PROMPTS_DIR, PROMPTS_LEGACY_FILE, PROMPTS_LAST_MOD, PROMPT_FILE_PATHS

    EnsurePromptDirectoryStorage()

    if !DirExist(PROMPTS_DIR) {
        ShowTip("prompts folder not found!", 5000)
        return
    }

    newPrompts := Map()
    newProviders := Map()
    newModels := Map()
    newHotkeys := Map()
    newConfirms := Map()
    newPaths := Map()
    newNames := []

    Loop Files, PROMPTS_DIR . "\*.md", "F" {
        filePath := A_LoopFileFullPath
        promptName := ""
        promptBody := ""
        providerId := ""
        modelId := ""
        hotkeyVal := ""
        confirmVal := false
        ParsePromptFile(filePath, &promptName, &promptBody, &providerId, &modelId, &hotkeyVal, &confirmVal)
        if (Trim(promptName) = "")
            continue

        newPrompts[promptName] := promptBody
        if (providerId != "")
            newProviders[promptName] := providerId
        if (modelId != "")
            newModels[promptName] := modelId
        if (hotkeyVal != "")
            newHotkeys[promptName] := hotkeyVal
        if confirmVal
            newConfirms[promptName] := true
        newPaths[promptName] := filePath
        newNames.Push(promptName)
    }

    if (newNames.Length = 0) {
        ShowTip("prompts folder has no valid prompt files", 5000)
        return
    }

    COMMAND_PROMPTS := newPrompts
    COMMAND_PROVIDERS := newProviders
    COMMAND_MODELS := newModels
    COMMAND_HOTKEYS := newHotkeys
    COMMAND_CONFIRMS := newConfirms
    ALL_COMMAND_NAMES := newNames
    PROMPT_FILE_PATHS := newPaths
    PROMPTS_LAST_MOD := GetPromptsStorageFingerprint()
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

    if !EnsureConfiguredForUse(promptName)
        return

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
    global PROMPTS_LAST_MOD
    currentMod := GetPromptsStorageFingerprint()
    if (currentMod = "")
        return
    if (currentMod != PROMPTS_LAST_MOD) {
        LoadPrompts()
        SendCommandsToIterativeUI()
        SendCommandsToPickerUI()
        ShowTip("Prompts reloaded (" . ALL_COMMAND_NAMES.Length . " commands)", 2000)
    }
}

; Load prompts at startup
LoadPrompts()

; Check for changes every 5 seconds
SetTimer(CheckPromptsReload, 5000)

WarmStartupResources() {
    EnsureBackendServer()
}

ShowSetupOnStartup() {
    global NEEDS_SETUP
    if NEEDS_SETUP
        ShowSetupWizard()
}

; Startup beep (audible feedback on reload)
SoundBeep(800, 100)

; Pre-load WebViews in background (deferred so they don't block startup)
SetTimer(WarmStartupResources, -200)
SetTimer(InitIterativeWindow, -500)
SetTimer(InitPickerWindow, -800)
SetTimer(InitPromptConfirmWindow, -1100)
SetTimer(ShowSetupOnStartup, -1400)

; ============================================================
; RESIZE BORDER — WM_NCHITTEST override for -Caption windows
; ============================================================
WM_NCHITTEST_Handler(wParam, lParam, msg, hwnd) {
    rootHwnd := GetTopLevelWindowHwnd(hwnd)
    if !rootHwnd
        rootHwnd := hwnd

    if !IsResizableWindowHwnd(rootHwnd)
        return 0
    mx := lParam & 0xFFFF
    my := (lParam >> 16) & 0xFFFF
    if (mx >= 0x8000)
        mx -= 0x10000
    if (my >= 0x8000)
        my -= 0x10000
    WinGetPos(&wx, &wy, &ww, &wh, rootHwnd)
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
ShowTrayMenuDeferred(*) {
    A_TrayMenu.Show()
}

TrayIconMessageHandler(wParam, lParam, msg, hwnd) {
    static WM_LBUTTONUP := 0x202
    static WM_LBUTTONDBLCLK := 0x203
    static WM_RBUTTONUP := 0x205
    static WM_CONTEXTMENU := 0x7B
    static ignoreNextLeftUp := false

    if (lParam = WM_LBUTTONUP) {
        if ignoreNextLeftUp {
            ignoreNextLeftUp := false
            return 0
        }
        SetTimer(ShowTrayMenuDeferred, -220)
        return 0
    }
    if (lParam = WM_LBUTTONDBLCLK) {
        ignoreNextLeftUp := true
        SetTimer(ShowTrayMenuDeferred, 0)
        ShowPromptChat()
        return 0
    }
    if (lParam = WM_RBUTTONUP || lParam = WM_CONTEXTMENU) {
        SetTimer(ShowTrayMenuDeferred, 0)
        A_TrayMenu.Show()
        return 0
    }
}

EditorWindowClose(*) {
    global editorGui
    StopWindowFocus("editor")
    PersistWindowSize(editorGui, "editor")
    editorGui.Hide()
    ; Ensure recording-state suspensions are always reverted on native close paths.
    ResumeDynamicHotkeys()
    ResumePromptHotkeys()
    return 1
}

; ============================================================
; UTILITIES
; ============================================================

RegisterResizableWindow(guiObj) {
    global RESIZABLE_WINDOW_HWNDS
    if IsObject(guiObj)
        RESIZABLE_WINDOW_HWNDS[guiObj.Hwnd] := true
}

GetTopLevelWindowHwnd(hwnd) {
    if !hwnd
        return 0
    try return DllCall("GetAncestor", "ptr", hwnd, "uint", 2, "ptr")
    catch
        return hwnd
}

IsResizableWindowHwnd(hwnd) {
    global RESIZABLE_WINDOW_HWNDS, settingsGui, pickerGui, editorGui, promptConfirmGui, iterativeGui

    if RESIZABLE_WINDOW_HWNDS.Has(hwnd)
        return true

    for guiObj in [settingsGui, pickerGui, editorGui, promptConfirmGui, iterativeGui] {
        if (IsObject(guiObj) && guiObj.Hwnd = hwnd) {
            RESIZABLE_WINDOW_HWNDS[hwnd] := true
            return true
        }
    }

    return false
}

PersistWindowSize(guiObj, prefix) {
    if !IsObject(guiObj) || prefix = ""
        return
    try {
        guiObj.GetPos(,, &w, &h)
        if (w > 0 && h > 0)
            SaveSettingBatch(Map(prefix . "_w", w, prefix . "_h", h))
    }
}

GetPersistedWindowSize(prefix, minW, minH, defaultW, defaultH, &w, &h) {
    savedW := ReadSetting(prefix . "_w")
    savedH := ReadSetting(prefix . "_h")
    w := (savedW != "" && Integer(savedW) >= minW) ? savedW : defaultW
    h := (savedH != "" && Integer(savedH) >= minH) ? savedH : defaultH
}

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
    RemoveWindowFocusJob(windowKey)
}

EnsureWindowFocus(windowKey) {
    global WINDOW_FOCUS_JOBS
    if !WINDOW_FOCUS_JOBS.Has(windowKey)
        return

    state := WINDOW_FOCUS_JOBS[windowKey]
    guiObj := state["gui"]
    if !IsObject(guiObj) {
        RemoveWindowFocusJob(windowKey)
        return
    }

    hwndSpec := "ahk_id " . guiObj.Hwnd
    if !WinExist(hwndSpec) {
        RemoveWindowFocusJob(windowKey)
        return
    }

    try WinActivate(hwndSpec)
    focusScript := state["focusScript"]
    if (focusScript != "")
        try guiObj.ExecuteScriptAsync(focusScript)

    if (A_TickCount < state["until"])
        SetTimer(EnsureWindowFocus.Bind(windowKey), -state["interval"])
    else
        RemoveWindowFocusJob(windowKey)
}

RemoveWindowFocusJob(windowKey) {
    global WINDOW_FOCUS_JOBS
    if WINDOW_FOCUS_JOBS.Has(windowKey)
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
