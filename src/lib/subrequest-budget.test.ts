import { describe, expect, test } from 'bun:test';

import { resetSubrequestBudget, SUBREQUEST_LIMIT, subrequestsUsed, takeSubrequest } from './subrequest-budget';

describe('subrequest budget', () => {
  test('stops granting fetches at the limit and resets cleanly', () => {
    resetSubrequestBudget();
    for (let i = 0; i < SUBREQUEST_LIMIT; i++) expect(takeSubrequest()).toBe(true);

    expect(subrequestsUsed()).toBe(SUBREQUEST_LIMIT);
    expect(takeSubrequest()).toBe(false);
    expect(subrequestsUsed()).toBe(SUBREQUEST_LIMIT);

    resetSubrequestBudget();
    expect(subrequestsUsed()).toBe(0);
    expect(takeSubrequest()).toBe(true);
  });
});
