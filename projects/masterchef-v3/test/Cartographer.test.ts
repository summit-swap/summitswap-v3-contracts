import { assert } from "chai";
import { ethers, upgrades } from "hardhat";
import { time, mineUpTo, reset } from "@nomicfoundation/hardhat-network-helpers";
import { TickMath } from "@uniswap/v3-sdk";

import PancakeV3PoolDeployerArtifact from "@pancakeswap/v3-core/artifacts/contracts/PancakeV3PoolDeployer.sol/PancakeV3PoolDeployer.json";
import PancakeV3FactoryArtifact from "@pancakeswap/v3-core/artifacts/contracts/PancakeV3Factory.sol/PancakeV3Factory.json";
// import PancakeV3FactoryOwnerArtifact from "@pancakeswap/v3-core/artifacts/contracts/PancakeV3FactoryOwner.sol/PancakeV3FactoryOwner.json";
import PancakeV3SwapRouterArtifact from "@pancakeswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";
import NftDescriptorOffchainArtifact from "@pancakeswap/v3-periphery/artifacts/contracts/NonfungibleTokenPositionDescriptorOffChain.sol/NonfungibleTokenPositionDescriptorOffChain.json";
import NonfungiblePositionManagerArtifact from "@pancakeswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import PancakeV3LmPoolDeployerArtifact from "@pancakeswap/v3-lm-pool/artifacts/contracts/PancakeV3LmPoolDeployer.sol/PancakeV3LmPoolDeployer.json";
import TestLiquidityAmountsArtifact from "@pancakeswap/v3-periphery/artifacts/contracts/test/LiquidityAmountsTest.sol/LiquidityAmountsTest.json";

import ERC20MockArtifact from "./ERC20Mock.json";
import CakeTokenArtifact from "./CakeToken.json";
import SyrupBarArtifact from "./SyrupBar.json";
import MasterChefArtifact from "./MasterChef.json";
import MasterChefV2Artifact from "./MasterChefV2.json";
import MockBoostArtifact from "./MockBoost.json";

const WETH9Address = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const nativeCurrencyLabel = "tBNB";

