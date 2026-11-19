import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesSearch } from "../src/lib/matchesSearch.ts";

test("matches full names, partial names, and initials", () => {
  assert.equal(matchesSearch("Abhishek Kumawat", "ak"), true);
  assert.equal(matchesSearch("Abhishek Kumawat", "ABHISHEK"), true);
  assert.equal(matchesSearch("Abhishek Kumawat — Editor", "kum"), true);
  assert.equal(matchesSearch("Abhishek Kumawat", "zz"), false);
});
