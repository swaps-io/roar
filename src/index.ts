import { parseArgs } from './args';
import { loadConfig } from './config';
import { loadPlan } from './plan';
import { loadArtifacts } from './artifact';
import { extractChainPlans } from './chainPlan';
import { resolveChainClients } from './chainClient';
import { resolveChainSteps } from './chainStep';
import { resolveChainActions } from './chainAction';
import { executeChainActions } from './execute';
import { createDeployer } from './deployer';

const main = async (): Promise<void> => {
  const args = parseArgs();
  const config = await loadConfig(args.configPath);
  const deployer = createDeployer(config.deployer.privateKey);
  const plan = await loadPlan(args.planPath, deployer.address);
  const artifactRegistry = await loadArtifacts(args.artifactsPath);

  const chainPlans = extractChainPlans(plan);
  const chainClients = await resolveChainClients(deployer, chainPlans, args.locksPath, args.planPath);
  const chainSteps = resolveChainSteps(plan, chainPlans);
  const chainActions = resolveChainActions(chainSteps, chainClients, artifactRegistry);

  await executeChainActions(chainActions, chainClients, config.execution);
};

await main();