describe("Cartographer", function () {
  let admin;
  let user1;
  let user2;

  before(async function () {
    [admin, user1, user2] = await ethers.getSigners();
  });

  beforeEach(async function () {
    reset();

    // Deploy factory
    const PancakeV3PoolDeployer = await ethers.getContractFactoryFromArtifact(PancakeV3PoolDeployerArtifact);
    const pancakeV3PoolDeployer = await PancakeV3PoolDeployer.deploy();

    const PancakeV3Factory = await ethers.getContractFactoryFromArtifact(PancakeV3FactoryArtifact);
    const pancakeV3Factory = await PancakeV3Factory.deploy(pancakeV3PoolDeployer.address);

    await pancakeV3PoolDeployer.setFactoryAddress(pancakeV3Factory.address);

    const PancakeV3SwapRouter = await ethers.getContractFactoryFromArtifact(PancakeV3SwapRouterArtifact);
    const pancakeV3SwapRouter = await PancakeV3SwapRouter.deploy(
      pancakeV3PoolDeployer.address,
      pancakeV3Factory.address,
      WETH9Address
    );

    // Deploy NFT position descriptor
    // const NonfungibleTokenPositionDescriptor = await ethers.getContractFactoryFromArtifact(
    //   NftDescriptorOffchainArtifact
    // );
    // const baseTokenUri = "https://nft.pancakeswap.com/v3/";
    // const nonfungibleTokenPositionDescriptor = await upgrades.deployProxy(NonfungibleTokenPositionDescriptor, [
    //   baseTokenUri,
    // ]);
    // await nonfungibleTokenPositionDescriptor.deployed();
    // TODO:
    await PancakeV3SwapRouter.deploy(pancakeV3PoolDeployer.address, pancakeV3Factory.address, WETH9Address);

    // Deploy NFT position manager
    const NonfungiblePositionManager = await ethers.getContractFactoryFromArtifact(NonfungiblePositionManagerArtifact);
    const nonfungiblePositionManager = await NonfungiblePositionManager.deploy(
      pancakeV3PoolDeployer.address,
      pancakeV3Factory.address,
      WETH9Address,
      // nonfungibleTokenPositionDescriptor.address
      ethers.constants.AddressZero
    );

    const ERC20Mock = await ethers.getContractFactoryFromArtifact(ERC20MockArtifact);

    // Deploy factory owner contract
    // const PancakeV3FactoryOwner = await ethers.getContractFactoryFromArtifact(PancakeV3FactoryOwnerArtifact);
    // const pancakeV3FactoryOwner = await PancakeV3FactoryOwner.deploy(pancakeV3Factory.address);
    // await pancakeV3Factory.setOwner(pancakeV3FactoryOwner.address);

    // Prepare for master chef v3
    const CakeToken = await ethers.getContractFactoryFromArtifact(CakeTokenArtifact);
    const cakeToken = await CakeToken.deploy();

    const SyrupBar = await ethers.getContractFactoryFromArtifact(SyrupBarArtifact);
    const syrupBar = await SyrupBar.deploy(cakeToken.address);

    const lpTokenV1 = await ERC20Mock.deploy("LP Token V1", "LPV1");
    const dummyTokenV2 = await ERC20Mock.deploy("Dummy Token V2", "DTV2");

    const MasterChef = await ethers.getContractFactoryFromArtifact(MasterChefArtifact);
    const masterChef = await MasterChef.deploy(
      cakeToken.address,
      syrupBar.address,
      admin.address,
      ethers.utils.parseUnits("40"),
      ethers.constants.Zero
    );

    await cakeToken.transferOwnership(masterChef.address);
    await syrupBar.transferOwnership(masterChef.address);

    await masterChef.add(0, lpTokenV1.address, true); // farm with pid 1 and 0 allocPoint
    await masterChef.add(1, dummyTokenV2.address, true); // farm with pid 2 and 1 allocPoint

    const MasterChefV2 = await ethers.getContractFactoryFromArtifact(MasterChefV2Artifact);
    const masterChefV2 = await MasterChefV2.deploy(masterChef.address, cakeToken.address, 2, admin.address);

    const MockBoost = await ethers.getContractFactoryFromArtifact(MockBoostArtifact);
    const mockBoost = await MockBoost.deploy(masterChefV2.address);

    await dummyTokenV2.mint(admin.address, ethers.utils.parseUnits("1000"));
    await dummyTokenV2.approve(masterChefV2.address, ethers.constants.MaxUint256);
    await masterChefV2.init(dummyTokenV2.address);

    const lpTokenV2 = await ERC20Mock.deploy("LP Token V2", "LPV2");
    const dummyTokenV3 = await ERC20Mock.deploy("Dummy Token V3", "DTV3");

    await masterChefV2.add(0, lpTokenV2.address, true, true); // regular farm with pid 0 and 0 allocPoint
    await masterChefV2.add(1, dummyTokenV3.address, true, true); // regular farm with pid 1 and 1 allocPoint

    // Deploy master chef v3
    const MasterChefV3 = await ethers.getContractFactory("MasterChefV3");
    const masterChefV3 = await MasterChefV3.deploy(cakeToken.address, nonfungiblePositionManager.address, WETH9Address);

    await dummyTokenV3.mint(admin.address, ethers.utils.parseUnits("1000"));
    await dummyTokenV3.approve(masterChefV2.address, ethers.constants.MaxUint256);
    await masterChefV2.deposit(1, await dummyTokenV3.balanceOf(admin.address));
    const firstFarmingBlock = await time.latestBlock();

    const PancakeV3LmPoolDeployer = await ethers.getContractFactoryFromArtifact(PancakeV3LmPoolDeployerArtifact);
    const pancakeV3LmPoolDeployer = await PancakeV3LmPoolDeployer.deploy(
      masterChefV3.address
      // pancakeV3FactoryOwner.address
    );
    // await pancakeV3FactoryOwner.setLmPoolDeployer(pancakeV3LmPoolDeployer.address);
    await pancakeV3Factory.setLmPoolDeployer(pancakeV3LmPoolDeployer.address);
    await masterChefV3.setLMPoolDeployer(pancakeV3LmPoolDeployer.address);

    // Deploy mock ERC20 tokens
    const tokenA = await ERC20Mock.deploy("Token A", "A");
    const tokenB = await ERC20Mock.deploy("Token B", "B");
    const tokenC = await ERC20Mock.deploy("Token C", "C");
    const tokenD = await ERC20Mock.deploy("Token D", "D");

    await tokenA.mint(admin.address, ethers.utils.parseUnits("1000"));
    await tokenA.mint(user1.address, ethers.utils.parseUnits("1000"));
    await tokenA.mint(user2.address, ethers.utils.parseUnits("1000"));
    await tokenB.mint(admin.address, ethers.utils.parseUnits("1000"));
    await tokenB.mint(user1.address, ethers.utils.parseUnits("1000"));
    await tokenB.mint(user2.address, ethers.utils.parseUnits("1000"));
    await tokenC.mint(admin.address, ethers.utils.parseUnits("1000"));
    await tokenC.mint(user1.address, ethers.utils.parseUnits("1000"));
    await tokenC.mint(user2.address, ethers.utils.parseUnits("1000"));
    await tokenD.mint(admin.address, ethers.utils.parseUnits("1000"));
    await tokenD.mint(user1.address, ethers.utils.parseUnits("1000"));
    await tokenD.mint(user2.address, ethers.utils.parseUnits("1000"));

    await tokenA.connect(admin).approve(pancakeV3SwapRouter.address, ethers.constants.MaxUint256);
    await tokenB.connect(admin).approve(pancakeV3SwapRouter.address, ethers.constants.MaxUint256);
    await tokenC.connect(admin).approve(pancakeV3SwapRouter.address, ethers.constants.MaxUint256);
    await tokenD.connect(admin).approve(pancakeV3SwapRouter.address, ethers.constants.MaxUint256);

    await tokenA.connect(user1).approve(nonfungiblePositionManager.address, ethers.constants.MaxUint256);
    await tokenB.connect(user1).approve(nonfungiblePositionManager.address, ethers.constants.MaxUint256);
    await tokenC.connect(user1).approve(nonfungiblePositionManager.address, ethers.constants.MaxUint256);
    await tokenD.connect(user1).approve(nonfungiblePositionManager.address, ethers.constants.MaxUint256);
    await tokenA.connect(user2).approve(nonfungiblePositionManager.address, ethers.constants.MaxUint256);
    await tokenB.connect(user2).approve(nonfungiblePositionManager.address, ethers.constants.MaxUint256);
    await tokenC.connect(user2).approve(nonfungiblePositionManager.address, ethers.constants.MaxUint256);
    await tokenD.connect(user2).approve(nonfungiblePositionManager.address, ethers.constants.MaxUint256);

    await tokenA.connect(user1).approve(masterChefV3.address, ethers.constants.MaxUint256);
    await tokenB.connect(user1).approve(masterChefV3.address, ethers.constants.MaxUint256);
    await tokenC.connect(user1).approve(masterChefV3.address, ethers.constants.MaxUint256);
    await tokenD.connect(user1).approve(masterChefV3.address, ethers.constants.MaxUint256);
    await tokenA.connect(user2).approve(masterChefV3.address, ethers.constants.MaxUint256);
    await tokenB.connect(user2).approve(masterChefV3.address, ethers.constants.MaxUint256);
    await tokenC.connect(user2).approve(masterChefV3.address, ethers.constants.MaxUint256);
    await tokenD.connect(user2).approve(masterChefV3.address, ethers.constants.MaxUint256);

    // Create pools
    const pools = [
      {
        token0: tokenA.address < tokenB.address ? tokenA.address : tokenB.address,
        token1: tokenB.address > tokenA.address ? tokenB.address : tokenA.address,
        fee: 500,
        initSqrtPriceX96: ethers.BigNumber.from("2").pow(96),
      },
      {
        token0: tokenC.address < tokenD.address ? tokenC.address : tokenD.address,
        token1: tokenD.address > tokenC.address ? tokenD.address : tokenC.address,
        fee: 500,
        initSqrtPriceX96: ethers.BigNumber.from("2").pow(96),
      },
    ];
    const poolAddresses = await Promise.all(
      pools.map(async (p) => {
        const receipt = await (
          await nonfungiblePositionManager.createAndInitializePoolIfNecessary(
            p.token0,
            p.token1,
            p.fee,
            p.initSqrtPriceX96
          )
        ).wait();
        const [, address] = ethers.utils.defaultAbiCoder.decode(["int24", "address"], receipt.logs[0].data);
        return address;
      })
    );

    // Farm 1 month in advance and then upkeep
    await mineUpTo(firstFarmingBlock + 30 * 24 * 60 * 60);
    await masterChefV2.connect(admin).deposit(1, 0);
    // const cakeFarmed = await cakeToken.balanceOf(admin.address);
    // console.log(`${ethers.utils.formatUnits(cakeFarmed)} CAKE farmed`);
    await cakeToken.approve(masterChefV3.address, ethers.constants.MaxUint256);
    await masterChefV3.setReceiver(admin.address);
    await masterChefV3.upkeep(ethers.utils.parseUnits(`${4 * 24 * 60 * 60}`), 24 * 60 * 60, true);
    // console.log(`cakePerSecond: ${ethers.utils.formatUnits((await masterChefV3.latestPeriodCakePerSecond()).div(await masterChefV3.PRECISION()))}\n`);

    const LiquidityAmounts = await ethers.getContractFactoryFromArtifact(TestLiquidityAmountsArtifact);
    const liquidityAmounts = await LiquidityAmounts.deploy();

    this.nonfungiblePositionManager = nonfungiblePositionManager;
    this.masterChefV3 = masterChefV3;
    this.pools = pools;
    this.poolAddresses = poolAddresses;
    this.cakeToken = cakeToken;
    this.liquidityAmounts = liquidityAmounts;
    this.swapRouter = pancakeV3SwapRouter;

    await network.provider.send("evm_setAutomine", [false]);
  });

  afterEach(async function () {
    await network.provider.send("evm_setAutomine", [true]);
  });

  /*

  Tests:
    Cartographer States
      Constructed
      Enabled
      Within Round
      Within Rollover Lock period
      Ejected


    User States
      No totem selected
      Totem selected
      Is active in current rounds
      Supply has been used and expired


    Supply
      User's true round supply should be 0 after supply has expired
      When supply expires, it should be removed from totemSupply
      Switching totem should move supply if it hasn't expired
      Switching totem should move supply expiration if it hasn't expired already


    Enabled
      Cannot enable if already enabled


    Cartographer <--> MCV3
      Adding cartographer to mcv3
      Ejecting cartographer from mcv3
      Adding new cartographer from mcv3
    
    Yield
      Harvesting from oasis works
      Harvesting to games works
        Increment summitAmountBelongToCart
        Transfer summit back to user if ejected
      If not enabled, round locked, or user doesn't have totem, should add yield to inactive yield
        Else should be included in total yield to be played
      Should harvest current winnings
      Should spread remaining yield over round spread

    Harvest
      harvestableWinnings should be correct
      harvest should work

    Respread (spreadYield)
      Should accurately spread new yield + unused yield + inactive yield
      Should set inactiveYield to 0
      Total yield before and after should be equal (10 over 10 rounds == 5 over 20 rounds)

    Rollover
      Can only call rollover when rollover available
      injectFarmYield when locked until rollover should increment inactiveYield
      Winning totem mult should be calculated correctly
      Mults at end of round should be inserted into totemRoundMult mapping
      Totem supplies should be updated with the expiration tickets
      Round number incremented
      Round end timestamp incremented
      Rollover event emitted
      Should work if multiple rounds have passed

    SelectTotem
      Should switch totem
      Should revert if same totem
      Should only accept valid totem
      Should revert if round locked before rollover
      Should move supply from prev totem to new totem
      Should move supply expiration from prev totem to new totem
      Should harvest winnings and update debt to that of new totem
      Should emit TotemSelected event
      Should spread yield if user is selecting totem for the first time


    Ejected
      Cannot call ejectedWithdraw when not ejected
      Cannot call respread when not ejected
      Cannot rollover when not ejected
      injectFarmYield should send SUMMIT back to user if called when ejected
      Users can emergency withdraw correct amount of both winnings and unused yield
        summitAmountBelongToCart should go to 0
      Can be ejected through Cartographer or MCV3, each should eject the other
      Can only be ejected once

    Enabled
      If not enabled, injectFarmYield should increment inactiveYield
      Cannot call respread when not enabled

    Sweep token
      Should work for ERC20 tokens
      Should not allow SUMMIT to be swept



  */

  describe("Real world user flow", function () {
    context("when there are 2 users and 2 pools with no trading", function () {
      it("should executed successfully", async function () {
        // 1
      });
    });
  });
});
