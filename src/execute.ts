import { Action, ActionTransaction, ChainClients, ConfigExecution } from './type';

const executeSingleChainAction = async (
  chainName: string,
  transaction: ActionTransaction,
  clients: ChainClients,
  actionIndex: number,
  totalActions: number,
  config: ConfigExecution,
): Promise<number> => {
  let retry = 0;
  while (true) {
    console.log(`Action #${actionIndex} (${totalActions}) on chain "${chainName}" started [${transaction.nonce}] ⏳`);
    if (retry > 0) {
      console.log(`This action execution is retry #${retry}, i.e. previous attempt has failed`);
    }

    try {
      const from = clients.wallet.account.address;
      const nonce = await clients.public.getTransactionCount({ address: from });

      if (nonce === transaction.nonce) {
        console.log(`Executing action #${actionIndex} (${totalActions}) on chain "${chainName}":`);
        console.log(`- nonce: ${transaction.nonce}`);
        if (transaction.to != null) {
          console.log(`- to: ${transaction.to}`);
        }
        if (transaction.data != null) {
          console.log(`- data: ${transaction.data}`);
        }
        if (transaction.value != null) {
          console.log(`- value: ${transaction.value}`);
        }

        const hash = await clients.wallet.sendTransaction({
          nonce: transaction.nonce,
          to: transaction.to,
          data: transaction.data,
          value: transaction.value,
        });
        console.log(`Action #${actionIndex} (${totalActions}) on chain "${chainName}" transaction sent:`);
        console.log(`- hash: ${hash}`);

        const receipt = await clients.public.waitForTransactionReceipt({ hash });
        console.log(`Action #${actionIndex} (${totalActions}) on chain "${chainName}" transaction receipt:`);
        console.log(`- hash: ${hash}`);
        console.log(`- block: ${receipt.blockNumber}`);
        console.log(`- gas used: ${receipt.gasUsed}`);
        console.log(`- gas price: ${receipt.effectiveGasPrice}`);
        if (receipt.contractAddress) {
          console.log(`- contract: ${receipt.contractAddress}`);
        }
      } else if (nonce > transaction.nonce) {
        console.log(
          `On-chain nonce [${nonce}] is ahead of nonce [${transaction.nonce}] of action #${actionIndex} ` +
            `(${totalActions}) on chain "${chainName}" ⚠️`,
        );
        console.log('Assuming this action has been executed and thus will advance to next action');
        console.log(
          'Reminder: nonces must be preserved for deploy, interference cannot be detected by this tool - ' +
            'thus, may mess up deploy',
        );
      } else {
        // nonce < atx.nonce
        console.log(
          `On-chain nonce [${nonce}] is behind of nonce [${transaction.nonce}] of action #${actionIndex} ` +
            `(${totalActions}) on chain "${chainName}" ⚠️`,
        );
        console.log('This might be due to slow on-chain state sync and will fix itself after some enforced retries');
        console.log(
          `After ${config.nonceBehindRetries} retries the issue assumed to be due to on-chain revert - ' +
          'thus, will retreat to previous action`,
        );
        if (retry < config.nonceBehindRetries) {
          throw new Error('On-chain nonce is behind action nonce');
        }

        console.log(
          `Action #${actionIndex} (${totalActions}) on chain "${chainName}" retreated [${transaction.nonce}] ⚠️`,
        );
        return transaction.nonce - nonce; // Retreat
      }

      console.log(
        `Action #${actionIndex} (${totalActions}) on chain "${chainName}" finished [${transaction.nonce}] ✅`,
      );
      return 1; // Advance
    } catch (e) {
      console.log(`Action #${actionIndex} (${totalActions}) on chain "${chainName}" failed [${transaction.nonce}] ❌`);
      console.log('Action error:', e);
      console.log(`Action will be executed again as retry #${++retry} after ${config.retryDelay} ms delay 💤`);
      await new Promise((r) => setTimeout(r, config.retryDelay));
    }
  }
};

const executeSingleChainActions = async (
  chainName: string,
  actions: readonly Action[],
  clients: ChainClients,
  config: ConfigExecution,
): Promise<void> => {
  console.log(`Execution of ${actions.length} actions on chain "${chainName}" started [${clients.nonce}] ⏳`);
  for (let index = 0; index < actions.length; ) {
    const delta = await executeSingleChainAction(
      chainName,
      actions[index].transaction,
      clients,
      index,
      actions.length,
      config,
    );
    index += delta;
    if (index < 0) {
      index = 0;
    }
  }
  console.log(`Execution of ${actions.length} actions on chain "${chainName}" finished [${clients.nonce}] ✅`);
};

export const executeChainActions = async (
  chainActions: ReadonlyMap<string, readonly Action[]>,
  chainClients: ReadonlyMap<string, ChainClients>,
  config: ConfigExecution,
): Promise<void> => {
  console.log();
  console.log(`Executing actions for ${chainActions.size} chains:`);
  for (const chainName of chainActions.keys()) {
    const actions = chainActions.get(chainName)!;
    const clients = chainClients.get(chainName)!;
    console.log(`- chain "${chainName}" has ${actions.length} actions to execute [${clients.nonce}]`);
  }

  if (config.dryRun) {
    console.log();
    console.log(`Dry mode is enabled in execution config - no actual transactions sent 🏜️`);
    return;
  }

  const chainExecutions = chainActions.keys().map(async (chainName) => {
    const actions = chainActions.get(chainName)!;
    const clients = chainClients.get(chainName)!;
    await executeSingleChainActions(chainName, actions, clients, config);
  });
  await Promise.all(chainExecutions);

  console.log();
  console.log(`All actions for ${chainActions.size} chains have been executed 🏁`);
};
