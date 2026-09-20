import { beforeEach, describe, expect, it } from 'vitest';
import { debugApi, MAX_RECORDED_ERRORS, recordError } from '../src/verification/debug-api';

/**
 * The captured-error buffer is read by the e2e suites and by a developer looking at a stuck
 * session; it is not a report that goes anywhere. Its only real failure mode is growth: an error
 * that fires per frame, in a tab an installed PWA keeps open for days.
 */
describe('captured client errors stay bounded', () => {
  beforeEach(() => {
    debugApi.errors.length = 0;
  });

  it('records a distinct failure once and a repeat of it not at all', () => {
    recordError('boom');
    recordError('boom');
    recordError('other');
    recordError('boom');
    expect(debugApi.errors).toEqual(['boom', 'other', 'boom']);
  });

  it('keeps the most recent failures and drops the oldest past the cap', () => {
    for (let i = 0; i < MAX_RECORDED_ERRORS + 10; i++) recordError(`e${i}`);
    expect(debugApi.errors.length).toBe(MAX_RECORDED_ERRORS);
    expect(debugApi.errors[0]).toBe('e10');
    expect(debugApi.errors[MAX_RECORDED_ERRORS - 1]).toBe(`e${MAX_RECORDED_ERRORS + 9}`);
  });
});
