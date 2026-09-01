import { HttpFetchConfig } from "../config.ts";
import { defineNode } from "../definition.ts";

export const httpFetchNode = defineNode({
  configSchema: HttpFetchConfig,
  execute: async (_input, config, ctx) => {
    const resp = await ctx.fetch({
      url: config.url,
      headers: config.headers,
      method: "GET",
      signal: ctx.signal,
    });

    if (config.failOnError && (resp.status < 200 || resp.status > 299)) {
      throw new Error(
        `http_fetch got ${resp.status} from ${new URL(config.url).host}`,
      );
    }
    return { status: resp.status, body: resp.body, truncated: resp.truncated };
  },
});
