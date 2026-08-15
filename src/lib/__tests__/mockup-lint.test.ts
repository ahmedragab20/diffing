import { describe, expect, it } from "vitest";
import {
  detectGenericStyle,
  detectInPageState,
  formatSubmitHints,
  lintMockupScreens,
} from "../mockup-lint.js";

describe("detectInPageState", () => {
  it("flags tabs (role, aria-selected, data-toggle)", () => {
    expect(
      detectInPageState(
        '<div role="tablist"><button role="tab" aria-selected="true">A</button></div>',
      ),
    ).toContain("tabs");
    expect(detectInPageState('<a data-toggle="tab" href="#x">X</a>')).toContain(
      "tabs",
    );
  });

  it("flags accordion/collapse (details/summary, data-toggle=collapse)", () => {
    expect(
      detectInPageState("<details><summary>Open</summary></details>"),
    ).toContain("accordion");
    expect(
      detectInPageState('<button data-toggle="collapse">Toggle</button>'),
    ).toContain("accordion");
  });

  it("flags modals and dropdowns by role/class", () => {
    expect(detectInPageState('<div role="dialog">…</div>')).toContain("modal");
    expect(detectInPageState('<div class="dropdown-menu">…</div>')).toContain(
      "dropdown",
    );
  });

  it("flags toggle/switch by role and class", () => {
    expect(detectInPageState('<button role="switch">…</button>')).toContain(
      "toggle",
    );
    expect(detectInPageState('<label class="switch">…</label>')).toContain(
      "toggle",
    );
  });

  it("does NOT flag a plain form checkbox (a real input, not a state toggle)", () => {
    expect(detectInPageState('<input type="checkbox" name="agree" />')).toEqual(
      [],
    );
  });

  it("returns an empty list for clean html", () => {
    expect(
      detectInPageState("<section><h1>Hi</h1><p>Content</p></section>"),
    ).toEqual([]);
  });
});

describe("lintMockupScreens", () => {
  it("returns one hint per offending screen with a message", () => {
    const hints = lintMockupScreens([
      { id: "main", html: '<div role="tablist">…</div>' },
      { id: "clean", html: "<p>ok</p>" },
    ]);
    expect(hints).toHaveLength(1);
    expect(hints[0].screenId).toBe("main");
    expect(hints[0].patterns).toContain("tabs");
    expect(hints[0].message).toContain("Split each state into its own screen");
  });

  it("returns empty for all-clean screens", () => {
    expect(lintMockupScreens([{ id: "main", html: "<p>ok</p>" }])).toEqual([]);
  });

  it("flags CDN Tailwind, Google Fonts, and Inter+indigo as style hints", () => {
    const hints = lintMockupScreens([
      {
        id: "main",
        html: '<script src="https://cdn.tailwindcss.com"></script><link href="https://fonts.googleapis.com/css2?family=Inter">',
      },
      {
        id: "hero",
        html: '<p style="font-family: Inter, sans-serif; color: #6366f1">Hi</p>',
      },
    ]);
    expect(hints.map((h) => h.kind)).toEqual(["style", "style"]);
    expect(hints[0].patterns).toEqual(
      expect.arrayContaining(["tailwind-cdn", "google-fonts"]),
    );
    expect(hints[1].patterns).toContain("generic-palette");
  });

  it("does not flag Inter without indigo, or indigo without Inter", () => {
    expect(
      detectGenericStyle('<p style="font-family: Inter">ok</p>'),
    ).toEqual([]);
    expect(detectGenericStyle('<p class="text-indigo-600">ok</p>')).toEqual([]);
  });
});

describe("formatSubmitHints", () => {
  it("groups state and style separately", () => {
    const text = formatSubmitHints([
      {
        screenId: "main",
        kind: "state",
        patterns: ["tabs"],
        message: "split",
      },
      {
        screenId: "main",
        kind: "style",
        patterns: ["tailwind-cdn"],
        message: "generic",
      },
    ]);
    expect(text).toContain("In-page state UI");
    expect(text).toContain("Generic styling");
    expect(text).toContain("tabs");
    expect(text).toContain("tailwind-cdn");
  });
});
