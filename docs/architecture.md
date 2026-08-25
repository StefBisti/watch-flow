made by Fable 5

---

**Stack:** Next.js 16.3 (App Router, Turbopack), React 19, TypeScript, Prisma 7, shadcn/ui, Zod, Tailwind. **Optional add-ons:** TanStack Query (only in the cases listed in §7), react-hook-form (only in the cases listed in §5.6), sonner (toasts).

This is a decision-first document. Find your situation in the table in §0, jump to the pattern, copy the shape.

---

## 0. The decision table (start here)

| I need to...                                                    | Pattern                                                               | Section |
| --------------------------------------------------------------- | --------------------------------------------------------------------- | ------- |
| Show data from the DB on a page                                 | Server Component reads DB via a query function                        | §4.1    |
| Show a spinner while data loads                                 | `loading.tsx` or `<Suspense>` around the slow part                    | §4.2    |
| Filter / search / paginate a list                               | Put state in the URL (`searchParams`), Server Component reads it      | §4.3    |
| Handle "not found" / errors on a page                           | `notFound()` + `not-found.tsx`, `error.tsx`                           | §4.4    |
| Make a public/rarely-changing page fast                         | `'use cache'` + `cacheTag`                                            | §4.5    |
| Create/edit something with a form the user fills in             | Server Action `(prevState, formData)` + `useActionState` + Zod        | §5.1    |
| Delete / toggle / archive (no user input)                       | Server Action with typed args + `.bind()` or `useTransition`          | §5.2    |
| Make the UI feel instant on a mutation                          | `useOptimistic`                                                       | §5.3    |
| Disable a button while submitting                               | `useFormStatus` or `isPending` from `useActionState`                  | §5.4    |
| Refresh data after a mutation                                   | `revalidatePath` / `updateTag` / `redirect` inside the action         | §5.5    |
| Big form: many fields, live validation, dynamic rows, wizard    | react-hook-form + Zod + shadcn `<Form>` + typed Server Action         | §5.6    |
| Infinite scroll, polling, search-as-you-type, client dashboards | TanStack Query + Route Handler (GET)                                  | §7      |
| Receive a webhook / serve JSON to third parties / file download | Route Handler (`route.ts`)                                            | §8      |
| Redirect logged-out users                                       | `proxy.ts` (cheap check) + real check in DAL                          | §9      |
| Open a detail view as a modal but keep it linkable              | Parallel + intercepting routes                                        | §10.2   |
| Upload a file                                                   | Presigned URL to storage, Server Action saves the DB row              | §11     |
| Show a toast after an action                                    | Return a result object → `useEffect` → `toast()`                      | §12     |
| Live updates                                                    | Polling with TanStack Query first; SSE/WebSocket only if truly needed | §13     |

Golden rules (memorize these five):

1. **Read on the server, mutate with Server Actions, keep state in the URL.**
2. **Client Components are leaves.** Push `'use client'` to the smallest interactive piece.
3. **Every Server Action and every query function checks auth and validates input.** No exceptions.
4. **One `ActionResult` shape everywhere** (§5.0). Never throw for expected failures.
5. **No TanStack Query until §7 says so.** Server Components + Actions cover 90% of apps.

---

## 1. Project structure

```
src/
  app/                        # routes only. Thin. No business logic here.
    (marketing)/              # route group: public pages, own layout
    (app)/                    # route group: authenticated app, own layout
      layout.tsx
      dashboard/page.tsx
      workflows/
        page.tsx              # list
        loading.tsx
        error.tsx
        new/page.tsx          # create form
        [id]/
          page.tsx            # detail
          edit/page.tsx
          not-found.tsx
    api/                      # Route Handlers only when §8 applies
      webhooks/stripe/route.ts
    layout.tsx                # root layout: fonts, providers, <Toaster />
    globals.css
  features/                   # ONE folder per domain concept. code lives here
    workflows/
      queries.ts              # 'server-only'. Prisma reads. Named getX/listX.
      actions.ts              # 'use server'. Mutations. createX/updateX/deleteX.
      schemas.ts              # Zod schemas shared by actions AND forms.
      types.ts                # Types derived from Prisma / Zod.
      components/
        workflow-list.tsx     # Server Component
        workflow-card.tsx     # Server Component
        create-workflow-form.tsx   # 'use client'
        delete-workflow-button.tsx # 'use client'
  components/
    ui/                       # shadcn (generated, don't hand-edit much)
    shared/                   # your reusable non-domain components (PageHeader, EmptyState, SubmitButton)
  lib/
    prisma.ts                 # singleton
    auth.ts                   # getCurrentUser / requireUser
    action-result.ts          # ActionResult type + helpers
    env.ts                    # validated env
    utils.ts                  # cn() etc.
  generated/prisma/           # Prisma 7 client output (gitignored)
prisma/
  schema.prisma
  migrations/
  seed.ts
prisma.config.ts
proxy.ts
```

