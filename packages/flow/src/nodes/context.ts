import type {
  EmailMessage,
  FetchRequest,
  FetchResponse,
  RegexMatch,
  RegexRequest,
} from "../io.ts";

export type NodeContext = {
  fetch: (req: FetchRequest) => Promise<FetchResponse>;
  sendEmail: (msg: EmailMessage) => Promise<void>;
  matchRegex: (req: RegexRequest) => Promise<RegexMatch | null>;
  previous: string | null;
  saveSnapshot: (value: string) => Promise<void>;
  signal: AbortSignal;
  now: () => Date;
};
