import z from "zod";
import { defineNode } from "../definition.ts";
import { CssSelectorConfig } from "../config.ts";
import * as cheerio from "cheerio";
import { MAX_NODE_OUTPUT } from "../../limits.ts";

const HtmlInput = z.union([z.string(), z.object({ body: z.string() })]);

export const cssSelectorNode = defineNode({
  configSchema: CssSelectorConfig,
  execute: async (input, config) => {
    const parsed = HtmlInput.safeParse(input);
    if (!parsed.success) {
      throw new Error("css_selector expects HTML, as a string or { body }");
    }
    const html =
      typeof parsed.data === "string" ? parsed.data : parsed.data.body;

    const $ = cheerio.load(html, { xml: false });
    const found = $(config.selector);
    if (found.length === 0) return null;

    return found.first().text().trim().slice(0, MAX_NODE_OUTPUT);
  },
});