Rules:

- `app/` files import from `features/`. Never the reverse.
- A page file is ~10–30 lines: get params, call a query, render feature components.
- `queries.ts` starts with `import 'server-only'`. `actions.ts` starts with `'use server'`.

---

## 2. Foundations (set up once per project, ~45 minutes)

### 2.1 Prisma 7

`prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

model Workflow {
  id          String   @id @default(cuid())
  name        String
  description String?
  ownerId     String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([ownerId])
}
```

`prisma.config.ts`

```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: env('DATABASE_URL') },
});
```

`src/lib/prisma.ts`

```ts
import 'server-only';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

Commands: `npx prisma migrate dev --name init` (dev), `npx prisma migrate deploy` (CI/prod), `npx prisma generate` (after schema change; add to `postinstall`).

Note: Prisma Next / Prisma 8 is in early access. Stay on Prisma 7 for production until 8 is GA.

### 2.2 Env validation

`src/lib/env.ts`

```ts
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  // add every var here. Build fails loudly if missing.
});

export const env = schema.parse(process.env);
```

Import `env` instead of touching `process.env` anywhere else.

### 2.3 Auth helper (provider-agnostic)

Pick one provider (Better Auth, Auth.js, Clerk). Hide it behind these two functions and never call the provider directly in features.

`src/lib/auth.ts`

```ts
import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';

