import { expect, test } from "bun:test";

// Toolchain smoke test — proves `bun test` + strict TS resolve before any real code.
// Superseded by the domain tests as the suite fills in.
test("toolchain is alive", () => {
  expect(1 + 1).toBe(2);
});
