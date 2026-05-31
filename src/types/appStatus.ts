export type EngineStatus = "bundled" | "starting" | "connected" | "error";

export interface AppStatus {
  appName: string;
  aria2Engine: EngineStatus;
  defaultSplit: number;
  maxActiveDownloads: number;
}
