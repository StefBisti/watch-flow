export type FieldErrors<T> = Partial<Record<keyof T & string, string[]>>;

export type ActionResult<TData = void, TInput = Record<string, unknown>> =
  | { ok: true; data: TData; message?: string }
  | { ok: false; error: string; fieldErrors?: FieldErrors<TInput> };

export const ok = <T>(data: T, message?: string): ActionResult<T, never> => ({
  ok: true,
  data,
  message,
});

export const fail = <TInput>(
  error: string,
  fieldErrors?: FieldErrors<TInput>,
): ActionResult<never, TInput> => ({ ok: false, error, fieldErrors });
