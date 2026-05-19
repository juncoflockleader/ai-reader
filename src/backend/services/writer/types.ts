export type UUID = string;
export type IsoDateTime = string;

export type DocumentStatus = "draft" | "review" | "final" | "archived";
export type ConversationMode = "coach" | "coauthor" | "curriculum";

export type Document = {
  id: UUID;
  title: string;
  genre?: string;
  audience?: string;
  targetLength?: number;
  status: DocumentStatus;
  latestRevisionId?: UUID;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type DocumentBlockType = "heading" | "paragraph" | "list_item" | "quote" | "code";

export type DocumentBlock = {
  id: UUID;
  documentId: UUID;
  blockIndex: number;
  blockType: DocumentBlockType;
  text: string;
  startOffset: number;
  endOffset: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type DocumentEditOpType = "insert" | "delete" | "replace";

export type DocumentEditOp = {
  id: UUID;
  documentId: UUID;
  baseRevisionId?: UUID;
  resultRevisionId?: UUID;
  opType: DocumentEditOpType;
  rangeStart: number;
  rangeEnd: number;
  insertedText: string;
  deletedText: string;
  blockId?: UUID;
  rationale?: string;
  source: "user" | "assistant" | "system";
  createdAt: IsoDateTime;
};

export type DocumentRevision = {
  id: UUID;
  documentId: UUID;
  revisionNumber: number;
  fullText: string;
  outline?: OutlineNode[];
  thesis?: ThesisSnapshot;
  changeSummary?: string;
  parentRevisionId?: UUID;
  createdAt: IsoDateTime;
};

export type OutlineNode = {
  id: string;
  depth: number;
  label: string;
  blockId?: UUID;
};

export type ThesisSnapshot = {
  statement: string;
  confidence: number;
  evidenceBlockIds: UUID[];
};

export type WriterContextArtifactType =
  | "focus_span"
  | "document_outline"
  | "thesis_state"
  | "recent_changes"
  | "style_profile"
  | "learning_profile";

export type WriterContextArtifact<T = unknown> = {
  id: UUID;
  documentId: UUID;
  artifactType: WriterContextArtifactType;
  payload: T;
  sourceRevisionId: UUID;
  computedAt: IsoDateTime;
  staleAfterEditCount: number;
  staleAfterSeconds: number;
};

export type AssembledWriterContext = {
  systemInstruction: string;
  userPrompt: string;
  contextDebug: {
    mode: ConversationMode;
    documentId: UUID;
    revisionId: UUID;
    includedArtifactTypes: WriterContextArtifactType[];
    staleArtifactTypes: WriterContextArtifactType[];
    appliedGoalIds: UUID[];
    appliedSuggestionIds: UUID[];
  };
};

export type SuggestionStatus = "pending" | "accepted" | "rejected";

export type Suggestion = {
  id: UUID;
  documentId: UUID;
  conversationId?: UUID;
  messageId?: UUID;
  suggestionType: "clarity" | "grammar" | "tone" | "structure" | "argument";
  targetStart: number;
  targetEnd: number;
  originalText: string;
  suggestedText: string;
  explanation?: string;
  status: SuggestionStatus;
  resolutionNote?: string;
  createdAt: IsoDateTime;
  resolvedAt?: IsoDateTime;
};
