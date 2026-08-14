// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  injectMockupProbe,
  buildMockupProbeScript,
  MOCKUP_PROBE_FLAG,
} from "../mockup-document.js";

describe("injectMockupProbe", () => {
  it("wraps html with the data-diffing-probe script", () => {
    const out = injectMockupProbe("<html><body><h1>Hi</h1></body></html>");
    expect(out).toContain(`<script ${MOCKUP_PROBE_FLAG}="1">`);
    expect(out).toContain("window.__diffingMockupProbe");
    // location metadata emitted by the probe
    expect(out).toContain("clipHtml");
    expect(out).toContain("sectionX");
    // document content survives
    expect(out).toContain("<h1>Hi</h1>");
  });

  it("inserts the script inside <head> when one is present", () => {
    const html =
      "<!doctype html><html><head><title>T</title></head><body><h1>Hi</h1></body></html>";
    const out = injectMockupProbe(html);
    const headIdx = out.indexOf("<head>");
    const scriptIdx = out.indexOf(`<script ${MOCKUP_PROBE_FLAG}="1">`);
    const headCloseIdx = out.indexOf("</head>");
    expect(scriptIdx).toBeGreaterThan(headIdx);
    expect(scriptIdx).toBeLessThan(headCloseIdx);
  });

  it("still injects the script into a bare fragment", () => {
    const out = injectMockupProbe("<h1>Hi</h1>");
    expect(out.startsWith(`<script ${MOCKUP_PROBE_FLAG}="1">`)).toBe(true);
    expect(out).toContain("<h1>Hi</h1>");
  });

  it("passes the per-document nonce and viewport into the probe script", () => {
    const out = injectMockupProbe("<h1>Hi</h1>", {
      nonce: "doc-nonce-1",
      viewport: "mobile",
    });
    expect(out).toContain('const NONCE = "doc-nonce-1";');
    expect(out).toContain('const VIEWPORT = "mobile";');
  });
});

describe("buildMockupProbeScript", () => {
  it("defaults to an empty nonce and the desktop viewport", () => {
    const script = buildMockupProbeScript();
    expect(script).toContain('const NONCE = "";');
    expect(script).toContain('const VIEWPORT = "desktop";');
  });

  it("embeds the served document nonce and viewport so every event echoes them", () => {
    const script = buildMockupProbeScript({
      nonce: "n-42",
      viewport: "tablet",
    });
    expect(script).toContain('const NONCE = "n-42";');
    expect(script).toContain('const VIEWPORT = "tablet";');
    // every posted event carries nonce + viewport
    expect(script).toContain("event: event, nonce: NONCE, viewport: VIEWPORT");
  });

  it("section misses post section-miss/hover-miss instead of degrading to a block", () => {
    const script = buildMockupProbeScript();
    // section tool: no tagged ancestor → explicit miss events, never a block payload
    expect(script).toContain("post('section-miss')");
    expect(script).toContain("post('hover-miss')");
    // the block path is never reached for a section-tool miss
    const sectionHandler = script.slice(script.indexOf("tool === 'section'"));
    expect(sectionHandler).toContain("section-miss");
  });

  it("computes a stable section-relative block selector and structural fingerprint", () => {
    const script = buildMockupProbeScript();
    expect(script).toContain("function sectionRelativeSelector");
    // selector is anchored at the nearest [data-diffing] root and never climbs above it
    expect(script).toContain("root + ' > ' + parts.join(' > ')");
    expect(script).toContain("fingerprintOf(sel)");
    expect(script).toContain("'fp:'");
  });

  it("block payloads carry a section-relative selector + fingerprint", () => {
    const script = buildMockupProbeScript();
    const blockStart = script.indexOf("// block");
    const blockEnd = script.indexOf(
      "const sel = hitEl ? shortSelector(hitEl)",
      blockStart,
    );
    const blockBranch = script.slice(blockStart, blockEnd);
    expect(blockBranch).toContain("selector: sel");
    expect(blockBranch).toContain("fingerprint: fingerprintOf(sel)");
  });

  it("pin payloads record coordinates + context only — no selector or fingerprint", () => {
    const script = buildMockupProbeScript();
    const pointStart = script.indexOf("if (kind === 'point') {");
    const blockStart = script.indexOf("// block", pointStart);
    const pointBranch = script.slice(pointStart, blockStart);
    // the point branch reuses the shared base (kind/target/coords) and adds
    // clipped context only — never a deep locator
    expect(pointBranch).toContain("Object.assign(base, {");
    expect(pointBranch).not.toContain("selector:");
    expect(pointBranch).not.toContain("fingerprint:");
  });

  it("installs a fixed transparent pointer-capture shield, resolves inspected nodes via elementFromPoint while the shield is temporarily non-interactive, and reserves a stable scrollbar gutter", () => {
    const script = buildMockupProbeScript();

    // Shield: fixed, full-viewport, transparent, layered above the mockup, and
    // capturing pointer events so authored :hover/click never targets the mockup DOM.
    expect(script).toMatch(/position\s*:\s*'?fixed'?/);
    expect(script).toMatch(/inset\s*:\s*'?0'?/);
    expect(script).toMatch(/transparent|opacity\s*:\s*0/);
    expect(script).toMatch(/zIndex|z-index/);
    expect(script).toMatch(/pointer-events|pointerEvents/);

    // Hits resolve through elementFromPoint while the shield is temporarily
    // non-interactive (pointer-events: none), then the shield is restored so
    // it keeps intercepting pointer events.
    expect(script).toContain(
      "document.elementFromPoint(ev.clientX, ev.clientY)",
    );
    expect(script).toMatch(
      /pointerEvents\s*=\s*'none'|pointer-events\s*:\s*none/,
    );

    // Stable scrollbar gutter so layout does not shift between interactions.
    expect(script).toMatch(/scrollbar-gutter|scrollbarGutter/);
    expect(script).toContain("stable");
  });
});
