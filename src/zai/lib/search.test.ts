import assert from "node:assert/strict";
import test from "node:test";
import { normalizeArabic, matchesQuery, countMatches } from "./search.ts";

test("normalizeArabic strips tashkeel and unifies hamza/ta-marbuta variants", () => {
  assert.equal(normalizeArabic("السَّلَامُ عَلَيْكُمْ"), "السلام عليكم");
  assert.equal(normalizeArabic("إسلام أحمد آدم"), "اسلام احمد ادم");
  assert.equal(normalizeArabic("مدرسة"), "مدرسه");
  assert.equal(normalizeArabic("مقهى"), "مقهي");
});

test("matchesQuery ignores tashkeel/hamza differences between query and haystack", () => {
  assert.ok(matchesQuery("أهلاً وسهلاً بك", "اهلا"));
  assert.ok(matchesQuery("السلام عليكم", "السَّلَام"));
  assert.ok(!matchesQuery("مرحبا", "وداعا"));
});

test("matchesQuery treats an empty query as matching everything", () => {
  assert.ok(matchesQuery("أي نص", ""));
});

test("countMatches counts non-overlapping normalized occurrences", () => {
  assert.equal(countMatches("القط قط صغير والقط الآخر كبير", "قط"), 3);
  assert.equal(countMatches("لا يوجد تطابق هنا", "غير موجود"), 0);
});
