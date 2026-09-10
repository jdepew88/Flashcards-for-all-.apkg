// Extracted from CCNA Practice Labs (ccna-10-week-dev) — src/lib/flashcards/types.ts
// at commit 2a66e957007a9465e5e06042ad8e450b419dd42f.

export interface FlashcardChapter {
  id: string;
  name: string;
  cardCount: number;
}

export interface Flashcard {
  id: number;
  chapter: string;
  tags: string[];
  front: string;
  back: string;
}

export interface FlashcardDeck {
  slug: string;
  title: string;
  cardCount: number;
  chapters: FlashcardChapter[];
  cards: Flashcard[];
}
