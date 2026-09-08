import { prisma } from "../src/index.js";
import { FlowSchema } from "@watchflow/flow";

const rawFlow: unknown = {
  version: 1,
  nodes: [
    {
      id: "fetch",
      type: "http_fetch",
      data: { url: "https://news.ycombinator.com/" },
    },
    {
      id: "title",
      type: "css_selector",
      data: { selector: ".titleline > a" },
    },
    { id: "diff", type: "compare_last", data: {} },
    {
      id: "changed",
      type: "condition",
      data: { field: "changed", operator: "equals", value: "true" },
    },
    {
      id: "notify",
      type: "email",
      data: {
        subject: "HN front page changed",
        body: "<p>Now: {{value}}</p><p>Before: {{previous}}</p>",
      },
    },
  ],
  edges: [
    { from: "fetch", to: "title" },
    { from: "title", to: "diff" },
    { from: "diff", to: "changed" },
    { from: "changed", to: "notify", handle: "true" },
  ],
};

const flow = FlowSchema.parse(rawFlow);

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "stefbisti@gmail.com" },
    update: {
      name: "Dev User",
      role: "admin",
    },
    create: {
      email: "stefbisti@gmail.com",
      name: "Dev User",
      role: "admin",
    },
  });

  const watch = {
    userId: user.id,
    name: "Example — Hacker News front page",
    flow: flow,
    intervalMin: 15,
    nextRunAt: new Date(),
  };

  await prisma.watch.upsert({
    where: { id: "seed-watch-1" },
    update: watch,
    create: {
      id: "seed-watch-1",
      ...watch,
    },
  });

  console.log("seeded:", user.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
