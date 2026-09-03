// @ts-nocheck

// ruleid: no-raw-fetch
await fetch("https://example.com");

// ruleid: no-raw-fetch
await globalThis.fetch("https://example.com");

// ruleid: no-raw-fetch
import { Agent, request } from "undici";

// ruleid: no-raw-fetch
import undici from "undici";

// ruleid: no-raw-fetch
const nodeHttp = require("node:http");

// ruleid: no-raw-fetch
await import("axios");

// ok: no-raw-fetch
await ctx.fetch({ url: "https://example.com", method: "GET" });

// ok: no-raw-fetch
const parsed = await response.json();
