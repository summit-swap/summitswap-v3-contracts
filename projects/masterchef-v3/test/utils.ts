import { assert, expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time, mineUpTo, reset, mine } from "@nomicfoundation/hardhat-network-helpers";
import { ether, constants, BN, expectRevert, expectEvent, balance } from "@openzeppelin/test-helpers"


export const EVM = {
  Mine: 'evm_mine',
  SetNextBlockTimestamp: 'evm_setNextBlockTimestamp',
  IncreaseTime: 'evm_increaseTime',
}

export const twoHrs = 60 * 60 * 2

export const getBlock = async() => {
  return ethers.provider.getBlock('latest')
}
export const getBlockNumber = async(): Promise<number> => {
  return (await getBlock()).number
}
export const getTimestamp = async(): Promise<number> => {
  return (await getBlock()).timestamp
}
export const setTimestamp = async(timestamp: number) => {
  const currentTimestamp = await getTimestamp()
  await network.provider.send(EVM.SetNextBlockTimestamp, [Math.max(timestamp, currentTimestamp + 2)])
}
export const mineBlock = async () => {
  await network.provider.send(EVM.Mine)
}
export const increaseTimestampAndMine = async(increment: number) => {
  await network.provider.send(EVM.IncreaseTime, [increment])
  await mineBlock()
}
export const mineBlockWithTimestamp = async (timestamp: number) => {
  await setTimestamp(timestamp)
  await mineBlock()
}
export const mineBlocks = async (blockCount: number) => {
  for (let i = 0; i < blockCount; i++) {
      await mineBlock()
  }
}
export const giveETH = async (add: string) => {
  await network.provider.send("hardhat_setBalance", [
      add,
      "0x56BC75E2D63100000",
  ]);
}
export const impersonate = async (add: string) => {
  await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [add],
  });
  return ethers.getSigner(add)
}