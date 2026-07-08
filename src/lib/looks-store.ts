// Tiny in-memory + localStorage store for saved looks.
import { useEffect, useState } from "react";

export type SavedLook = {
  id: string;
  styleId: string;
  styleName: string;
  intensity: number;
  dataUrl: string;
  createdAt: number;
};

const KEY = "lashmirror.looks";
const listeners = new Set<() => void>();

function read(): SavedLook[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function write(looks: SavedLook[]) {
  window.localStorage.setItem(KEY, JSON.stringify(looks));
  listeners.forEach((l) => l());
}

export function useLooks() {
  const [looks, setLooks] = useState<SavedLook[]>([]);
  useEffect(() => {
    setLooks(read());
    const cb = () => setLooks(read());
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);
  return looks;
}

export function saveLook(look: Omit<SavedLook, "id" | "createdAt">) {
  const all = read();
  all.unshift({ ...look, id: crypto.randomUUID(), createdAt: Date.now() });
  write(all.slice(0, 50));
}

export function deleteLook(id: string) {
  write(read().filter((l) => l.id !== id));
}
