import type { LucideIcon } from "lucide-react";
import { BookMarked, CornerDownRight, Highlighter, MessageSquareText, Save, Trash2 } from "lucide-react";

export type ActionContext = "global" | "text-selection" | "assistant-message";
export type PlacementRule = "toolbar" | "context-menu" | "message-actions";

export type ActionDefinition = {
  id: string;
  label: string;
  icon: LucideIcon;
  description?: string;
  shortcut?: string;
  contexts: ActionContext[];
  placements: PlacementRule[];
};

export const actionRegistry: Record<string, ActionDefinition> = {
  summarizeSelection: {
    id: "summarizeSelection",
    label: "Summarize",
    description: "Summarize the active selection",
    icon: MessageSquareText,
    shortcut: "S",
    contexts: ["text-selection"],
    placements: ["context-menu"]
  },
  highlightSelection: {
    id: "highlightSelection",
    label: "Highlight",
    description: "Save the active selection as a highlight",
    icon: Highlighter,
    shortcut: "H",
    contexts: ["text-selection"],
    placements: ["toolbar", "context-menu"]
  },
  followUpAssistantMessage: {
    id: "followUpAssistantMessage",
    label: "Follow up",
    description: "Use an assistant response as follow-up context",
    icon: CornerDownRight,
    shortcut: "F",
    contexts: ["assistant-message"],
    placements: ["message-actions"]
  },
  saveAssistantMessageNote: {
    id: "saveAssistantMessageNote",
    label: "Save note",
    description: "Save an assistant response into notes",
    icon: Save,
    shortcut: "N",
    contexts: ["assistant-message"],
    placements: ["message-actions"]
  },
  jumpToCitationPage: {
    id: "jumpToCitationPage",
    label: "Go to citation",
    description: "Jump to the citation page in the reader",
    icon: BookMarked,
    contexts: ["assistant-message"],
    placements: ["message-actions"]
  },
  removeHighlights: {
    id: "removeHighlights",
    label: "Remove highlights",
    description: "Delete highlighted snippets from the page",
    icon: Trash2,
    contexts: ["text-selection"],
    placements: ["context-menu"]
  }
};

export function getAction(id: keyof typeof actionRegistry) {
  return actionRegistry[id];
}

export function listActions() {
  return Object.values(actionRegistry);
}
