



import type { AppSettings, DemoSite, SharedSettings } from '../core/types';

export type { AppSettings, DemoSite };

export interface RepoInfo {
  path: string;
  
  remote: string | null;
  
  origin?: string | null;
  
  branch: string;
  
  folder?: true;
}


export type RepoAdapter = SharedSettings & Required<Pick<SharedSettings, 'planDocs' | 'land' | 'softPaths' | 'workstations' | 'language'>>;
