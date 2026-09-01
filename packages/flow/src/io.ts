export type FetchRequest = {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type FetchResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
};

export type EmailMessage = { subject: string; html: string };

export type RegexMatch = [full: string, ...groups: (string | undefined)[]];

export type RegexRequest = {
  text: string;
  pattern: string;
  flags?: string;
  signal?: AbortSignal;
};
