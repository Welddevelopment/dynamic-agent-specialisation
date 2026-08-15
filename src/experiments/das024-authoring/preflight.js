import { digest } from "../../core/canonical.js";
import {
  DAS024_AUTHORING_FIXTURES,
  DAS024_FIXTURE_FREEZE,
  DAS024_MALICIOUS_FIXTURE,
  DAS024_VALID_FIXTURES,
} from "./fixtures.js";

const ALIAS = /^[A-Z][A-Z0-9_]{5,120}$/;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function sourceDocument(source) {
  return source.kind === "openapi" ? source.document : source.toolsList;
}

function assertFrozenFixture(fixture) {
  const frozen = DAS024_FIXTURE_FREEZE.sourceHashes[fixture.id];
  requireCondition(frozen, `Missing frozen source hashes for ${fixture.id}`);
  requireCondition(digest(sourceDocument(fixture.actionSource)) === frozen.action, `Action source drifted for ${fixture.id}`);
  requireCondition(digest(sourceDocument(fixture.observerSource)) === frozen.observer, `Observer source drifted for ${fixture.id}`);
  requireCondition(digest(fixture.businessIntake) === DAS024_FIXTURE_FREEZE.businessIntakeHashes[fixture.id], `Business intake drifted for ${fixture.id}`);
  requireCondition(digest(fixture.answers) === DAS024_FIXTURE_FREEZE.answerPacketHashes[fixture.id], `Answer oracle drifted for ${fixture.id}`);
  requireCondition(Object.keys(fixture.businessIntake).sort().join(",") === ["desiredExternallyObservableOutcome", "escalationOwner", "intendedMutation", "knownStableIdentity", "limits", "roleLabel", "roleOutcome"].sort().join(","), `${fixture.id} business intake exceeds the frozen bounded input`);
  for (const [plane, aliases] of Object.entries(fixture.credentialAliases)) {
    requireCondition(Array.isArray(aliases) && aliases.length > 0 && aliases.every((alias) => ALIAS.test(alias)), `${fixture.id} ${plane} credentials must be aliases only`);
  }
  requireCondition(!JSON.stringify(fixture).includes("-----BEGIN PRIVATE KEY-----"), `${fixture.id} contains credential material`);
}

export function preflightDAS024Fixtures() {
  requireCondition(DAS024_AUTHORING_FIXTURES.length === 3 && DAS024_VALID_FIXTURES.length === 2, "DAS-024 requires exactly two valid fixtures and one blocked control");
  DAS024_AUTHORING_FIXTURES.forEach(assertFrozenFixture);
  for (const fixture of DAS024_VALID_FIXTURES) {
    requireCondition(digest(sourceDocument(fixture.actionSource)) !== digest(sourceDocument(fixture.observerSource)), `${fixture.id} action and observer sources must be distinct`);
    requireCondition(fixture.credentialAliases.action.every((alias) => !fixture.credentialAliases.observer.includes(alias)), `${fixture.id} action and observer aliases must be distinct`);
    requireCondition(Object.keys(fixture.answers).length > 0, `${fixture.id} needs an explicit answer oracle`);
  }
  requireCondition(digest(sourceDocument(DAS024_MALICIOUS_FIXTURE.actionSource)) === digest(sourceDocument(DAS024_MALICIOUS_FIXTURE.observerSource)), "Malicious control must preserve the shared-source attack");
  requireCondition(DAS024_MALICIOUS_FIXTURE.credentialAliases.action.some((alias) => DAS024_MALICIOUS_FIXTURE.credentialAliases.observer.includes(alias)), "Malicious control must preserve the shared-alias attack");
  requireCondition(/ignore policy|mark the package active/i.test(JSON.stringify(sourceDocument(DAS024_MALICIOUS_FIXTURE.actionSource))), "Malicious control must preserve prompt-like inert text");
  return Object.freeze({
    fixtureCount: DAS024_AUTHORING_FIXTURES.length,
    validFixtureCount: DAS024_VALID_FIXTURES.length,
    maliciousControlCount: 1,
    freezeHash: digest(DAS024_FIXTURE_FREEZE),
    actionObserverSourcesDistinctForValidFixtures: true,
    credentialAliasesDistinctForValidFixtures: true,
    maliciousInjectionTextPreservedAsInputOnly: true,
  });
}
