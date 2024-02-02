/* eslint-disable func-names */
/* eslint-disable no-console */
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
import { getTimestamp, giveETH, impersonate, mineBlockWithTimestamp, twoHrs } from "./utils";

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

  Info:
  
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




  Tests:

    DONE Cartographer <--> MCV3
      DONE Adding cartographer to mcv3
      DONE Ejecting cartographer from mcv3
      DONE Adding new cartographer from mcv3
      DONE Cannot eject cartographer if already ejected


    DONE Enabled
      DONE If not enabled, injectFarmYield should increment inactiveYield
      DONE Cannot call respread when not enabled


    MCV3 Harvest
      Users can update farming oasis status
      Tax taken if harvested in oasis
      Yield sent to cartographer if harvested not in oasis
      No tax taken if cartographer ejected
      Yield always sent to user if cartographer ejected


    DONE Inject Yield
      DONE should emit event InjectFarmYield
      DONE should Increment summitAmountBelongToCart
      DONE should Transfer summit back to user if ejected
      DONE If not enabled, round locked, or user doesn't have totem, should add yield to inactive yield
      DONE Should harvest current winnings
      DONE Should spread remaining yield over round spread

    Cartographer Harvest
      harvestableWinnings should be correct
      harvest should work
    
    DONE Respread (spreadYield)
      DONE Should be reverted if cart not enabled
      DONE Should be reverted if cart ejected
      DONE Should be reverted if called during round lockout
      DONE Should be reverted if user doesn't have a totem selected
      DONE Should succeed on user without position
      DONE Should accurately spread new yield + unused yield + inactive yield
      DONE Should set inactiveYield to 0
      DONE Total yield before and after should be equal (10 over 10 rounds == 5 over 20 rounds)


    DONE Supply
      DONE totemSupply, unusedUserSupply, userEnteredSupply should be correct across rounds and after expiration


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


    DONE SelectTotem
      DONE Should switch totem
      DONE Should revert if same totem
      DONE Should only accept valid totem
      DONE Should emit TotemSelected event
      DONE Should revert if round locked before rollover
      DONE Should move supply from prev totem to new totem if not expired
      DONE Should move supply expiration from prev totem to new totem
      DONE Should not move supply between totems if expired
      DONE Should not move supply expiration between totems if expired
      DONE Should not update roundSupply or expirationRound when user switches totem
      DONE Should harvest winnings and update debt to that of new totem
      DONE Should spread yield if user is selecting totem for the first time


    DONE Ejected
      DONE Cannot call ejectedWithdraw when not ejected
      DONE Cannot call respread when not ejected
      DONE Cannot rollover when ejected
      DONE injectFarmYield should send SUMMIT back to user if called when ejected
      DONE Users can emergency withdraw correct amount of both winnings and unused yield
      DONE   summitAmountBelongToCart should go to 0
      DONE Can be ejected through Cartographer or MCV3, each should eject the other
      DONE Can only be ejected once

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


    // MCV3 Harvest
    //   DONE Users should initially be farming the oasis
    //   DONE Users can update farming oasis status, emitting SetUserFarmingOasis event
    //   DONE Can update oasis tax, emitting UpdateOasisTax event, should revert if out of bounds
    //   Tax taken if harvested in oasis
    //   Yield sent to cartographer if harvested not in oasis
    //   No tax taken if cartographer ejected
    //   DONE Yield always sent to user if cartographer ejected

    context.only("MCV3 Yield", async function() {
      it("users should initially be farming the oasis", async function () {
        const farmingElevations = await this.masterChefV3.userFarmingElevations(user1.address)
        expect(farmingElevations).to.eq(false)
      })
      it("should allow users to update farming oasis status, emitting SetUserFarmingElevations event", async function() {
        await expect(this.masterChefV3.connect(user1).setFarmingElevations(true))
          .to.emit(this.masterChefV3, "SetUserFarmingElevations")
          .withArgs(user1.address, true)

        let farmingElevations = await this.masterChefV3.userFarmingElevations(user1.address)
        expect(farmingElevations).to.eq(true)
        
        await expect(this.masterChefV3.connect(user1).setFarmingElevations(false))
          .to.emit(this.masterChefV3, "SetUserFarmingElevations")
          .withArgs(user1.address, false)

        farmingElevations = await this.masterChefV3.userFarmingElevations(user1.address)
        expect(farmingElevations).to.eq(false)
      })
      it("should only allow oasis tax update within bounds (0 to 5000), success emits SetOasisTax event", async function() {
        await expect(this.masterChefV3.setOasisTax(5001)).to.be.revertedWith('InvalidOasisTax')
        await expect(this.masterChefV3.setOasisTax(3000))
          .to.emit(this.masterChefV3, "SetOasisTax")
          .withArgs(3000)
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
    })


    context("Inject Yield", async function() {
      it("should emit event InjectFarmYield", async function () {
        // Enable and set totem
        await this.cartographerMockMCV3.enable()
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)

        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await expect(this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10")))
          .to.emit(this.cartographerMockMCV3, "InjectFarmYield")
          .withArgs(user1.address, ethers.utils.parseUnits('10'))
      })
      it("should increment summitAmountBelongToCart", async function() {
        // Enable and set totem
        await this.cartographerMockMCV3.enable()
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)

        const summitAmountBelongToCartInit = await this.cartographerMockMCV3.summitAmountBelongToCart()
        expect(summitAmountBelongToCartInit).to.eq(0)
        
        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        const summitAmountBelongToCartFinal = await this.cartographerMockMCV3.summitAmountBelongToCart()
        expect(summitAmountBelongToCartFinal).to.eq(ethers.utils.parseUnits('10'))
      })
      it('should inject into inactiveYield if cartographer not enabled', async function () {
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)

        let userInfo = await this.cartographerMockMCV3.userInfo(user1.address)
        expect(userInfo.inactiveYield).to.eq(0)
        expect(userInfo.roundSupply).to.eq(0)
        
        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        userInfo = await this.cartographerMockMCV3.userInfo(user1.address)
        expect(userInfo.inactiveYield).to.eq(ethers.utils.parseUnits('10'))
        expect(userInfo.roundSupply).to.eq(0)
      })
      it('should inject into inactiveYield if user doesnt have totem selected', async function () {
        await this.cartographerMockMCV3.enable()

        let userInfo = await this.cartographerMockMCV3.userInfo(user1.address)
        expect(userInfo.inactiveYield).to.eq(0)
        expect(userInfo.roundSupply).to.eq(0)
        
        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        userInfo = await this.cartographerMockMCV3.userInfo(user1.address)
        expect(userInfo.inactiveYield).to.eq(ethers.utils.parseUnits('10'))
        expect(userInfo.roundSupply).to.eq(0)
      })
      it('should inject into inactiveYield if round lockout active', async function () {
        await this.cartographerMockMCV3.enable()
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)

        let userInfo = await this.cartographerMockMCV3.userInfo(user1.address)
        expect(userInfo.inactiveYield).to.eq(0)
        expect(userInfo.roundSupply).to.eq(0)
        
        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        userInfo = await this.cartographerMockMCV3.userInfo(user1.address)
        expect(userInfo.inactiveYield).to.eq(0)
        expect(userInfo.roundSupply).to.eq(ethers.utils.parseUnits('10').div(24))

        const roundEndTimestamp = await this.cartographerMockMCV3.roundEndTimestamp()
        await mineBlockWithTimestamp(roundEndTimestamp)

        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        userInfo = await this.cartographerMockMCV3.userInfo(user1.address)
        expect(userInfo.inactiveYield).to.eq(ethers.utils.parseUnits('10'))
        expect(userInfo.roundSupply).to.eq(ethers.utils.parseUnits('10').div(24))
      })
      it('should harvest current winnings', async function () {
        // Enable and set totem
        await this.cartographerMockMCV3.enable()
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)
        await this.cartographerMockMCV3.connect(user2).selectTotem(101)

        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("15"))
        await this.cartographerMockMCV3.injectFarmYield(user2.address, ethers.utils.parseUnits("15"))

        // Rollover
        const roundEndTimestamp = await this.cartographerMockMCV3.roundEndTimestamp()
        await mineBlockWithTimestamp(roundEndTimestamp)
        await this.cartographerMockMCV3.rollover()

        const user2PendingRewardInit = await this.cartographerMockMCV3.pendingReward(user2.address);
        expect(user2PendingRewardInit).to.be.gt(0)

        // Should harvest
        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("15"))
        await expect(this.cartographerMockMCV3.injectFarmYield(user2.address, ethers.utils.parseUnits("15")))
          .to.emit(this.cartographerMockMCV3, "HarvestedWinnings")
          .withArgs(user2.address, user2PendingRewardInit)
        const user2SummitFinal = await this.cakeToken.balanceOf(user2.address)
        expect(user2SummitFinal).to.equal(user2PendingRewardInit)
        
        // Pending Rewards should be 0 after harvest
        const user2PendingRewardFinal = await this.cartographerMockMCV3.pendingReward(user2.address);
        expect(user2PendingRewardFinal).to.eq(0)
      })
      it('should respread remaining supply and new yield', async function () {
        // Enable and set totem
        await this.cartographerMockMCV3.enable()
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)

        // Add spread yield
        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        // Rollover a few rounds to create partially unused yield
        for (let i = 0; i < 4; i++) {
          const roundEndTimestamp = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
          await mineBlockWithTimestamp(roundEndTimestamp + twoHrs)
          await this.cartographerMockMCV3.rollover()
        }

        const unusedSupply = await this.cartographerMockMCV3.userUnusedSupply(user1.address)

        // Inject yield to cause respread
        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        const totalToSpread = unusedSupply.add(ethers.utils.parseUnits('10'))

        const userInfoFinal = await this.cartographerMockMCV3.userInfo(user1.address)
        expect(userInfoFinal.inactiveYield).to.eq(0)
        expect(userInfoFinal.roundSupply).to.eq(totalToSpread.div(24))
      })
    })

    context("Rollover", function () {
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
        await expect(this.cartographerMockMCV3.rollover()).to.be.revertedWith("RolloverNotAvailable")
        
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

    context("Eject", function() {
      it("should revert ejectedWithdraw when not ejected", async function () {
        // Enable and set totem
        await this.cartographerMockMCV3.enable()
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)

        await expect(this.cartographerMockMCV3.connect(user1).ejectedWithdraw()).to.be.revertedWith("NotEjected")
      })
      it("should ejectedWithdraw correct amount (remaining spread yield + inactive yield + winnings)", async function () {
        // Enable and set totem
        await this.masterChefV3.setCartographer(this.cartographer.address);
        await this.cartographer.enable()
        await this.cartographer.connect(user1).selectTotem(101)
        await this.cartographer.connect(user2).selectTotem(100)

        await giveETH(this.masterChefV3.address)
        const mcv3signer = await impersonate(this.masterChefV3.address)

        // Inject with spread
        await this.cakeToken.transfer(this.cartographer.address, ethers.utils.parseUnits("10"))
        await this.cartographer.connect(mcv3signer).injectFarmYield(user1.address, ethers.utils.parseUnits("10"))
        await this.cakeToken.transfer(this.cartographer.address, ethers.utils.parseUnits("10"))
        await this.cartographer.connect(mcv3signer).injectFarmYield(user2.address, ethers.utils.parseUnits("10"))

        // Rollover Setup
        const roundEndTimestamp = parseInt(await this.cartographer.roundEndTimestamp(), 10)
        await mineBlockWithTimestamp(roundEndTimestamp + twoHrs)

        // Inject without spread (lockout)
        await this.cakeToken.transfer(this.cartographer.address, ethers.utils.parseUnits("10"))
        await this.cartographer.connect(mcv3signer).injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        // Rollover Execute
        await this.cartographer.rollover()
        
        // Eject
        await this.cartographer.ejectCartographer()


        // Inactive yield should be 10
        const userInfo = await this.cartographer.userInfo(user1.address)
        const { inactiveYield } = userInfo
        expect(inactiveYield).to.eq(ethers.utils.parseUnits("10"))

        // Unused supply should be inactiveYield + (10 / 24) * 23
        const userUnusedSupply = await this.cartographer.userUnusedSupply(user1.address)
        expect(userUnusedSupply).to.eq(ethers.utils.parseUnits("10").div(24).mul(23))

        // Winnings should be (10 / 24) * 2
        const pendingReward = await this.cartographer.pendingReward(user1.address)
        expect(pendingReward).to.eq(ethers.utils.parseUnits("10").div(24).mul(2))

        // Total expected
        const user1TotalWithdraw = userUnusedSupply.add(pendingReward).add(inactiveYield)

        // USER 1
        const user1SummitInit = await this.cakeToken.balanceOf(user1.address)
        const summitInCartInit = await this.cartographer.summitAmountBelongToCart()
        await this.cartographer.connect(user1).ejectedWithdraw()
        const user1SummitFinal = await this.cakeToken.balanceOf(user1.address)
        
        expect(user1SummitFinal).to.equal(userUnusedSupply.add(pendingReward).add(inactiveYield)) // Rounding error
        
        // USER 2
        const user2SummitInit = await this.cakeToken.balanceOf(user2.address)
        await this.cartographer.connect(user2).ejectedWithdraw()
        const user2SummitFinal = await this.cakeToken.balanceOf(user2.address)
        const summitInCartFinal = await this.cartographer.summitAmountBelongToCart()

        expect(user2SummitFinal).to.eq(ethers.utils.parseUnits("10").div(24).mul(23))
        
        console.log(`@U1: Unused supply ${userUnusedSupply}, pending reward ${pendingReward}, inactive yield ${inactiveYield}, TOTAL ${user1TotalWithdraw}`)
        console.log(`@U1: Summit ${user1SummitInit} --> ${user1SummitFinal}`)
        console.log(`@U2: Summit ${user2SummitInit} --> ${user2SummitFinal}`)
        console.log(`@CART: Summit ${summitInCartInit} --> ${summitInCartFinal}`)

        expect(summitInCartFinal).to.equal(summitInCartInit.sub(user1TotalWithdraw).sub(user2SummitFinal))
      })
    })

    context("User supply", function () {
      it("totemSupply, unusedUserSupply, userEnteredSupply should be correct across rounds and after expiration", async function () {
        // Enable and set totem
        await this.cartographerMockMCV3.enable()
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)

        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        let totemSupply = await this.cartographerMockMCV3.totemSupply(100);
        let unusedSupply = await this.cartographerMockMCV3.userUnusedSupply(user1.address)
        let userEnteredSupply = await this.cartographerMockMCV3.userEnteredSupply(user1.address)
        expect(totemSupply).to.eq(ethers.utils.parseUnits('10').div(24))
        expect(unusedSupply).to.eq(ethers.utils.parseUnits('10').div(24).mul(24))
        console.log(`@R_INIT totemSupply: ${totemSupply}, unusedUser ${unusedSupply}, enteredUser ${userEnteredSupply}`)

        // Rollover until penultimate round
        for (let i = 1; i <= 36; i++) {
          // Rollover
          const roundEndTimestamp = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
          await mineBlockWithTimestamp(roundEndTimestamp + twoHrs)
          await this.cartographerMockMCV3.rollover()

          // Ensure user's unused supply decreases to 0
          totemSupply = await this.cartographerMockMCV3.totemSupply(100);
          unusedSupply = await this.cartographerMockMCV3.userUnusedSupply(user1.address)
          userEnteredSupply = await this.cartographerMockMCV3.userEnteredSupply(user1.address)
          console.log(`@R${i} totemSupply: ${totemSupply}, unusedUser ${unusedSupply}, enteredUser ${userEnteredSupply}`)
          if (i < 24) {
            expect(totemSupply).to.eq(ethers.utils.parseUnits('10').div(24))
            expect(unusedSupply).to.eq(ethers.utils.parseUnits('10').div(24).mul(24 - i))
            expect(userEnteredSupply).to.eq(ethers.utils.parseUnits('10').div(24))
          } else {
            expect(totemSupply).to.eq(0)
            expect(unusedSupply).to.eq(0)
            expect(userEnteredSupply).to.eq(0)
          }
        }
      });
    });


    context("Respread (spreadYield)", function() {
      it('should be reverted if called before cartographer enabled', async function () {
        await expect(this.cartographerMockMCV3.connect(user1).respread()).to.be.revertedWith('NotEnabled')
      })
      it('should be reverted if called after cartographer ejected', async function () {
        await this.masterChefV3.setCartographer(this.cartographer.address);
        await this.cartographer.enable()
        await this.cartographer.ejectCartographer();
        await expect(this.cartographer.connect(user1).respread()).to.be.revertedWith('Ejected')
      })
      it('should be reverted if called during round lockout', async function () {
        await this.cartographerMockMCV3.enable()
        const roundEndTimestamp = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
        await mineBlockWithTimestamp(roundEndTimestamp + twoHrs)
        await expect(this.cartographerMockMCV3.connect(user1).respread()).to.be.revertedWith('RoundLocked')
      })
      it('should be reverted if user doesnt have a totem selected', async function () {
        await this.cartographerMockMCV3.enable()
        await expect(this.cartographerMockMCV3.connect(user1).respread()).to.be.revertedWith('InvalidTotem')
      })
      it('should succeed and emit event if user doesnt have a position', async function () {
        await this.cartographerMockMCV3.enable()
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)
        await expect(this.cartographerMockMCV3.connect(user1).respread())
          .to.emit(this.cartographerMockMCV3, "Respread")
          .withArgs(user1.address)
      })
      it('should accurately spread new yield + unused yield + inactive yield', async function () {
        // Enable and set totem
        await this.cartographerMockMCV3.enable()
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)

        // Add spread yield
        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        // Rollover a few rounds to create partially unused yield
        for (let i = 0; i < 4; i++) {
          const roundEndTimestamp = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
          await mineBlockWithTimestamp(roundEndTimestamp + twoHrs)
          await this.cartographerMockMCV3.rollover()
        }

        // Inject yield during round lockout to add inactive yield
        const roundEndTimestamp = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
        await mineBlockWithTimestamp(roundEndTimestamp + twoHrs)
        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        // Execute rollover
        await this.cartographerMockMCV3.rollover()

        const unusedSupply = await this.cartographerMockMCV3.userUnusedSupply(user1.address)
        const userInfoInit = await this.cartographerMockMCV3.userInfo(user1.address)
        const {inactiveYield} = userInfoInit

        // Inject yield to cause respread
        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        const totalToSpread = unusedSupply.add(inactiveYield).add(ethers.utils.parseUnits('10'))

        const userInfoFinal = await this.cartographerMockMCV3.userInfo(user1.address)
        expect(userInfoFinal.inactiveYield).to.eq(0)
        expect(userInfoFinal.roundSupply).to.eq(totalToSpread.div(24))
      })
    })


    context("Switch totem", function () {
      it("should switch totem correctly", async function() {
        // Enable and set totem
        await this.cartographerMockMCV3.enable()
        
        const totemOptions = [100, 101, 200, 201, 202, 203, 204]
        for (let i = 0; i < totemOptions.length; i++) {
          const totem = totemOptions[i]
          await this.cartographerMockMCV3.connect(user1).selectTotem(totem)
          const userInfo = await this.cartographerMockMCV3.userInfo(user1.address)
          expect(userInfo.totem).to.eq(totem)
        }
      })
      it("should revert if same totem", async function () {
        // Enable and set totem
        await this.cartographerMockMCV3.enable()
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)
        
        await expect(this.cartographerMockMCV3.connect(user1).selectTotem(100)).to.be.revertedWith("SameTotem")
      })
      it("should revert if invalid totem", async function() {
        // Enable and set totem
        await this.cartographerMockMCV3.enable()
        
        const invalidTotems = [0, 99, 102, 199, 205]
        for (let i = 0; i < invalidTotems.length; i++) {
          const totem = invalidTotems[i]
          await expect(this.cartographerMockMCV3.connect(user1).selectTotem(totem)).to.be.revertedWith("InvalidTotem")
        }
      })
      it("should emit TotemSelected event", async function () {
        // Enable and set totem
        await this.cartographerMockMCV3.enable()
        await expect(this.cartographerMockMCV3.connect(user1).selectTotem(100))
          .to.emit(this.cartographerMockMCV3, "TotemSelected")
          .withArgs(user1.address, 100)
      })
      it("should revert if round locked until rollover", async function () {
        await this.cartographerMockMCV3.enable();
        const roundEndTimestampInit = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
        
        await mineBlockWithTimestamp(roundEndTimestampInit)
        await expect(this.cartographerMockMCV3.connect(user1).selectTotem(100)).to.be.revertedWith("RoundLocked")

        await this.cartographerMockMCV3.rollover()
        await expect(this.cartographerMockMCV3.connect(user1).selectTotem(100)).to.emit(this.cartographerMockMCV3, "TotemSelected")
      })
      it("should move user's supply and supply expiration between totems", async function () {
        await this.cartographerMockMCV3.enable();
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)

        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        const userInfo = await this.cartographerMockMCV3.userInfo(user1.address)
        const userRoundSupply = userInfo.roundSupply
        const userExpirationRound = userInfo.expirationRound

        const totem100SupplyInit = await this.cartographerMockMCV3.totemSupply(100);
        const totem101SupplyInit = await this.cartographerMockMCV3.totemSupply(101);
        const totem100SupplyExpirationInit = await this.cartographerMockMCV3.totemRoundExpiringSupply(100, userExpirationRound);
        const totem101SupplyExpirationInit = await this.cartographerMockMCV3.totemRoundExpiringSupply(101, userExpirationRound);

        // SWITCH TOTEM
        await this.cartographerMockMCV3.connect(user1).selectTotem(101)

        const totem100SupplyFinal = await this.cartographerMockMCV3.totemSupply(100);
        const totem101SupplyFinal = await this.cartographerMockMCV3.totemSupply(101);
        const totem100SupplyExpirationFinal = await this.cartographerMockMCV3.totemRoundExpiringSupply(100, userExpirationRound);
        const totem101SupplyExpirationFinal = await this.cartographerMockMCV3.totemRoundExpiringSupply(101, userExpirationRound);

        console.log(`@T100: Supply ${totem100SupplyInit} --> ${totem100SupplyFinal}`)
        console.log(`@T100: Expiration ${totem100SupplyExpirationInit} --> ${totem100SupplyExpirationFinal}`)
        console.log(`@T101: Supply ${totem101SupplyInit} --> ${totem101SupplyFinal}`)
        console.log(`@T101: Expiration ${totem101SupplyExpirationInit} --> ${totem101SupplyExpirationFinal}`)

        expect(totem100SupplyInit).to.eq(userRoundSupply)
        expect(totem100SupplyFinal).to.eq(0)

        expect(totem101SupplyInit).to.eq(0)
        expect(totem101SupplyFinal).to.eq(userRoundSupply)

        expect(totem100SupplyExpirationInit).to.eq(userRoundSupply)
        expect(totem100SupplyExpirationFinal).to.eq(0)

        expect(totem101SupplyExpirationInit).to.eq(0)
        expect(totem101SupplyExpirationFinal).to.eq(userRoundSupply)
      })
      it("should not move user's supply between totems after it has expired", async function () {
        await this.cartographerMockMCV3.enable();
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)

        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        const userInfo = await this.cartographerMockMCV3.userInfo(user1.address)
        const userRoundSupply = userInfo.roundSupply
        const userExpirationRound = userInfo.expirationRound

        // Rollover past expiration
        for (let i = 1; i <= 36; i++) {
          // Rollover
          const roundEndTimestamp = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
          await mineBlockWithTimestamp(roundEndTimestamp + twoHrs)
          await this.cartographerMockMCV3.rollover()
        }

        const totem100SupplyInit = await this.cartographerMockMCV3.totemSupply(100);
        const totem101SupplyInit = await this.cartographerMockMCV3.totemSupply(101);
        const totem100SupplyExpirationInit = await this.cartographerMockMCV3.totemRoundExpiringSupply(100, userExpirationRound);
        const totem101SupplyExpirationInit = await this.cartographerMockMCV3.totemRoundExpiringSupply(101, userExpirationRound);

        await this.cartographerMockMCV3.connect(user1).selectTotem(101)

        const totem100SupplyFinal = await this.cartographerMockMCV3.totemSupply(100);
        const totem101SupplyFinal = await this.cartographerMockMCV3.totemSupply(101);
        const totem100SupplyExpirationFinal = await this.cartographerMockMCV3.totemRoundExpiringSupply(100, userExpirationRound);
        const totem101SupplyExpirationFinal = await this.cartographerMockMCV3.totemRoundExpiringSupply(101, userExpirationRound);

        console.log(`@T100: Supply ${totem100SupplyInit} --> ${totem100SupplyFinal}`)
        console.log(`@T100: Expiration ${totem100SupplyExpirationInit} --> ${totem100SupplyExpirationFinal}`)
        console.log(`@T101: Supply ${totem101SupplyInit} --> ${totem101SupplyFinal}`)
        console.log(`@T101: Expiration ${totem101SupplyExpirationInit} --> ${totem101SupplyExpirationFinal}`)

        expect(totem100SupplyInit).to.eq(0)
        expect(totem101SupplyInit).to.eq(0)

        expect(totem100SupplyFinal).to.eq(0)
        expect(totem101SupplyFinal).to.eq(0)

        // This looks weird, but we are past this round, so nothing should change here
        expect(totem100SupplyExpirationInit).to.eq(userRoundSupply)
        expect(totem100SupplyExpirationFinal).to.eq(userRoundSupply)

        expect(totem101SupplyExpirationInit).to.eq(0)
        expect(totem101SupplyExpirationFinal).to.eq(0)
      })
      it("should not update roundSupply or expirationRound when user switches totem", async function() {
        await this.cartographerMockMCV3.enable();
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)
        await this.cartographerMockMCV3.connect(user2).selectTotem(101)

        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))
        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("15"))
        await this.cartographerMockMCV3.injectFarmYield(user2.address, ethers.utils.parseUnits("15"))

        let userInfo = await this.cartographerMockMCV3.userInfo(user1.address)
        const expirationRoundInit = userInfo.expirationRound
        const roundSupplyInit = userInfo.roundSupply

        // Rollover a few rounds
        for (let i = 0; i < 4; i++) {
          // Rollover
          const roundEndTimestamp = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
          await mineBlockWithTimestamp(roundEndTimestamp + twoHrs)
          await this.cartographerMockMCV3.rollover()
        }

        // Move User1 from totem 100 to 101
        await this.cartographerMockMCV3.connect(user1).selectTotem(101)

        userInfo = await this.cartographerMockMCV3.userInfo(user1.address)
        const expirationRoundFinal = userInfo.expirationRound
        const roundSupplyFinal = userInfo.roundSupply

        expect(expirationRoundFinal).to.eq(expirationRoundInit)
        expect(roundSupplyFinal).to.eq(roundSupplyInit)
      })
      it("should harvest winnings and update debt to that of new totem", async function () {
        await this.cartographerMockMCV3.enable();
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)
        await this.cartographerMockMCV3.connect(user2).selectTotem(101)

        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))
        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("15"))
        await this.cartographerMockMCV3.injectFarmYield(user2.address, ethers.utils.parseUnits("15"))

        // Rollover a few rounds
        for (let i = 0; i < 4; i++) {
          // Rollover
          const roundEndTimestamp = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
          await mineBlockWithTimestamp(roundEndTimestamp + twoHrs)
          await this.cartographerMockMCV3.rollover()
        }

        const roundNumber = await this.cartographerMockMCV3.roundNumber()
        const totem100Mult = await this.cartographerMockMCV3.totemRoundMult(100, roundNumber - 1)
        const totem101Mult = await this.cartographerMockMCV3.totemRoundMult(101, roundNumber - 1)

        // Move User1 from totem 100 to 101
        await this.cartographerMockMCV3.connect(user1).selectTotem(101)

        // Validate User1 debt
        const user1Info = await this.cartographerMockMCV3.userInfo(user1.address)
        expect(user1Info.debt).to.eq(totem101Mult)

        // Validate User1 no pending rewards after harvest
        const user1PendingRewardFinal = await this.cartographerMockMCV3.pendingReward(user1.address)
        expect(user1PendingRewardFinal).to.eq(0)

        // Move User2 from totem 101 to 100
        const user2PendingReward = await this.cartographerMockMCV3.pendingReward(user2.address)
        const user2SummitInit = await this.cakeToken.balanceOf(user2.address)
        
        // Validate HarvestWinnings event emitted
        await expect(this.cartographerMockMCV3.connect(user2).selectTotem(100))
          .to.emit(this.cartographerMockMCV3, "HarvestedWinnings")
          .withArgs(user2.address, user2PendingReward)

        // Validate winnings harvested
        const user2SummitFinal = await this.cakeToken.balanceOf(user2.address)
        expect(user2SummitFinal.sub(user2SummitInit)).to.eq(user2PendingReward)

        // Validate User2 debt
        const user2Info = await this.cartographerMockMCV3.userInfo(user2.address)
        expect(user2Info.debt).to.eq(totem100Mult)

        // Validate User2 no pending rewards after harvest
        const user2PendingRewardFinal = await this.cartographerMockMCV3.pendingReward(user2.address)
        expect(user2PendingRewardFinal).to.eq(0)
      })
      it('should spread yield if user is selecting totem for the first time', async function() {
        await this.cartographerMockMCV3.enable();

        await this.cakeToken.transfer(this.cartographerMockMCV3.address, ethers.utils.parseUnits("10"))
        await this.cartographerMockMCV3.injectFarmYield(user1.address, ethers.utils.parseUnits("10"))

        // Rollover a few rounds
        for (let i = 0; i < 4; i++) {
          // Rollover
          const roundEndTimestamp = parseInt(await this.cartographerMockMCV3.roundEndTimestamp(), 10)
          await mineBlockWithTimestamp(roundEndTimestamp + twoHrs)
          await this.cartographerMockMCV3.rollover()
        }
        const roundNumber = parseInt(await this.cartographerMockMCV3.roundNumber(), 10)
        
        let userInfo = await this.cartographerMockMCV3.userInfo(user1.address)
        const totemInit = userInfo.totem
        const expirationRoundInit = userInfo.expirationRound
        const roundSupplyInit = userInfo.roundSupply
        const inactiveYieldInit = userInfo.inactiveYield
        const totem100SupplyInit = await this.cartographerMockMCV3.totemSupply(100)

        expect(totemInit).to.eq(0)
        expect(expirationRoundInit).to.eq(0)
        expect(roundSupplyInit).to.eq(0)
        expect(inactiveYieldInit).to.eq(ethers.utils.parseUnits('10'))
        expect(totem100SupplyInit).to.eq(0)
        
        await this.cartographerMockMCV3.connect(user1).selectTotem(100)
        
        userInfo = await this.cartographerMockMCV3.userInfo(user1.address)
        const totemFinal = userInfo.totem
        const expirationRoundFinal = userInfo.expirationRound
        const roundSupplyFinal = userInfo.roundSupply
        const inactiveYieldFinal = userInfo.inactiveYield
        const totem100SupplyFinal = await this.cartographerMockMCV3.totemSupply(100)

        expect(totemFinal).to.eq(100)
        expect(expirationRoundFinal).to.eq(roundNumber + 24 - 1)
        expect(roundSupplyFinal).to.eq(ethers.utils.parseUnits('10').div(24))
        expect(inactiveYieldFinal).to.eq(0)
        expect(totem100SupplyFinal).to.eq(ethers.utils.parseUnits('10').div(24))
      })




    });
  });
});
