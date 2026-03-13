import { GlobalShortcut } from "electrobun/bun";
import type { InputBackend, InputBackendCapabilities, ShortcutRegistration } from "./backend-types";

const CAPABILITIES: InputBackendCapabilities = {
  globalObserve: false,
  consumeKeys: false,
  sourceWindow: false,
  singleRegistration: true,
  prefixRegistration: true,
};

export class ElectrobunShortcutBackend implements InputBackend {
  readonly capabilities = CAPABILITIES;
  private readonly registrations = new Map<string, string>();

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    this.unregisterAll();
  }

  isRegistered(accelerator: string): boolean {
    return GlobalShortcut.isRegistered(accelerator);
  }

  registerShortcut(registration: ShortcutRegistration, handler: () => void): boolean {
    if (GlobalShortcut.isRegistered(registration.accelerator)) return false;
    const ok = GlobalShortcut.register(registration.accelerator, handler);
    if (ok) {
      this.registrations.set(registration.id, registration.accelerator);
    }
    return ok;
  }

  unregisterShortcut(id: string): void {
    const accelerator = this.registrations.get(id);
    if (!accelerator) return;
    GlobalShortcut.unregister(accelerator);
    this.registrations.delete(id);
  }

  unregisterAll(): void {
    GlobalShortcut.unregisterAll();
    this.registrations.clear();
  }
}
