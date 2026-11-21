export type MemoryCategory = 'profile' | 'preference' | 'project' | 'fact';

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  content: string;
  tags: string[];
  pinned?: boolean;
  sensitive?: boolean;
  createdAt: number;
  updatedAt: number;
  sourceConvId?: string;
}

export interface MemorySettings {
  enabled: boolean;
  autoExtract: boolean;
  recordSensitiveInfo: boolean;
  maxInjectedMemories: number;
  maxInjectedTokens: number;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  autoExtract: true,
  recordSensitiveInfo: false,
  maxInjectedMemories: 6,
  maxInjectedTokens: 600,
};
