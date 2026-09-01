import type {
  EmailMessage,
  FetchRequest,
  FetchResponse,
  RegexMatch,
  RegexRequest,
} from "../io.ts";
import type { FlowNodeType } from "../nodes/types.ts";

export type NodeLogEntry = {
  nodeId: string;
  type: FlowNodeType;
  status: "ok" | "failed" | "skipped";
  durationMs: number;
  error?: string;
  output?: unknown;
};

export type RunResult = {
  status: "ok" | "failed";
  log: NodeLogEntry[];
  snapshots: Record<string, string>;
  error?: string;
};

export type RunContext = {
  fetch: (req: FetchRequest) => Promise<FetchResponse>;
  sendEmail: (msg: EmailMessage) => Promise<void>;
  matchRegex: (req: RegexRequest) => Promise<RegexMatch | null>;

  snapshots: Record<string, string>;
  commitSnapshots: (snapshots: Record<string, string>) => Promise<void>;
  signal: AbortSignal;
  now: () => Date;

  nodeTimeoutMs?: number;
  runTimeoutMs?: number;
};
