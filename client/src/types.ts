export interface Me {
  id: number;
  email: string;
  name: string;
  isAdmin: boolean;
}

export interface Idea {
  id: number;
  text: string;
  status: number;
  x: number;
  y: number;
  angle: number;
  authorId: number;
  author: string;
  /** Shown in the note's menu so you know who to go and ask. */
  authorEmail: string;
  createdAt: number;
  updatedAt: number;
}

export interface BoardSnapshot {
  me: Me;
  ideas: Idea[];
}

/** Frames pushed over /api/board/stream. `origin` is the tab that caused the change. */
export type StreamFrame =
  | { type: 'idea.created'; origin: string | null; data: Idea }
  | { type: 'idea.updated'; origin: string | null; data: Idea }
  | { type: 'idea.moved'; origin: string | null; data: { id: number; x: number; y: number; angle: number } }
  | { type: 'idea.deleted'; origin: string | null; data: { id: number } };
