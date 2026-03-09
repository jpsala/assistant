import { Tray } from "electrobun/bun";

const tray = new Tray({ title: "Assistant" });

tray.setMenu([
  { type: "normal", label: "Assistant", action: "open" },
  { type: "divider" },
  { type: "normal", label: "Quit", action: "quit" },
]);

tray.on("tray-clicked", (event: any) => {
  const action = event.data?.action;
  if (action === "quit") {
    tray.remove();
    process.exit(0);
  }
});

console.log("Assistant started.");
