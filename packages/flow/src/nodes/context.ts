export type FetchRequest = {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
};

export type FetchResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
};

export type EmailMessage = { subject: string; html: string };

export type FlowContext = {
  fetch: (req: FetchRequest) => Promise<FetchResponse>;
  sendEmail: (msg: EmailMessage) => Promise<void>;
  previous: string | null;
  saveSnapshot: (value: string) => Promise<void>;
  signal: AbortSignal;
  now: () => Date;
};