export const getCurrentUser = cache(async () => {
  // call your provider's session API here
  // return { id, email, role } | null
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}
```

`cache()` dedupes the call within one request, so calling `requireUser()` in the layout, the page, and three queries costs one session lookup.

### 2.4 ActionResult type (used by EVERY server action)

`src/lib/action-result.ts`

```ts
export type FieldErrors<T> = Partial<Record<keyof T & string, string[]>>;

export type ActionResult<TData = void, TInput = Record<string, unknown>> =
  | { ok: true; data: TData; message?: string }
  | { ok: false; error: string; fieldErrors?: FieldErrors<TInput> };

export const ok = <T>(data: T, message?: string): ActionResult<T, never> =>
  ({ ok: true, data, message });

export const fail = <TInput>(error: string, fieldErrors?: FieldErrors<TInput>): ActionResult<never, TInput> =>
  ({ ok: false, error, fieldErrors });
```

### 2.5 Root layout

```tsx
// src/app/layout.tsx
import { Toaster } from '@/components/ui/sonner';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
```

Add a `<Providers>` client component here only when you adopt TanStack Query (§7) or a theme provider.

### 2.6 next.config.ts

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true, // enables 'use cache', cacheTag, cacheLife (§4.5). Safe to turn on from day 1.
  typedRoutes: true,
};
export default nextConfig;
```

---

## 3. Server vs Client Components — the boundary rules

| Use a **Server Component** (default, no directive) when | Use a **Client Component** (`'use client'`) when                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| It reads from the DB / calls `requireUser()`            | It uses `useState`, `useEffect`, `useActionState`, `useOptimistic`, `useTransition` |
| It renders a list, a page, a layout, a card             | It handles `onClick`, `onChange`, `onSubmit`                                        |
| It needs secrets or `server-only` modules               | It uses browser APIs (`window`, `localStorage`)                                     |
| It composes client components and passes them data      | It's a shadcn component that needs interactivity (Dialog, DropdownMenu, Form)       |

Rules:

1. Server Components can render Client Components. Client Components can render Server Components **only via `children`/props**, never by importing them.
2. Props from Server → Client must be serializable: no functions (except Server Actions), no Dates (send ISO strings or numbers), no Prisma Decimal (convert to number/string), no class instances.
3. Never import `@/lib/prisma` or a `queries.ts` file in a Client Component. `server-only` will throw at build time — that's the point.
4. Split "interactive shell + static content": a `<Dialog>` (client) can receive server-rendered `children`.

---

## 4. READING DATA

### 4.1 Default: Server Component → query function → Prisma

`src/features/workflows/queries.ts`

```ts
import 'server-only';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';

export async function listWorkflows(params: { q?: string; page?: number; pageSize?: number } = {}) {
  const user = await requireUser();
  const { q, page = 1, pageSize = 20 } = params;

  const where = {
    ownerId: user.id,
    ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.workflow.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, name: true, description: true, createdAt: true }, // select only what the UI needs
    }),
    prisma.workflow.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function getWorkflow(id: string) {
  const user = await requireUser();
  return prisma.workflow.findFirst({ where: { id, ownerId: user.id } }); // ownership in the WHERE, not after
}
```

`src/app/(app)/workflows/page.tsx`

```tsx
import { listWorkflows } from '@/features/workflows/queries';
import { WorkflowList } from '@/features/workflows/components/workflow-list';

export default async function WorkflowsPage() {
  const { items } = await listWorkflows();
  return <WorkflowList items={items} />;
}
```

`src/app/(app)/workflows/[id]/page.tsx`

```tsx
import { notFound } from 'next/navigation';
import { getWorkflow } from '@/features/workflows/queries';

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;              // params is a Promise in Next 15+
  const workflow = await getWorkflow(id);
  if (!workflow) notFound();
  return <WorkflowDetail workflow={workflow} />;
}
```

Rules:

- Every query calls `requireUser()` (or `getCurrentUser()` for public pages) and scopes by owner/tenant in the `where`.
- Use `select` for lists, full row only for detail pages.
- Multiple independent queries → `Promise.all`. Sequential awaits = waterfalls.
- Queries return plain data. Serialize Dates if the consumer is a Client Component (`createdAt.toISOString()`), or pass a formatted string.

### 4.2 Loading states

Two tools. Use both.

**A. `loading.tsx`** — whole route segment. Zero code, instant.

```tsx
// src/app/(app)/workflows/loading.tsx
import { Skeleton } from '@/components/ui/skeleton';
export default function Loading() {
  return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;
}
```

**B. `<Suspense>`** — stream one slow section while the rest of the page shows immediately. Use when a page has one slow query (stats, charts) and fast content.

```tsx
export default async function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" />              {/* renders instantly */}
      <Suspense fallback={<StatsSkeleton />}>
        <Stats />                                     {/* async Server Component doing the slow query */}
      </Suspense>
    </>
  );
}

async function Stats() {
  const stats = await getDashboardStats();
  return <StatsGrid stats={stats} />;
}
```

Rule: don't `await` slow data in the page body; move it into an async child wrapped in `<Suspense>`.

### 4.3 Search, filters, sorting, pagination → URL is the state

Why: shareable, back-button works, Server Component reads it, no client cache to invalidate.

Page:

```tsx
type SP = Promise<{ q?: string; page?: string; sort?: string }>;

export default async function WorkflowsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const data = await listWorkflows({ q: sp.q, page });
  return (
    <>
      <SearchInput defaultValue={sp.q ?? ''} />
      <WorkflowList items={data.items} />
      <Pagination page={data.page} total={data.total} pageSize={data.pageSize} />
    </>
  );
}
```

Client search input (debounced, updates URL):

```tsx
'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useDebouncedCallback } from 'use-debounce';
import { Input } from '@/components/ui/input';

export function SearchInput({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const onChange = useDebouncedCallback((value: string) => {
    const params = new URLSearchParams(sp);
    value ? params.set('q', value) : params.delete('q');
    params.delete('page'); // reset pagination on new search
    router.replace(`${pathname}?${params.toString()}`);
  }, 300);

  return <Input defaultValue={defaultValue} onChange={(e) => onChange(e.target.value)} placeholder="Search..." />;
}
```

Pagination is `<Link href={{ pathname, query: { ...sp, page: page + 1 } }}>`. Sorting is the same idea with `sort=name:asc`.

Validate searchParams with Zod when they get complex (`z.object({ page: z.coerce.number().min(1).default(1) })`).

### 4.4 Errors and not-found

- `notFound()` in a page/query → renders nearest `not-found.tsx`.
- `error.tsx` (must be `'use client'`) catches render errors in that segment and gives a `reset()` button. Put one at `app/(app)/error.tsx` at minimum.
- `global-error.tsx` for the root layout (rare).
- Expected failures (validation, "already exists") never throw — they go through `ActionResult` (§5.0).

```tsx
// src/app/(app)/error.tsx
'use client';
import { Button } from '@/components/ui/button';
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="p-8 text-center">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <Button onClick={reset} className="mt-4">Try again</Button>
    </div>
  );
}
```

### 4.5 Caching — dynamic by default, opt in explicitly

Default behavior: everything that touches `requireUser()`, cookies, headers, or searchParams is dynamic (rendered per request). This is correct for authenticated apps. **Do nothing** for user-specific pages.

Opt in to caching only for data that is public or shared and changes rarely (marketing pages, public catalogs, config lists):

```ts
// queries.ts
import { cacheTag, cacheLife } from 'next/cache';

export async function listPublicTemplates() {
  'use cache';
  cacheTag('templates');
  cacheLife('hours');           // presets: 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'max'
  return prisma.template.findMany({ where: { published: true } });
}
```

Invalidate in the mutating Server Action: `updateTag('templates')` (immediate, read-your-own-writes) or `revalidateTag('templates', 'max')` (stale-while-revalidate).

Rules:

- Never put `'use cache'` on a function that calls `requireUser()` / reads cookies — it will error, and even if it didn't you'd leak data between users.
- `React.cache()` (§2.3) is per-request dedupe, not persistent caching. Different tool.
- If unsure: don't cache. Add caching when a page is measurably slow.

### 4.6 When the client needs data (not the page)

Rare cases: a `<Combobox>` that searches users as you type, a chart that polls, infinite scroll. → §7 (TanStack Query + Route Handler). Everything else: pass data down from the Server Component as props.

---

## 5. WRITING DATA (mutations)

### 5.0 The universal Server Action skeleton

Every action, no matter its shape, does these 6 things in this order:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ok, fail, type ActionResult } from '@/lib/action-result';

