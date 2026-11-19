// File: src/zai/lib/toast.ts — toast store (replaces alert())
import { create } from "zustand";

export interface ToastItem { id: string; text: string; kind: "ok" | "error" | "info"; }
interface ToastState { items: ToastItem[]; push: (text: string, kind?: ToastItem["kind"]) => void; dismiss: (id: string) => void; }

export const useToasts = create<ToastState>((set) => ({
  items: [],
  push: (text, kind = "info") => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ items: [...s.items, { id, text, kind }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 3200);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));
export const toast = (text: string, kind: ToastItem["kind"] = "info") => useToasts.getState().push(text, kind);
