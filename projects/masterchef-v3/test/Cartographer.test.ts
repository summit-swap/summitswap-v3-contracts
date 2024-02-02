/* eslint-disable no-await-in-loop */
import { assert, expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time, mineUpTo, reset, mine } from "@nomicfoundation/hardhat-network-helpers";
import { ether, constants, BN, expectRevert, expectEvent, balance } from "@openzeppelin/test-helpers"

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
import { getTimestamp, mineBlockWithTimestamp, twoHrs } from "./utils";

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

    // Deploy cartographer
    const Cartographer = await ethers.getContractFactory("Cartographer");
    const cartographer = await Cartographer.deploy(cakeToken.address, masterChefV3.address);
    const cartographerMockMCV3 = await Cartographer.deploy(cakeToken.address, admin.address)

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
    this.cartographer = cartographer;
    this.cartographerMockMCV3 = cartographerMockMCV3;
    this.pools = pools;
    this.poolAddresses = poolAddresses;
    this.cakeToken = cakeToken;
    this.liquidityAmounts = liquidityAmounts;
    this.swapRouter = pancakeV3SwapRouter;

    // await network.provider.send("evm_setAutomine", [false]);
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


    DONE Enabled
      Cannot enable if already enabled
      If not enabled, adds yield to inactiveYield, else spreads it


    DONE Cartographer <--> MCV3
      Adding cartographer to mcv3
      Ejecting cartographer from mcv3
      Adding new cartographer from mcv3
      Cannot eject cartographer if already ejected
    
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

    DONE Rollover
      DONE Can only call rollover when rollover available
      DONE injectFarmYield when locked until rollover should increment inactiveYield
      DONE Winning totem mult should be calculated correctly
      DONE Mults at end of round should be inserted into totemRoundMult mapping
      DONE Totem supplies should be updated with the expiration tickets
      DONE Round number incremented
      DONE Round end timestamp incremented
      DONE Rollover event emitted
      DONE Should work if multiple rounds have passed

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
      DONE Cannot call respread when not ejected
      Cannot rollover when ejected
      DONE injectFarmYield should send SUMMIT back to user if called when ejected
      Users can emergency withdraw correct amount of both winnings and unused yield
        summitAmountBelongToCart should go to 0
      DONE Can be ejected through Cartographer or MCV3, each should eject the other
      DONE Can only be ejected once

    Enabled
      DONE If not enabled, injectFarmYield should increment inactiveYield
      DONE Cannot call respread when not enabled

    Sweep token
      Should work for ERC20 tokens
      Should not allow SUMMIT to be swept



  */

  describe.only("Real world user flow", function () {
    context("MCV3 <--> Cartographer", function () {
      it("should be able to add cartographer to MCV3", async function () {
        await this.masterChefV3.setCartographer(this.cartographer.address);

        const mcv3cartAddress = await this.masterChefV3.Cartographer();

        assert(this.cartographer.address === mcv3cartAddress)
      });
      it("should be able to eject cartographer from MCV3", async function () {
        await this.masterChefV3.setCartographer(this.cartographer.address);

        let mcv3cartAddress = await this.masterChefV3.Cartographer();
        assert(this.cartographer.address === mcv3cartAddress)

        await this.masterChefV3.ejectCartographer();
        
        mcv3cartAddress = await this.masterChefV3.Cartographer();

        assert(mcv3cartAddress === constants.ZERO_ADDRESS)

        const cartEjected = await this.cartographer.ejected();
        assert(cartEjected)
      })
      it("should be able to self eject cartographer", async function () {
        await this.masterChefV3.setCartographer(this.cartographer.address);

        let mcv3cartAddress = await this.masterChefV3.Cartographer();
        assert(this.cartographer.address === mcv3cartAddress)

        await this.cartographer.ejectCartographer();
        
        mcv3cartAddress = await this.masterChefV3.Cartographer();

        assert(mcv3cartAddress === constants.ZERO_ADDRESS)

        const cartEjected = await this.cartographer.ejected();
        assert(cartEjected)
      })
      it("MCV3 should revert if cartographer already ejected", async function () {
        await this.masterChefV3.setCartographer(this.cartographer.address);
        await this.cartographer.ejectCartographer();
        await expect(this.masterChefV3.ejectCartographer()).to.be.revertedWith("NoCartographerToEject")
      })
      it("should revert if cartographer already ejected", async function () {
        await this.masterChefV3.setCartographer(this.cartographer.address);
        await this.cartographer.ejectCartographer();
        await expect(this.cartographer.ejectCartographer()).to.be.revertedWith("AlreadyEjected")
      })
      it("should send yield to user if ejected", async function () {
        // Ensure Cart thinks ejection is coming from MCV3 (set to admin)
        await this.cartographerMockMCV3.transferOwnership(user2.address);
        await this.cartographerMockMCV3.ejectCartographer();

        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        const summitInCart = await this.cartographerMockMCV3.summitAmountBelongToCart()
        expect(summitInCart).eq(0)

        const userInactiveYield = (await this.cartographerMockMCV3.userInfo(user1.address)).inactiveYield
        expect(userInactiveYield).eq(0)

        const userSummit = await this.cakeToken.balanceOf(user1.address)
        expect(userSummit).to.eq(ethers.utils.parseUnits("10"))
      })
      it("should revert respread if ejected", async function () {
        await this.masterChefV3.setCartographer(this.cartographer.address);
        await this.cartographer.enable();
        await this.cartographer.ejectCartographer();
        await expect(this.cartographer.respread()).to.be.revertedWith("Ejected")
      })
      it("should revert rollover when ejected", async function () {
        await this.masterChefV3.setCartographer(this.cartographer.address);
        await this.cartographer.enable();
        await this.cartographer.ejectCartographer();
        await expect(this.cartographer.rollover()).to.be.revertedWith("Ejected")
      })
    });

    context("Cartographer enable", function () {
      it("should be able to enable cartographer", async function () {
        await expect(this.cartographer.enable()).to.emit(this.cartographer, "EnableCartographer")

        const enabled = await this.cartographer.enabled()
        assert(enabled)
      });
      it("should revert if already enabled", async function () {
        await this.cartographer.enable()

        await expect(this.cartographer.enable()).to.be.revertedWith("AlreadyEnabled")
      });
      it("should set roundEndTimestamp when enabled", async function () {
        await this.cartographer.enable()

        const roundEndTimestamp = await this.cartographer.roundEndTimestamp()
        const isDivBy2Hrs = roundEndTimestamp % twoHrs

        assert(roundEndTimestamp !== 0)
        assert(isDivBy2Hrs === 0)
      });
      it("should add yield to inactiveYield if not enabled", async function () {
        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        const summitInCart = await this.cartographerMockMCV3.summitAmountBelongToCart()
        expect(summitInCart).eq(ethers.utils.parseUnits("10"))

        const userInactiveYield = (await this.cartographerMockMCV3.userInfo(user1.address)).inactiveYield
        expect(userInactiveYield).eq(ethers.utils.parseUnits("10"))
      })
      it("should spread yield if enabled", async function () {
        // Enable and set totem
        await this.cartographerMockMCV3.enable()
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)

        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        const summitInCart = await this.cartographerMockMCV3.summitAmountBelongToCart()
        expect(summitInCart).eq(ethers.utils.parseUnits("10"))

        const userInfo = await this.cartographerMockMCV3.userInfo(user1.address)

        expect(userInfo.inactiveYield).eq(0)
        expect(userInfo.roundSupply).eq(ethers.utils.parseUnits("10").div(24))
      })
      it("should revert respread when not enabled", async function () {
        await expect(this.cartographer.respread()).to.be.revertedWith("NotEnabled")
      })
    });

    context.only("Rollover", function () {
      it("should revert if cartographer not enabled", async function () {
        await expect(this.cartographerMockMCV3.rollover()).to.be.revertedWith('NotEnabled')
      });
      it("should revert if rollover not available", async function () {
        await this.cartographerMockMCV3.enable();
        await expect (this.cartographerMockMCV3.rollover()).to.be.revertedWith("RolloverNotAvailable")
      });
      it("should increment round number, round end timestamp, and emit Rollover event", async function () {
        await this.cartographerMockMCV3.enable();
        const roundEndTimestampInit = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
        
        await mineBlockWithTimestamp(roundEndTimestampInit - 20)
        await expect (this.cartographerMockMCV3.rollover()).to.be.revertedWith("RolloverNotAvailable")
        
        const roundNumberInit = parseInt(await this.cartographerMockMCV3.roundNumber(), 10)
        
        await mineBlockWithTimestamp(roundEndTimestampInit)
        await expect(this.cartographerMockMCV3.rollover()).to.emit(this.cartographerMockMCV3, "Rollover")
        
        const roundNumberFinal = parseInt(await this.cartographerMockMCV3.roundNumber(), 10)
        const roundEndTimestampFinal = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)

        console.log(`Round Number ${roundNumberInit} --> ${roundNumberFinal}, diff ${roundNumberFinal - roundNumberInit}`)
        console.log(`Round End Timestamp ${roundEndTimestampInit} --> ${roundEndTimestampFinal}, diff ${roundEndTimestampFinal - roundEndTimestampInit}`)

        expect(roundNumberFinal).to.equal(roundNumberInit + 1)
        expect(roundEndTimestampFinal).to.equal(roundEndTimestampInit + twoHrs)
      });
      it("should rollover multiple rounds successfully", async function () {
        await this.cartographerMockMCV3.enable();
        const roundEndTimestampInit = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
        const roundNumberInit = parseInt(await this.cartographerMockMCV3.roundNumber(), 10)
        
        await mineBlockWithTimestamp(roundEndTimestampInit + twoHrs)
        await expect(this.cartographerMockMCV3.rollover()).to.emit(this.cartographerMockMCV3, "Rollover")
        
        const roundNumberFinal = parseInt(await this.cartographerMockMCV3.roundNumber(), 10)
        const roundEndTimestampFinal = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)

        console.log(`Round Number ${roundNumberInit} --> ${roundNumberFinal}, diff ${roundNumberFinal - roundNumberInit}`)
        console.log(`Round End Timestamp ${roundEndTimestampInit} --> ${roundEndTimestampFinal}, diff ${roundEndTimestampFinal - roundEndTimestampInit}`)

        expect(roundNumberFinal).to.equal(roundNumberInit + 1)
        expect(roundEndTimestampFinal).to.equal(roundEndTimestampInit + twoHrs + twoHrs)
      });
      it("should handle winning mult 0 supply correctly", async function () {
        // Enable and set totem
        await this.cartographerMockMCV3.enable()
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)

        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        const prevRoundNumber = parseInt(await this.cartographerMockMCV3.roundNumber(), 10)
        const totem100MultInit = await this.cartographerMockMCV3.totemRoundMult(100, prevRoundNumber)
        const totem101MultInit = await this.cartographerMockMCV3.totemRoundMult(101, prevRoundNumber)
        
        // Rollover
        const roundEndTimestamp = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
        await mineBlockWithTimestamp(roundEndTimestamp + twoHrs)
        await this.cartographerMockMCV3.rollover()
        
        
        const totem100MultFinal = await this.cartographerMockMCV3.totemRoundMult(100, prevRoundNumber)
        const totem101MultFinal = await this.cartographerMockMCV3.totemRoundMult(101, prevRoundNumber)

        console.log(`Totem 100 mult ${totem100MultInit} --> ${totem100MultFinal}`)
        console.log(`Totem 101 mult ${totem101MultInit} --> ${totem101MultFinal}`)

        expect(totem100MultInit).eq(0)
        expect(totem100MultFinal).eq(0)
        expect(totem101MultInit).eq(0)
        expect(totem101MultFinal).eq(0) // (10 + 0) / 0 = undef
      })
      it("should calculate and insert mults correctly", async function () {
        // Enable and set totem
        await this.cartographerMockMCV3.enable()
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)
        await this.cartographerMockMCV3.connect(user2).selectTotem(101)

        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("15"))
        await this.cartographerMockMCV3.injectFarmYield(user2.address, ethers.utils.parseUnits("15"))

        const summitInCart = await this.cartographerMockMCV3.summitAmountBelongToCart()
        expect(summitInCart).eq(ethers.utils.parseUnits("25"))

        let prevRoundNumber = parseInt(await this.cartographerMockMCV3.roundNumber(), 10)
        const totem100MultInit = await this.cartographerMockMCV3.totemRoundMult(100, prevRoundNumber)
        const totem101MultInit = await this.cartographerMockMCV3.totemRoundMult(101, prevRoundNumber)
        
        // Rollover
        let roundEndTimestamp = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
        await mineBlockWithTimestamp(roundEndTimestamp + twoHrs)
        await this.cartographerMockMCV3.rollover()
        
        
        const totem100MultFinal = await this.cartographerMockMCV3.totemRoundMult(100, prevRoundNumber)
        const totem101MultFinal = await this.cartographerMockMCV3.totemRoundMult(101, prevRoundNumber)

        console.log(`@RO1: Totem 100 mult ${totem100MultInit} --> ${totem100MultFinal}`)
        console.log(`@RO1: Totem 101 mult ${totem101MultInit} --> ${totem101MultFinal}`)

        expect(totem100MultInit).eq(0)
        expect(totem100MultFinal).eq(0)
        expect(totem101MultInit).eq(0)
        expect(totem101MultFinal).eq("1666666666666666665") // (10 + 15) / 15 = 1.666...

        // Rollover again
        prevRoundNumber = parseInt(await this.cartographerMockMCV3.roundNumber(), 10)
        roundEndTimestamp = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
        await mineBlockWithTimestamp(roundEndTimestamp + twoHrs)
        await this.cartographerMockMCV3.rollover()
        
        const totem100MultFinal2 = await this.cartographerMockMCV3.totemRoundMult(100, prevRoundNumber)
        const totem101MultFinal2 = await this.cartographerMockMCV3.totemRoundMult(101, prevRoundNumber)

        console.log(`@RO2: Totem 100 mult ${totem100MultFinal} --> ${totem100MultFinal2}`)
        console.log(`@RO2: Totem 101 mult ${totem101MultFinal} --> ${totem101MultFinal2}`)

        expect(totem100MultFinal).eq(0)
        expect(totem101MultFinal).eq("1666666666666666665") // 1 * ((10 + 15) / 15 = 1.666...)
        expect(totem100MultFinal2).eq(0)
        expect(totem101MultFinal2).eq("3333333333333333330") // 2 * ((10 + 15) / 15 = 1.666...)
      });
      it("should update totem supplies correctly with expirations", async function () {
        // Enable and set totem
        await this.cartographerMockMCV3.enable()
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)

        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        const totem100SupplyInit = await this.cartographerMockMCV3.totemSupply(100)
        expect(totem100SupplyInit).to.equal(ethers.utils.parseUnits('10').div(24))

        // Rollover until penultimate round
        for (let i = 0; i < 23; i++) {
          // Rollover
          const roundEndTimestamp = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
          await mineBlockWithTimestamp(roundEndTimestamp + twoHrs)
          await this.cartographerMockMCV3.rollover()
        }

        // Users supply should still be in totem
        const totem100SupplyMid = await this.cartographerMockMCV3.totemSupply(100)
        expect(totem100SupplyMid).to.equal(ethers.utils.parseUnits('10').div(24))

        // Final Rollover
        const roundEndTimestamp = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
        await mineBlockWithTimestamp(roundEndTimestamp + twoHrs)
        await this.cartographerMockMCV3.rollover()

        // Users supply should have been removed
        const totem100SupplyFinal = await this.cartographerMockMCV3.totemSupply(100)
        expect(totem100SupplyFinal).to.equal(0)
      });
      it("should increment inactiveYield if injectFarmYield when locked until rollover", async function () {
        // Enable and set totem
        await this.cartographerMockMCV3.enable()
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)
        await this.cartographerMockMCV3.connect(user2).selectTotem(100)

        // Rollover Setup
        const roundEndTimestamp = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
        await mineBlockWithTimestamp(roundEndTimestamp + twoHrs)

        // Inject User 1 during lockout
        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        // Execute Rollover
        await this.cartographerMockMCV3.rollover()

        // Inject User 2 after lockout
        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user2.address, ethers.utils.parseUnits("10"))

        const user1Info = await this.cartographerMockMCV3.userInfo(user1.address)
        const user2Info = await this.cartographerMockMCV3.userInfo(user2.address)

        expect(user1Info.inactiveYield).to.equal(ethers.utils.parseUnits("10"))
        expect(user2Info.inactiveYield).to.equal(0)
        expect(user1Info.roundSupply).to.equal(0)
        expect(user2Info.roundSupply).to.equal(ethers.utils.parseUnits("10").div(24))
      });
    });

    context("User supply", function () {
      it("should be able to enable cartographer");
    });
  });
});
