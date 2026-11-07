import { SliderSettings } from '../core/types';
import { RawMetadata } from '../core/raw/libraw-types';
import { SmartRecipeSuggestion } from '../core/smart-recipe';

export type WorkspaceMode = 'develop' | 'print' | 'strip';

export type ToolTab = 'light' | 'color' | 'film' | 'optics' | 'histogram' | 'finishing';

export type PrintSubTab = 'enlarger' | 'paper' | 'dodgeburn' | 'finishing';

export interface UIState {
  workspaceMode: WorkspaceMode;
  activeTab: ToolTab;
  settings: SliderSettings;
  rotation: number;
  imageLoaded: boolean;
  imageFileName: string;
  isRaw: boolean;
  rawMetadata: RawMetadata | null;
  dimensions: { width: number; height: number };
  canUndo: boolean;
  canRedo: boolean;
  isComparing: boolean;
  isZoomed: boolean;
  activePresetDesc: string;
  printDimensionsText: string;
  aiDepthState: {
    enabled: boolean;
    aperture: number;
    focalDepth: number;
    showMap: boolean;
    status: string;
    progress: number;
    analyzing: boolean;
  };
  smartRecipe: {
    analyzing: boolean;
    suggestion: SmartRecipeSuggestion | null;
  };
}
