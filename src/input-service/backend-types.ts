export type InputBackendCapabilities = {
  globalObserve: boolean;
  consumeKeys: boolean;
  sourceWindow: boolean;
  singleRegistration: boolean;
  prefixRegistration: boolean;
};

export type ShortcutRegistration = {
  id: string;
  accelerator: string;
};

export interface InputBackend {
  readonly capabilities: InputBackendCapabilities;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRegistered(accelerator: string): boolean;
  registerShortcut(registration: ShortcutRegistration, handler: () => void): boolean;
  unregisterShortcut(id: string): void;
  unregisterAll(): void;
}
