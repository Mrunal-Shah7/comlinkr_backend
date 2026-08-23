/**
 * SPRINT-56: trivial smoke — runner + transform + guard wiring.
 */
describe('SPRINT-56 smoke', () => {
  it('runs under the safety-guarded Jest environment', () => {
    // SPRINT-56:
    expect(process.env.ALLOW_TEST_DATABASE).toBe('true'); // SPRINT-56:
    expect(process.env.DATABASE_URL).toMatch(/_test(\?|$)/); // SPRINT-56:
  }); // SPRINT-56:
});
