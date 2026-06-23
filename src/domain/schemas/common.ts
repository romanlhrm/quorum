import { z } from "zod";

/** The four review dimensions a reviewer can be specialised on. */
export const Concern = z.enum(["correctness", "security", "performance", "maintainability"]);
export type Concern = z.infer<typeof Concern>;

/** Finding severity, ordered most→least serious. */
export const Severity = z.enum(["critical", "high", "medium", "low", "info"]);
export type Severity = z.infer<typeof Severity>;

/** Verifier verdict on a single finding. */
export const Outcome = z.enum(["upheld", "refuted"]);
export type Outcome = z.infer<typeof Outcome>;
