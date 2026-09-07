export {
  execBash,
  killProcessTree,
  shellQuote,
  sanitizeEnv,
  redactSensitiveOutput,
  NON_INTERACTIVE_ENV,
  DEFAULT_PRESERVED_ENV,
  SENSITIVE_ENV_PATTERN,
  SENSITIVE_OUTPUT_PATTERNS,
  type ExecBashOptions,
  type ExecBashResult,
} from "../platform/process/exec.ts"
