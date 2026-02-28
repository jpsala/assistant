/**
 * AHK WebView communication bridge
 * Included in all WebView windows via: <script src="ahk-bridge.js"></script>
 *
 * Each window defines its own sendToAHK() wrapper:
 *   function sendToAHK(action, data = {}) { postToAHK({ action, ...data }); }
 */

function postToAHK(msgObj) {
  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.postMessage(msgObj);
  }
}

function minimizeWindow() { postToAHK({ action: 'minimize' }); }
function closeWindow()    { postToAHK({ action: 'close' });    }
