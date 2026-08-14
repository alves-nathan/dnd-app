const path = require('node:path');

const TACTICAL_MOBILE_CLOSURE_FLOWS = [
  '.maestro/flows/91-tactical-initiative-round.yaml',
  '.maestro/flows/92-tactical-sap-concentration.yaml',
  '.maestro/flows/93-tactical-opportunity-war-caster.yaml',
  '.maestro/flows/94-tactical-ready-spell-slot.yaml'
];

const tacticalMobileClosureArtifactRoot = (platform = 'android') =>
  path.join('artifacts', 'tactical-mobile-closure', platform);

module.exports = {
  TACTICAL_MOBILE_CLOSURE_FLOWS,
  tacticalMobileClosureArtifactRoot
};
