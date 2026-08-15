import { describe, expect, it } from "vitest";
import { replaceDataDiffingRegion } from "../mockup-region.js";

describe("replaceDataDiffingRegion", () => {
  it("replaces inner HTML of the first matching region", () => {
    const html =
      '<section data-diffing="hero"><h1>Old</h1></section><section data-diffing="hero"><p>also</p></section>';
    const result = replaceDataDiffingRegion(html, "hero", "<h1>New</h1>");
    expect(result).toEqual({
      ok: true,
      occurrences: 2,
      html: '<section data-diffing="hero"><h1>New</h1></section><section data-diffing="hero"><p>also</p></section>',
    });
  });

  it("handles nested same-tag wrappers", () => {
    const html =
      '<div data-diffing="card"><div class="inner"><p>x</p></div></div>';
    const result = replaceDataDiffingRegion(html, "card", "<span>y</span>");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toBe(
        '<div data-diffing="card"><span>y</span></div>',
      );
    }
  });

  it("accepts single-quoted attributes and extra attrs", () => {
    const html = `<aside id="rail" data-diffing='nav' class="x"><a>A</a></aside>`;
    const result = replaceDataDiffingRegion(html, "nav", "<a>B</a>");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toBe(
        `<aside id="rail" data-diffing='nav' class="x"><a>B</a></aside>`,
      );
    }
  });

  it("errors when the region is missing", () => {
    expect(replaceDataDiffingRegion("<p>x</p>", "hero", "y")).toEqual({
      ok: false,
      error: 'Region "hero" not found',
    });
  });

  it("errors on a void element", () => {
    const result = replaceDataDiffingRegion(
      '<img data-diffing="hero" src="x.png">',
      "hero",
      "y",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("void");
  });

  it("errors when the closer is missing", () => {
    const result = replaceDataDiffingRegion(
      '<section data-diffing="hero"><h1>oops',
      "hero",
      "y",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no matching");
  });
});
