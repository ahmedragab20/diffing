// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { formatMockupReview } from '../mockup-format.js'
import type { Mockup, MockupComment } from '../mockup-types.js'

function buildMockup(): Mockup {
  return {
    id: 'm1',
    title: 'Landing',
    screens: [{ id: 'main', label: 'Main', html: '<h1>Hi</h1>' }],
    createdAt: 0,
    updatedAt: 0,
    version: 2,
    decision: 'changes-requested',
    decisionComment: '  fix hero  ',
    versions: [
      {
        version: 1,
        title: 'Landing v1',
        screens: [{ id: 'main', label: 'Main', html: '<h1>Hi</h1>' }],
        createdAt: 0,
      },
      {
        version: 2,
        title: 'Landing',
        screens: [{ id: 'main', label: 'Main', html: '<h1>Hi</h1>' }],
        createdAt: 0,
      },
    ],
    comments: [
      {
        id: 'c1',
        screenId: 'main',
        kind: 'section',
        target: 'hero',
        selector: '[data-diffing="hero"]',
        fingerprint: 'fp:abcd1234',
        html: '<button class="pay">Pay $148</button>',
        contextHtml: '<section data-diffing="hero">…</section>',
        snapshot: 'Pay $148',
        sectionX: 42,
        sectionY: 65,
        body: 'Hero copy is too long',
        status: 'open',
        severity: 'blocking',
        createdAt: 0,
        createdAtMockupVersion: 2,
        replies: [],
      },
      {
        id: 'c2',
        screenId: 'main',
        kind: 'point',
        x: 72,
        y: 18,
        body: 'What does this button do?',
        status: 'open',
        severity: 'question',
        createdAt: 0,
        createdAtMockupVersion: 1,
        replies: [
          {
            id: 'r1',
            body: 'It opens settings',
            createdAt: 0,
            role: 'agent',
            model: 'opus',
          },
        ],
      },
    ],
  }
}

function comment(overrides: Partial<MockupComment>): MockupComment {
  return {
    id: 'c',
    screenId: 'main',
    kind: 'block',
    body: 'b',
    status: 'open',
    createdAt: 0,
    createdAtMockupVersion: 2,
    replies: [],
    ...overrides,
  }
}

