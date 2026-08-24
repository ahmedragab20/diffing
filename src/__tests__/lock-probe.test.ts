// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isReviewUiProbeResponse } from '../lib/lock-probe.js'

describe('review UI probe response', () => {
  it('accepts a successful HTML shell', () => {
    expect(isReviewUiProbeResponse({
      status: 200,
      contentType: 'text/html; charset=UTF-8',
      body: '<!DOCTYPE html><html><body><div id="root"></div></body></html>',
    })).toBe(true)
  })

  it('rejects API-only, error, and non-HTML responses', () => {
    expect(isReviewUiProbeResponse({
      status: 500,
      contentType: 'text/plain',
      body: 'Internal Server Error',
    })).toBe(false)
    expect(isReviewUiProbeResponse({
      status: 200,
      contentType: 'application/json',
      body: '{"round":0}',
    })).toBe(false)
    expect(isReviewUiProbeResponse({
      status: 200,
      contentType: 'text/html',
      body: 'not an html document',
    })).toBe(false)
  })
})
