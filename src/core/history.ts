import { EditorSnapshot } from './types';

export class HistoryManager {
  private undoStack: EditorSnapshot[] = [];
  private redoStack: EditorSnapshot[] = [];
  private readonly maxHistory = 30;

  constructor(initialSnapshot: EditorSnapshot) {
    this.reset(initialSnapshot);
  }

  public push(snapshot: EditorSnapshot): void {
    const current = this.current();
    if (current && JSON.stringify(current) === JSON.stringify(snapshot)) {
      return;
    }
    this.undoStack.push(JSON.parse(JSON.stringify(snapshot)));
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  public undo(): EditorSnapshot | null {
    if (this.undoStack.length <= 1) return null;
    const current = this.undoStack.pop()!;
    this.redoStack.push(current);
    return JSON.parse(JSON.stringify(this.undoStack[this.undoStack.length - 1]));
  }

  public redo(): EditorSnapshot | null {
    if (this.redoStack.length === 0) return null;
    const next = this.redoStack.pop()!;
    this.undoStack.push(next);
    return JSON.parse(JSON.stringify(next));
  }

  public canUndo(): boolean {
    return this.undoStack.length > 1;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public current(): EditorSnapshot | null {
    return this.undoStack.length > 0
      ? this.undoStack[this.undoStack.length - 1]
      : null;
  }

  public reset(initialSnapshot: EditorSnapshot): void {
    this.undoStack = [JSON.parse(JSON.stringify(initialSnapshot))];
    this.redoStack = [];
  }
}
