import { describe, expect, it } from "vitest";
import { extractTokensFromText } from "../design-system-extract.js";
import { InMemoryDesignSystemStore } from "../design-system.js";
import {
  wrapMockupFragment,
  resolveRenderMode,
  renderMockupHtml,
} from "../mockup-shell.js";
import { analyzeMockupHtml } from "../mockup-preview.js";
import { buildMockupHandoff, formatMockupHandoffXml } from "../mockup-handoff.js";
import { extractSuggestion } from "../mockup-suggestion.js";
import { emptyTokens } from "../design-system-types.js";

describe("extractTokensFromText", () => {
  it("maps semantic CSS variables", () => {
    const tokens = extractTokensFromText(`
      :root {
        --bg: #0b0b0c;
        --text: #f5f5f4;
        --accent: #e8b86d;
        --font-mono: "IBM Plex Mono";
      }
    `);
    expect(tokens.color.bg).toBe("#0b0b0c");
    expect(tokens.color.text).toBe("#f5f5f4");
    expect(tokens.color.accent).toBe("#e8b86d");
    expect(tokens.font.mono).toContain("IBM Plex Mono");
    expect(tokens.raw["--bg"]).toBe("#0b0b0c");
  });
});

describe("InMemoryDesignSystemStore", () => {
  it("proposes a draft and publishes a revision", async () => {
    const store = new InMemoryDesignSystemStore();
    const created = await store.upsert({
      title: "App",
      tokens: extractTokensFromText("--bg: #111; --text: #eee;"),
    });
    expect(created.status).toBe("draft");
    expect(created.revision).toBe(0);
    const published = await store.publish(created.id);
    expect(published?.status).toBe("published");
    expect(published?.revision).toBe(1);
    await store.propose(created.id, { guidelines: "Dense chrome." });
    const after = await store.get(created.id);
    expect(after?.status).toBe("draft");
    expect(after?.guidelines).toBe("Dense chrome.");
    expect(after?.revision).toBe(1);
  });
});

describe("wrapMockupFragment", () => {
  it("injects tokens and a content slot", () => {
    const html = wrapMockupFragment("<h1>Hi</h1>", {
      tokens: emptyTokens(),
      title: "Test",
    });
    expect(html).toContain("data-diffing-slot=\"content\"");
    expect(html).toContain("<h1>Hi</h1>");
    expect(html).toContain("--ds-space-unit");
  });

  it("defaults to fragment only when a system is published", () => {
    expect(resolveRenderMode(undefined, null)).toBe("document");
    expect(
      resolveRenderMode(undefined, {
        status: "published",
      } as never),
    ).toBe("fragment");
    expect(
      resolveRenderMode("document", { status: "published" } as never),
    ).toBe("document");
  });

  it("does not nest a full HTML document inside the host shell", () => {
    const full = "<!DOCTYPE html><html><body><h1>Hi</h1></body></html>";
    const out = renderMockupHtml(full, {
      mode: "fragment",
      system: { status: "published", tokens: emptyTokens(), components: [] } as never,
    });
    expect(out).toBe(full);
    expect(out.match(/<!DOCTYPE html>/gi)?.length).toBe(1);
  });
});

describe("analyzeMockupHtml", () => {
  it("flags empty image srcs and external stylesheets", () => {
    const report = analyzeMockupHtml(
      '<img src="#"><link rel="stylesheet" href="https://cdn.example/x.css">',
    );
    expect(report.missingImages).toContain("#");
    expect(report.externalStylesheets[0]).toContain("cdn.example");
  });
});

describe("handoff + suggestion", () => {
  it("builds compact handoff xml", () => {
    const handoff = buildMockupHandoff({
      id: "m1",
      title: "Settings",
      version: 2,
      decision: "approved",
      screens: [{ id: "main", label: "Main", html: "<p>x</p>" }],
      comments: [],
    } as never);
    const xml = formatMockupHandoffXml(handoff);
    expect(xml).toContain('id="m1"');
    expect(xml).toContain("Match feel");
  });

  it("extracts a suggestion fence", () => {
    expect(extractSuggestion("please use\n```suggestion\n<h1>New</h1>\n```")).toBe(
      "<h1>New</h1>",
    );
    expect(extractSuggestion("no fence")).toBeNull();
  });
});
