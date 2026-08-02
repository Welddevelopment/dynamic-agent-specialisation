import { digest } from "../core/canonical.js";
import { RealisticProcurementCompany, RealisticProcurementVerifier } from "../worlds/realistic-procurement-company.js";

export async function runRealisticProcurementCampaign({ suites, unseenCases = [], strategies }) {
  const cases = [
    ...suites.development.map((testCase) => ({ split: "development", testCase })),
    ...suites.validation.map((testCase) => ({ split: "validation", testCase })),
    ...suites.adversarial.map((testCase) => ({ split: "adversarial", testCase })),
    ...unseenCases.map((testCase) => ({ split: "unseen", testCase })),
  ];
  const results = [];
  for (const strategy of strategies) {
    for (const { split, testCase } of cases) {
      const world = new RealisticProcurementCompany({ task: testCase, loseWriteResponseFor: testCase.executionFault });
      const verifier = new RealisticProcurementVerifier({ task: testCase, initialState: world.initial });
      let resolution;
      try { resolution = await strategy.run(world, testCase); }
      catch (error) { resolution = { kind: "error", blocker: error.message, actions: [] }; }
      const verification = await verifier.verify({ externalState: world.externalState(), resolution });
      results.push({ strategyId: strategy.id, split, caseId: testCase.id, passed: verification.passed, verification });
    }
  }
  const summaries = strategies.map((strategy) => {
    const rows = results.filter((result) => result.strategyId === strategy.id);
    return {
      strategyId: strategy.id,
      passed: rows.filter((row) => row.passed).length,
      total: rows.length,
      successRate: rows.length ? rows.filter((row) => row.passed).length / rows.length : 0,
      splitResults: Object.fromEntries(["development", "validation", "adversarial", "unseen"].map((split) => {
        const splitRows = rows.filter((row) => row.split === split);
        return [split, { passed: splitRows.filter((row) => row.passed).length, total: splitRows.length }];
      })),
    };
  });
  return { campaignHash: digest(results), cases: cases.length, strategies: strategies.length, results, summaries };
}
