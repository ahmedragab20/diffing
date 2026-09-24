// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { isLineVisible } from "../diffRows";

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

it("accepts a visible line near the document top without assuming an 80px toolbar", () => {
  const row = document.createElement("div");
  document.body.append(row);
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 20, bottom: 42, height: 22 } as DOMRect);
  expect(isLineVisible(row)).toBe(true);
});

it("rejects a line hidden underneath its actual sticky file header, across shadow DOM", () => {
  const card = document.createElement("div");
  card.className = "file-diff-card";
  const header = document.createElement("div");
  header.className = "file-diff-card-header";
  const host = document.createElement("div");
  card.append(header, host);
  document.body.append(card);
  const row = document.createElement("div");
  host.attachShadow({ mode: "open" }).append(row);
  vi.spyOn(header, "getBoundingClientRect").mockReturnValue({ bottom: 120 } as DOMRect);
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 122, height: 22 } as DOMRect);
  expect(isLineVisible(row)).toBe(false);
});