export async function someAction(/* input */): Promise<ActionResult<...>> {
  const user = await requireUser();                 // 1. auth
  const parsed = Schema.safeParse(input);           // 2. validate
  if (!parsed.success) return fail('Invalid input', z.flattenError(parsed.error).fieldErrors);
  // 3. authorize (does user own the row?) — usually via the WHERE clause
  try {
    const row = await prisma.x.create(...);         // 4. mutate
  } catch (e) {
    return fail(mapPrismaError(e));                 // 5. expected failures → fail(); never throw to the client
  }
  revalidatePath('/workflows');                // 6. revalidate and/or redirect
  return ok(row);
}
```

Rules:

- Server Actions are **public HTTP endpoints**. Anyone can call them with any payload. That's why 1 and 2 are mandatory.
- Never trust an `id` from the client to belong to the user. Scope with `where: { id, ownerId: user.id }` and check `count === 0` → `fail('Not found')`.
- Only serializable values in and out.
- `redirect()` throws internally — call it **outside** try/catch (after step 5), or the catch will swallow it.

### 5.1 Form with user input (create / edit) → `useActionState`

This is the "create-workflow" shape. Use it for any form with ≤ ~8 plain fields.

**Schema** (`schemas.ts`, shared by action and form)

```ts
import { z } from 'zod';
export const CreateWorkflowSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: z.string().trim().max(500).optional().or(z.literal('')),
});
export type CreateWorkflowInput = z.infer<typeof CreateWorkflowSchema>;
```

**Action** (`actions.ts`)

```ts
'use server';
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fail, type ActionResult } from '@/lib/action-result';
import { CreateWorkflowSchema, type CreateWorkflowInput } from './schemas';

export type CreateWorkflowState = ActionResult<void, CreateWorkflowInput> | null;

