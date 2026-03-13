import { WindowsKeyboardBackend } from "./windows-keyboard-backend";

const backend = new WindowsKeyboardBackend();

await backend.registerPrefix({ id: "prompt-prefix", accelerator: "Alt+R" }, () => {
  console.log("[prefix] Alt+R");
});

const unsubscribe = backend.onKeyEvent((event) => {
  console.log(
    `[key] ${event.type} key=${event.key} alt=${event.alt} ctrl=${event.ctrl} shift=${event.shift} meta=${event.meta} repeat=${event.repeat} ts=${event.timestamp}`,
  );
});

console.log("Starting Windows keyboard backend spike. Press Esc in this terminal to stop.");
await backend.start();

while (true) {
  const done = await new Promise<boolean>((resolve) => {
    const off = backend.onKeyEvent((event) => {
      if (event.type === "down" && event.key === "Esc") {
        off();
        resolve(true);
      }
    });
  });
  if (done) break;
}

unsubscribe();
await backend.stop();
