export type KeyEvent = {
  type: "down" | "up";
  key: string;
  code?: string;
  alt: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  repeat: boolean;
  timestamp: number;
};

export type PrefixRegistration = {
  accelerator: string;
  id: string;
};

export interface KeyboardBackend {
  start(): Promise<void>;
  stop(): Promise<void>;
  registerPrefix(reg: PrefixRegistration, handler: () => void): Promise<void>;
  unregisterPrefix(id: string): Promise<void>;
  onKeyEvent(handler: (event: KeyEvent) => void): () => void;
}
