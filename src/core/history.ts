import { EditorSnapshot, SliderSettings } from './types';

/**
 * İki seviyeli sığ klonlama fonksiyonu.
 * JSON.parse(JSON.stringify()) yükünü ve geçici dize tahsisini ortadan kaldırır.
 */
export function cloneSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return {
    settings: { ...snapshot.settings },
    rotation: snapshot.rotation
  };
}

function areSnapshotsEqual(a: EditorSnapshot | null, b: EditorSnapshot): boolean {
  if (!a) return false;
  if (a.rotation !== b.rotation) return false;
  const aSettings = a.settings;
  const bSettings = b.settings;
  const keys = Object.keys(aSettings) as (keyof SliderSettings)[];
  for (const key of keys) {
    if (aSettings[key] !== bSettings[key]) return false;
  }
  return true;
}

export class HistoryManager {
  private undoStack: EditorSnapshot[] = [];
  private redoStack: EditorSnapshot[] = [];
  private readonly maxHistory = 30;

  constructor(initialSnapshot: EditorSnapshot) {
    this.reset(initialSnapshot);
  }

  public push(snapshot: EditorSnapshot): void {
    const current = this.current();
    if (current && areSnapshotsEqual(current, snapshot)) {
      return;
    }
    this.undoStack.push(cloneSnapshot(snapshot));
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  public undo(): EditorSnapshot | null {
    if (this.undoStack.length <= 1) return null;
    const current = this.undoStack.pop()!;
    this.redoStack.push(current);
    return cloneSnapshot(this.undoStack[this.undoStack.length - 1]);
  }

  public redo(): EditorSnapshot | null {
    if (this.redoStack.length === 0) return null;
    const next = this.redoStack.pop()!;
    this.undoStack.push(next);
    return cloneSnapshot(next);
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
    this.undoStack = [cloneSnapshot(initialSnapshot)];
    this.redoStack = [];
  }
}
