import type { LucideIcon } from "lucide-react";
import { BookMarked, CornerDownRight, Highlighter, MessageSquareText, Save, Trash2 } from "lucide-react";

export type ActionContext = "global" | "text-selection" | "assistant-message";
export type PlacementRule = "toolbar" | "context-menu" | "message-actions";

export type ActionDefinition = {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  contexts: ActionContext[];
  placements: PlacementRule[];
};

export const actionRegistry: Record<string, ActionDefinition> = {
  summarizeSelection: {
    id: "summarizeSelection",
    label: "Summarize",
    icon: MessageSquareText,
    shortcut: "S",
    contexts: ["text-selection"],
    placements: ["context-menu"]
  },
  highlightSelection: {
    id: "highlightSelection",
    label: "Highlight",
    icon: Highlighter,
    shortcut: "H",
    contexts: ["text-selection"],
    placements: ["toolbar", "context-menu"]
  },
  followUpAssistantMessage: {
    id: "followUpAssistantMessage",
    label: "Follow up",
    icon: CornerDownRight,
    shortcut: "F",
    contexts: ["assistant-message"],
    placements: ["message-actions"]
  },
  saveAssistantMessageNote: {
    id: "saveAssistantMessageNote",
    label: "Save note",
    icon: Save,
    shortcut: "N",
    contexts: ["assistant-message"],
    placements: ["message-actions"]
  },
  jumpToCitationPage: {
    id: "jumpToCitationPage",
    label: "Go to citation",
    icon: BookMarked,
    contexts: ["assistant-message"],
    placements: ["message-actions"]
  },
  removeHighlights: {
    id: "removeHighlights",
    label: "Remove highlights",
    icon: Trash2,
    contexts: ["text-selection"],
    placements: ["context-menu"]
  }
};

export function getAction(id: keyof typeof actionRegistry) {
  return actionRegistry[id];
}
