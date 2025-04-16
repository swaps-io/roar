import { Address, Hex } from 'viem';
import { privateKeyToAccount, privateKeyToAddress } from 'viem/accounts';
import { Deployer } from './type';

export const getDeployerAddress = (privateKey: Hex): Address => {
  return privateKeyToAddress(privateKey);
};

export const createDeployer = (privateKey: Hex): Deployer => {
  return privateKeyToAccount(privateKey);
};
