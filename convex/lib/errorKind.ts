// Centralized classifier for generation-task failures. Inspects an error
// payload (HTTP status from fal.ai or the message text) and returns a
// coarse `errorKind` so the UI can render a tailored retry prompt.
//
// Keep classification logic here so any agent (image/video/script/etc.)
// can call the same function and the UI's mapping table stays in one place.

export type ErrorKind =
  | "out_of_credits"
  | "model_error"
  | "timeout"
  | "rate_limited"
  | "invalid_input"
  | "unknown";

export function classifyError(opts: {
  status?: number;
  message?: string | null | undefined;
}): ErrorKind {
  const { status, message } = opts;
  const msg = (message ?? "").toLowerCase();

  if (status === 402 || /insufficient.*credit|out of credit|payment required|balance/i.test(msg)) {
    return "out_of_credits";
  }
  if (status === 408 || /timeout|timed out|deadline exceeded/i.test(msg)) {
    return "timeout";
  }
  if (status === 429 || /rate.?limit|too many requests/i.test(msg)) {
    return "rate_limited";
  }
  if (status === 400 || status === 422 || /invalid|bad request|unprocessable|input_value_error|string_too_long|max_length|size must be/i.test(msg)) {
    return "invalid_input";
  }
  if ((status && status >= 500 && status < 600) || /internal server|model error|failed to generate/i.test(msg)) {
    return "model_error";
  }
  return "unknown";
}

// Human-readable label for UI surfaces that don't want to ship their own
// translation. Pair the label with a contextual CTA at the call site.
export function errorKindLabel(kind: ErrorKind): string {
  switch (kind) {
    case "out_of_credits": return "Out of generation credits";
    case "timeout":        return "Generation timed out";
    case "rate_limited":   return "Rate limited";
    case "invalid_input":  return "Invalid generation input";
    case "model_error":    return "Model error";
    case "unknown":        return "Generation failed";
  }
}
