// Single source of truth for the reader's localStorage keys + safe accessors.
//
// Today these keys are scattered as string literals and template strings across
// App.tsx, PdfPanel.tsx, and AssistantPanel.tsx. New (v2) code reads/writes
// exclusively through here so there is one typed key map and one place that
// guards against storage being unavailable or holding malformed values. Because
// the key strings are identical to the old ones, v2 state carries over from v1
// (e.g. last page, zoom, theme) with no migration step.

import { useMemo } from "react";

/** Every persisted key the reader uses. Static keys are strings; per-book keys are builders. */
export const readerStorageKeys = {
  // suite-level
  activeApp: "studysuite:activeApp",
  startDismissed: "studysuite:startDismissed",
  // reader UI
  theme: "studyreader:ui:theme",
  leftPaneWidthPercent: "studyreader:ui:leftPaneWidthPercent",
  lastBookId: "studyreader:lastBookId",
  // assistant
  assistantChatMode: "studyreader:assistant:chatMode",
  assistantContextScope: "studyreader:assistant:contextScope",
  assistantComposerOpen: "studyreader:assistant:composerOpen",
  recentPrompts: "studyreader:recentPrompts",
  savedPromptTemplates: "studyreader:savedPromptTemplates",
  // per-book
  bookPage: (bookId: string) => `studyreader:${bookId}:page`,
  zoom: (bookId: string) => `studyreader:reader:zoom:${bookId}`,
  gettingStartedRect: (bookId: string) =>
    `studyreader:reader:getting-started:rect:${bookId}`,
} as const;

function getString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function getNumber(key: string, fallback: number): number {
  const raw = getString(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function setNumber(key: string, value: number): void {
  setString(key, String(value));
}

function getJSON<T>(key: string, fallback: T): T {
  const raw = getString(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function setJSON(key: string, value: unknown): void {
  try {
    setString(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Stable bundle of typed storage accessors. Safe to destructure. */
export const readerStorage = {
  keys: readerStorageKeys,
  getString,
  setString,
  remove,
  getNumber,
  setNumber,
  getJSON,
  setJSON,
} as const;

export type ReaderStorage = typeof readerStorage;

/** Hook form for components that prefer a referentially-stable accessor object. */
export function useReaderPersistence(): ReaderStorage {
  return useMemo(() => readerStorage, []);
}