export async function createWorkflow(_prev: CreateWorkflowState, formData: FormData): Promise<CreateWorkflowState> {
  const user = await requireUser();

  const parsed = CreateWorkflowSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fail('Please fix the errors below', z.flattenError(parsed.error).fieldErrors);
  }

  let id: string;
  try {
    const wf = await prisma.workflow.create({ data: { ...parsed.data, ownerId: user.id } });
    id = wf.id;
  } catch {
	// check if error is an expected one like a vilation of the @@unique rule, in which case return a custom error message
	// else:
    return fail('Could not create workflow. Try again.');
  }

  revalidatePath('/workflows');
  redirect(`/workflows/${id}`); // outside try/catch
}
```

**Form component** (`components/create-workflow-form.tsx`)

```tsx
'use client';
import { useActionState } from 'react';
import { createWorkflow } from '../actions';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function CreateWorkflowForm() {
  const [state, formAction, isPending] = useActionState(createWorkflow, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required aria-invalid={!!errors?.name} />
        {errors?.name && <p className="text-sm text-destructive">{errors.name[0]}</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" />
        {errors?.description && <p className="text-sm text-destructive">{errors.description[0]}</p>}
      </div>
      {state && !state.ok && !state.fieldErrors && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={isPending}>{isPending ? 'Creating…' : 'Create'}</Button>
    </form>
  );
}
```

**Edit** is identical, plus a hidden `<input type="hidden" name="id" />` (or `updateWorkflow.bind(null, id)`) and `defaultValue={workflow.name}` on inputs. The action does `updateMany({ where: { id, ownerId: user.id } })` and checks `count`.

Why `useActionState` here: it gives you `state` (errors from the server), `isPending`, progressive enhancement (works before JS loads), and it resets nothing you don't tell it to. It is the default for forms.

Keeping inputs filled after a failed submit: React 19 keeps uncontrolled inputs' values on `useActionState` re-render in most cases; if you see them reset, return `values: Object.fromEntries(formData)` in the failure state and use them as `defaultValue`.

### 5.2 Action WITHOUT user input (delete, toggle, archive, duplicate)

Action takes typed parameters, not FormData:

```ts
'use server';
export async function deleteWorkflow(id: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!z.string().cuid().safeParse(id).success) return fail('Invalid id');

  const { count } = await prisma.workflow.deleteMany({ where: { id, ownerId: user.id } });
  if (count === 0) return fail('Not found');

  revalidatePath('/workflows');
  return ok(undefined, 'Workflow deleted');
}
```

Two ways to call it. Pick by whether you need a confirm dialog / toast.

**A. Simplest — form + bind (progressive enhancement, no JS needed):**

```tsx
// can even be a Server Component
<form action={deleteWorkflow.bind(null, workflow.id)}>
  <Button variant="ghost" size="icon" type="submit"><Trash2 /></Button>
</form>
```

Use for low-stakes toggles. Note: `.bind` here ignores the return value.

**B. Client button with `useTransition` (confirm dialog + toast + pending state):**

```tsx
'use client';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { deleteWorkflow } from '../actions';
import { AlertDialog, ... } from '@/components/ui/alert-dialog';

export function DeleteWorkflowButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const res = await deleteWorkflow(id);
      res.ok ? toast.success(res.message) : toast.error(res.error);
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild><Button variant="destructive" disabled={isPending}>Delete</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Delete this workflow?</AlertDialogTitle></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

Always wrap direct action calls in `startTransition` — it keeps the UI responsive and makes `revalidatePath` refresh smoothly.

**Toggle example** (`toggleWorkflowActive(id: string, active: boolean)`) → same shape as delete with `updateMany`.

### 5.3 Optimistic UI → `useOptimistic`

Use when the mutation is fast and almost never fails (like, favorite, toggle, reorder). Skip for creates/deletes with side effects.

```tsx
'use client';
import { useOptimistic, useTransition } from 'react';
import { toggleFavorite } from '../actions';

export function FavoriteButton({ id, isFavorite }: { id: string; isFavorite: boolean }) {
  const [optimistic, toggle] = useOptimistic(isFavorite, (current: boolean) => !current);
  const [, startTransition] = useTransition();

  return (
    <button
      onClick={() =>
        startTransition(async () => {
          toggle(undefined);        // instant
          const res = await toggleFavorite(id, !optimistic);
          if (!res.ok) toast.error(res.error);
        })
      }
    >
      {optimistic ? <StarFilled /> : <Star />}
    </button>
  );
}
```

The action must `revalidatePath` so the real prop arrives and replaces the optimistic value.

### 5.4 Pending / submit button

Reusable, drop-in for any `<form action=…>`:

```tsx
'use client';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';

export function SubmitButton({ children, pendingText = 'Saving…', ...props }: React.ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending} {...props}>{pending ? pendingText : children}</Button>;
}
```

`useFormStatus` must be rendered **inside** the `<form>`. If you already have `isPending` from `useActionState`, use that instead.

### 5.5 After the mutation: what to call

|Situation|Call (inside the action)|
|---|---|
|Stay on the same page, list must refresh|`revalidatePath('/workflows')`|
|Detail page and list both show this row|`revalidatePath('/workflows'); revalidatePath(`/workflows/${id}`)` — or tag both with `cacheTag` and `updateTag`|
|Data was cached with `'use cache'` + `cacheTag('x')`|`updateTag('x')` (immediate)|
|Layout-level data changed (sidebar counts)|`revalidatePath('/', 'layout')`|
|Navigate after success|`redirect('/workflows/' + id)` — after revalidate, outside try/catch|
|Nothing cached, just want the client to re-render current route|`revalidatePath` of the current path (it's cheap for dynamic routes)|

Never call `router.refresh()` from the client as your primary strategy — do revalidation in the action.

### 5.6 Complex forms → react-hook-form + Zod + shadcn `<Form>` + typed action

Use only when you need: live per-field validation, dynamic field arrays, multi-step wizards, dependent fields, or >8 fields. Otherwise §5.1.

Action takes **typed data**, not FormData (RHF already collected it):

```ts
'use server';
export async function createProject(input: CreateProjectInput): Promise<ActionResult<{ id: string }, CreateProjectInput>> {
  const user = await requireUser();
  const parsed = CreateProjectSchema.safeParse(input);      // ALWAYS re-validate on the server
  if (!parsed.success) return fail('Invalid input', z.flattenError(parsed.error).fieldErrors);
  const p = await prisma.project.create({ data: { ...parsed.data, ownerId: user.id } });
  revalidatePath('/projects');
  return ok({ id: p.id });
}
```

Form:

```tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';

export function CreateProjectForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const form = useForm<CreateProjectInput>({ resolver: zodResolver(CreateProjectSchema), defaultValues: { name: '', members: [] } });

  function onSubmit(values: CreateProjectInput) {
    startTransition(async () => {
      const res = await createProject(values);
      if (!res.ok) {
        Object.entries(res.fieldErrors ?? {}).forEach(([k, v]) => form.setError(k as keyof CreateProjectInput, { message: v?.[0] }));
        if (!res.fieldErrors) toast.error(res.error);
        return;
      }
      toast.success('Project created');
      router.push(`/projects/${res.data.id}`);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <Button type="submit" disabled={isPending}>Create</Button>
      </form>
    </Form>
  );
}
```

Note: `redirect()` inside an action called this way still works, but returning the id and doing `router.push` gives you the toast. Either is fine; be consistent per project.

### 5.7 Prisma error mapping (put in `lib/prisma-errors.ts`)

```ts
import { Prisma } from '@/generated/prisma/client';
export function mapPrismaError(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') return 'A record with this value already exists.';
    if (e.code === 'P2025') return 'Record not found.';
    if (e.code === 'P2003') return 'Related record not found.';
  }
  console.error(e);
  return 'Something went wrong. Please try again.';
}
```

### 5.8 Multi-step writes → `prisma.$transaction`

Any action that writes to 2+ tables uses a transaction:

```ts
await prisma.$transaction(async (tx) => {
  const wf = await tx.workflow.create({ data });
  await tx.auditLog.create({ data: { action: 'create', workflowId: wf.id, userId: user.id } });
});
```

Side effects (emails, webhooks) go **after** the transaction, ideally via `after()` from `next/server` so the response isn't delayed:

```ts
import { after } from 'next/server';
after(() => sendEmail(...));
```

---

## 6. Which hook when — cheat sheet

| Hook                                 | Use for                                                        | Don't use for                          |
| ------------------------------------ | -------------------------------------------------------------- | -------------------------------------- |
| `useActionState(action, initial)`    | Forms bound with `<form action>`; need server errors + pending | Button-only actions                    |
| `useTransition` + direct action call | Delete/toggle buttons, RHF submit, anything with confirm/toast | Nothing — it's the general-purpose one |
| `useFormStatus`                      | A `<SubmitButton>` shared across forms                         | Outside a `<form>`                     |
| `useOptimistic`                      | Likes, toggles, reorders, "sent" states in chat                | Anything that can plausibly fail       |
| `useState`                           | Purely local UI (dialog open, tab selected)                    | Server data (that's props or URL)      |
| `useSearchParams` / `useRouter`      | Writing filters to the URL                                     | Storing form drafts                    |
| TanStack Query                       | §7 cases only                                                  | Page data, forms                       |

---

## 7. TanStack Query — when and how

### 7.1 Decision

**Do NOT add it** if your app is: CRUD pages, forms, dashboards that render once per navigation, admin panels. Server Components + Actions + URL state cover it and are simpler.

**Add it** when you have at least one of:

1. Infinite scroll / "load more" that must not re-render the whole page.
2. Polling (job status, notifications) every N seconds.
3. Search-as-you-type against the server inside a client component (combobox of 10k users).
4. Client-side cache shared by many client components (drag-and-drop board, spreadsheet-like editor).
5. Data that changes independently of navigation and must stay in sync across tabs/windows.

When added, use it **only for those components**. Pages still read on the server.

### 7.2 Data source for TanStack Query = Route Handler (GET), not Server Actions

Server Actions are POST, run serially, and aren't cacheable — wrong tool for reads. Route Handlers are GET, parallel, cacheable, and can reuse the same `queries.ts` function.

`src/app/api/workflows/route.ts`

```ts
import { NextResponse } from 'next/server';
import { listWorkflows } from '@/features/workflows/queries';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const data = await listWorkflows({ q: sp.get('q') ?? undefined, page: Number(sp.get('page') ?? 1) });
  return NextResponse.json(data);
}
```

`listWorkflows` already does auth — the Route Handler inherits it. If `requireUser` redirects, wrap: catch and return `401` instead in API context (add a `getUserOrThrow` variant).

### 7.3 Setup

`src/lib/query-client.ts`

```ts
import { QueryClient, isServer } from '@tanstack/react-query';
function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1 } } });
}
let browserQueryClient: QueryClient | undefined;
export function getQueryClient() {
  if (isServer) return makeQueryClient();
  return (browserQueryClient ??= makeQueryClient());
}
```

`src/app/providers.tsx`

```tsx
'use client';
import { QueryClientProvider } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
export function Providers({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>;
}
```

Wrap `{children}` in root layout with `<Providers>`.

### 7.4 Usage patterns

Infinite list:

```tsx
'use client';
const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
  queryKey: ['workflows', q],
  queryFn: ({ pageParam }) => fetch(`/api/workflows?q=${q}&page=${pageParam}`).then((r) => r.json()),
  initialPageParam: 1,
  getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
});
```

Polling:

```tsx
useQuery({ queryKey: ['job', id], queryFn: ..., refetchInterval: (q) => (q.state.data?.status === 'done' ? false : 2000) });
```

Server prefetch + hydrate (page loads with data, client takes over):

```tsx
// page.tsx (Server Component)
const qc = getQueryClient();
await qc.prefetchInfiniteQuery({ queryKey: ['workflows', ''], queryFn: () => listWorkflows(), initialPageParam: 1 });
return <HydrationBoundary state={dehydrate(qc)}><WorkflowInfiniteList /></HydrationBoundary>;
```

Mutations when using TQ: still call the Server Action (inside `useMutation`'s `mutationFn`), then `queryClient.invalidateQueries({ queryKey: ['workflows'] })` in `onSuccess`. The action's `revalidatePath` refreshes server-rendered parts; `invalidateQueries` refreshes TQ parts. You need both when both exist.

---

## 8. Route Handlers (`route.ts`) — when

Use only for:

1. Webhooks (Stripe, GitHub) — verify signature, no session.
2. JSON endpoints consumed by TanStack Query (§7) or by mobile / third parties.
3. File downloads / streaming responses (`return new Response(stream, { headers })`).
4. OAuth callbacks, cron endpoints (protect with a secret header).

Never use them for your own forms/mutations — that's Server Actions.

Shape:

```ts
export async function POST(req: Request) {
  const body = await req.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  // ...
  return NextResponse.json({ ok: true });
}
```

---

## 9. Auth & authorization layers

Three layers, all present:

1. **`proxy.ts`** (root, replaces `middleware.ts` in Next 16): cheap redirect for obviously-logged-out users. Check only for a session cookie's presence — no DB calls.

```ts
import { NextResponse, type NextRequest } from 'next/server';
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.has('session'); // your provider's cookie name
  if (!hasSession && req.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ['/((?!_next|api/webhooks|.*\\..*).*)'] };
```

2. **`requireUser()`** in every query and action (§2.3). This is the real gate. Proxy can be bypassed; this can't.
3. **Row-level ownership** in every Prisma `where`. Roles: `if (user.role !== 'admin') return fail('Forbidden')` at the top of admin actions.

Layouts are not a security boundary (a page can render without its layout re-running). Put checks in pages/queries, not only in layouts.

---

## 10. Layouts and routing patterns

### 10.1 Route groups

`(marketing)` and `(app)` each get their own `layout.tsx` (nav, sidebar). URLs are unaffected by parentheses.

### 10.2 Modal that's also a page (parallel + intercepting routes)

For "click a card → detail opens in a Dialog, but /workflows/[id] also works as a full page":

```
app/(app)/workflows/
  layout.tsx            # renders {children} and {modal}
  page.tsx
  [id]/page.tsx         # full page
  @modal/
    default.tsx         # returns null
    (.)[id]/page.tsx    # intercepted: renders <Dialog> with same detail component
```

Same `WorkflowDetail` server component in both. Only do this when the requirement is real; it adds complexity.

### 10.3 Dynamic segments

`[id]`, `[...slug]`, `[[...slug]]`. `generateStaticParams` only for public content you'd cache anyway.

### 10.4 Metadata

`export const metadata` (static) or `export async function generateMetadata({ params })` in the page.

### 10.5 Navigation

`<Link>` everywhere; `useRouter().push` only after mutations. `next/form`'s `<Form action="/search">` for GET search forms that should navigate.

---

## 11. File uploads

Do not stream files through Server Actions (1 MB default body limit, ties up the server).

1. Client asks a Server Action `getUploadUrl({ filename, contentType })` → returns a presigned PUT URL (S3 / R2 / Vercel Blob / UploadThing).
2. Client `fetch(url, { method: 'PUT', body: file })` directly to storage.
3. Client calls Server Action `attachFile({ key, workflowId })` → DB row created.

For tiny files (avatars < 1 MB) a Server Action receiving `formData.get('file') as File` is acceptable; set `experimental.serverActions.bodySizeLimit` if slightly larger.

---

## 12. Toasts and feedback

- `sonner` via shadcn `<Toaster />` in root layout.
- Button actions (§5.2B, §5.6): toast directly from the `startTransition` callback.
- `useActionState` forms (§5.1): show inline errors from `state`; for success toasts when you _don't_ redirect:

```tsx
useEffect(() => { if (state?.ok) toast.success(state.message ?? 'Saved'); }, [state]);
```

- Never toast for validation errors — show them inline next to the field.

---

## 13. Real-time

Order of escalation:

1. `refetchInterval` polling with TanStack Query (§7.4). Covers 90% of "live" needs.
2. Server-Sent Events via a Route Handler returning a `ReadableStream` — one-way updates (progress bars, notifications).
3. WebSockets — only for bidirectional/chat; use a managed service (Pusher, Ably, Supabase Realtime) rather than hosting your own socket server in Next.

---

## 14. Data-fetching from external APIs (not your DB)

Same rules as §4: fetch in Server Components / query functions. `fetch()` in Server Components is uncached by default in Next 15+; add `'use cache'` on the wrapping function when the third-party data is shareable. Keep API keys in `env`, never in Client Components. If the client needs it, proxy through a Route Handler.

---

## 15. Testing (minimum viable)

- **Unit**: Zod schemas and pure helpers (Vitest).
- **Actions**: call the action function directly in Vitest with a test DB (Prisma against a Docker Postgres) and a mocked `requireUser`.
- **E2E**: Playwright for the 3–5 critical flows (sign in, create X, delete X).
- Skip component snapshot tests.

---

## 16. Deployment checklist

- [ ] `prisma migrate deploy` runs in the build/release step, `prisma generate` in `postinstall`.
- [ ] `env.ts` parses at build — missing var fails the build.
- [ ] Connection pooling (Prisma Postgres, PgBouncer, Neon pooler) if serverless.
- [ ] `proxy.ts` matcher excludes `/api/webhooks` and static files.
- [ ] `error.tsx` at `app/(app)/` and `not-found.tsx` at root.
- [ ] Rate limit public Server Actions (login, signup, contact) — Upstash Ratelimit keyed by IP inside the action.
- [ ] Logging: `console.error` in `mapPrismaError` at minimum; wire Sentry (`@sentry/nextjs`) before launch.

---

## 17. Adding a new feature — the 8-step recipe (~1–2 hours for a CRUD entity)

1. `prisma/schema.prisma`: add model → `npx prisma migrate dev --name add_x` (5 min).
2. `features/x/schemas.ts`: Zod create/update schemas (5 min).
3. `features/x/queries.ts`: `listX`, `getX` with `requireUser` + owner scoping (10 min).
4. `features/x/actions.ts`: `createX` (formData), `updateX`, `deleteX` (typed args) using the §5.0 skeleton (20 min).
5. `app/(app)/x/page.tsx` + `loading.tsx` + `[id]/page.tsx` + `not-found.tsx` (15 min).
6. `features/x/components/`: list (server), form (`useActionState`), delete button (`useTransition`) (30 min).
7. Wire `revalidatePath` targets and `redirect` (5 min).
8. Manual test: create → see in list → edit → delete → refresh page (10 min).

Only after step 8 ask: do I need search/pagination (§4.3)? optimistic (§5.3)? TanStack Query (§7)? Add one at a time.

---

## 18. Anti-patterns to reject on sight

|Don't|Do instead|
|---|---|
|`useEffect` + `fetch` for page data|Server Component reads it|
|`'use client'` on a page/layout|Push it to the leaf component|
|Server Action without `requireUser()`|§5.0 step 1, always|
|Server Action that trusts `id` from the client|`where: { id, ownerId }`|
|Throwing errors for validation|`return fail(...)`|
|`redirect()` inside `try/catch`|Move it after the try|
|Prisma import in a Client Component|`server-only` guard; pass data as props|
|Filters in `useState`|URL searchParams|
|TanStack Query for everything|§7 decision list only|
|Route Handler for your own form submit|Server Action|
|Passing `Date` objects to client components|ISO string / number|
|`router.refresh()` as the way to update after a mutation|`revalidatePath` inside the action|
|Business logic in `app/`|`features/<domain>/`|
|`'use cache'` on user-specific queries|Leave dynamic|