describe('formatMockupReview', () => {
  it('emits a compact handoff: open comments on the current version only, no location context or instructions', () => {
    const xml = formatMockupReview(buildMockup())

    expect(xml).toContain('<mockup-review>')
    expect(xml).toContain('</mockup-review>')
    expect(xml).toContain('id="m1"')
    expect(xml).toContain('title="Landing"')
    expect(xml).toContain('version="2"')
    expect(xml).toContain('decision="changes-requested"')
    expect(xml).toContain(
      '<decision-comment><![CDATA[fix hero]]></decision-comment>',
    )

    // section comment: target anchor + blocking severity + scope attrs
    expect(xml).toContain('kind="section"')
    expect(xml).toContain('target="hero"')
    expect(xml).toMatch(/<comment[^>]*severity="blocking"/)
    expect(xml).toContain('mockup-version="2"')
    expect(xml).toContain('viewport="desktop"')
    expect(xml).toContain('fingerprint="fp:abcd1234"')
    expect(xml).toContain('section-x="42%"')
    expect(xml).toContain('section-y="65%"')
    expect(xml).toContain('<body><![CDATA[Hero copy is too long]]></body>')

    // compact: current version scope only — the v1 comment is not handed off
    expect(xml).not.toContain('id="c2"')
    expect(xml).not.toContain('kind="point"')

    // compact: no instructions, no clipped anchor html
    expect(xml).not.toContain('<instructions>')
    expect(xml).not.toContain('<location>')
    expect(xml).not.toContain('<html><![CDATA[')
    expect(xml).not.toContain('viewing-version=')
  })

  it('full format (instructions=true) adds the instruction block and location context', () => {
    const xml = formatMockupReview(buildMockup(), { instructions: true })

    expect(xml).toContain('<instructions>')
    expect(xml).toContain(
      'You are an AI coding assistant receiving a human review of an HTML mockup',
    )
    expect(xml).toContain('<location>')
    expect(xml).toContain(
      '<html><![CDATA[<button class="pay">Pay $148</button>]]></html>',
    )
    expect(xml).toContain('<context-html><![CDATA[')
    expect(xml).toContain('<snapshot><![CDATA[')
    // still scoped to the current version — v1 comment stays out
    expect(xml).not.toContain('id="c2"')
  })

  it('filters comments to the viewing version on historical review', () => {
    const xml = formatMockupReview(buildMockup(), { viewingVersion: 1 })

    expect(xml).toContain('viewing-version="1"')
    // historical title is rendered
    expect(xml).toContain('title="Landing v1"')
    // only the comment created on version 1 survives
    expect(xml).toContain('id="c2"')
    expect(xml).toContain('kind="point"')
    expect(xml).toContain('x="72%"')
    expect(xml).toContain('y="18%"')
    expect(xml).toMatch(/<comment[^>]*severity="question"/)
    expect(xml).toContain('<body><![CDATA[What does this button do?]]></body>')
    expect(xml).toContain('<reply id="r1"')
    expect(xml).toContain('<![CDATA[It opens settings]]>')
    expect(xml).not.toContain('id="c1"')
    expect(xml).not.toContain('target="hero"')
    expect(xml).not.toContain('severity="blocking"')
  })

  it('legacy comments (no viewport) anchor on desktop; version+screen+viewport filter the handoff', () => {
    const m: Mockup = {
      ...buildMockup(),
      version: 2,
      comments: [
        // legacy: no viewport field at all
        comment({ id: 'legacy', body: 'legacy', createdAtMockupVersion: 2 }),
        comment({
          id: 'mobile',
          viewport: 'mobile',
          body: 'mobile',
          createdAtMockupVersion: 2,
        }),
        comment({
          id: 'checkout',
          screenId: 'checkout',
          body: 'checkout',
          createdAtMockupVersion: 2,
        }),
        // resolved comments never surface
        comment({
          id: 'done',
          status: 'resolved',
          body: 'done',
          createdAtMockupVersion: 2,
        }),
        // older versions never surface on the current handoff
        comment({ id: 'old', body: 'old', createdAtMockupVersion: 1 }),
      ],
    }

    // default: every open current-version comment, regardless of viewport/screen
    const all = formatMockupReview(m)
    for (const id of ['legacy', 'mobile', 'checkout']) {
      expect(all).toContain(`id="${id}"`)
    }
    expect(all).not.toContain('id="done"')
    expect(all).not.toContain('id="old"')
    // legacy comment renders the desktop viewport attribute
    expect(all).toMatch(/<comment[^>]*id="legacy"[^>]*viewport="desktop"/)

    // focused viewport: only that viewport, and the mockup element carries it
    const mobileOnly = formatMockupReview(m, { focusedViewport: 'mobile' })
    expect(mobileOnly).toContain('id="mobile"')
    expect(mobileOnly).not.toContain('id="legacy"')
    expect(mobileOnly).not.toContain('id="checkout"')
    expect(mobileOnly).toContain('viewport="mobile"')

    // focused screen: only that screen
    const checkoutOnly = formatMockupReview(m, { focusedScreen: 'checkout' })
    expect(checkoutOnly).toContain('id="checkout"')
    expect(checkoutOnly).not.toContain('id="legacy"')
    expect(checkoutOnly).not.toContain('id="mobile"')
    expect(checkoutOnly).toContain('screen="checkout"')

    // screen + viewport together
    const combo = formatMockupReview(m, {
      focusedScreen: 'main',
      focusedViewport: 'desktop',
    })
    expect(combo).toContain('id="legacy"')
    expect(combo).not.toContain('id="mobile"')
    expect(combo).not.toContain('id="checkout"')
  })
})
