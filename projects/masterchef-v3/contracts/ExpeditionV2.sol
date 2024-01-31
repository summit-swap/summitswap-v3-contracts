// SPDX-License-Identifier: MIT

pragma solidity 0.8.2;

import "./ElevationHelper.sol";
import "./SummitToken.sol";
import "./EverestToken.sol";
import "./PresetPausable.sol";
import "./interfaces/ISubCart.sol";
import "./SummitGlacier.sol";
import "./BaseEverestExtension.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/*
---------------------------------------------------------------------------------------------
--   S U M M I T . D E F I
---------------------------------------------------------------------------------------------


Summit is highly experimental.
It has been crafted to bring a new flavor to the defi world.
We hope you enjoy the Summit.defi experience.
If you find any bugs in these contracts, please claim the bounty on immunefi.com


Created with love by Architect and the Summit team





---------------------------------------------------------------------------------------------
--   E X P E D I T I O N   E X P L A N A T I O N
---------------------------------------------------------------------------------------------


Expeditions offer a reward for holders of Summit.
Stake SUMMIT or SUMMIT LP (see MULTI-STAKING) in an expedition for a chance to win stablecoins and other high value tokens.
Expedition pots build during the week from passthrough staking usdc and deposit fees

Deposits open 24 hours before a round closes, at which point deposits are locked, and the winner chosen
After each round, the next round begins immediately (if the expedition hasn't ended)

Expeditions take place on the weekends, and each have 3 rounds (FRI / SAT / SUN)
Two DEITIES decide the fate of each round:


DEITIES (COSMIC BULL vs COSMIC BEAR):
    . Each round has a different chance of succeeding, between 50 - 90%
    . If the expedition succeeds, COSMIC BULL earns the pot, else COSMIC BEAR steals it
    
    . COSMIC BULL is a safer deity, always has a higher chance of winning
    . Users are more likely to stake with the safer deity so it's pot will be higher, thus the winnings per SUMMIT staked lower

    . COSMIC BEAR is riskier, with a smaller chance of winning, potentially as low as 10%
    . Users are less likely to stake with BULL as it may be outside their risk tolerance to shoot for a small % chance of win

    . Thus BEAR will usually have less staked, making it both riskier, and more rewarding on win

    . The SUMMIT team expect that because switching between DEITIES is both free and unlimited,
        users will collectively 'arbitrage' the two deities based on the chance of success.

    . For example, if a round's chance of success is 75%, we expect 75% of the staked funds in the pool to be with BULL (safer)
        though this is by no means guaranteed


MULTI-STAKING
    . Users can stake both their SUMMIT token and SUMMIT LP token in an expedition
    . This prevents users from needing to break and re-make their LP for every expedition
    . SUMMIT and SUMMIT LP can be staked simultaneously
    . Both SUMMIT and SUMMIT LP can be elevated into and out of the Expedition
    . The equivalent amount of SUMMIT within the staked SUMMIT LP is treated as the SUMMIT token, and can earn winnings
    . The equivalent amount of SUMMIT in staked SUMMIT LP is determined from the SUMMIT LP pair directly
    . We have also added summitLpEverestIncentiveMult (between 1X - 2X) which can increase the equivalent amount of SUMMIT in SUMMIT LP (updated on a 72 hour timelock)
    . summitLpEverestIncentiveMult will be updated to ensure users are willing to stake their SUMMIT LP rather than break it (this may never be necessary and will be actively monitored)

WINNINGS:
    . The round reward is split amongst all members of the winning DEITY, based on their percentage of the total amount staked in that deity
    . Calculations section omitted because it is simply division
    . Users may exit the pool at any time without fee
    . Users are not forced to collect their winnings between rounds, and are entered into the next round automatically (same deity) if they do not exit





Users select a totem, either a plains or mesa totem
When users harvest game tokens they are transferred to this contract
Users receive a point for each summit they've earned in the farms
Points are spread out over 24 rounds (1 or 2 days maybe)
Every harvest updates the spread and contribution 
Function callable by MCV3 that updates users 'points' and pulls the Summit in


*/



contract ExpeditionV2 is Ownable, ReentrancyGuard, BaseEverestExtension, PresetPausable {
    using SafeERC20 for IERC20;

    // ---------------------------------------
    // --   V A R I A B L E S
    // ---------------------------------------

    bool public ejected = false;

    SummitToken public summit;
    IMasterChefV3 public masterChefV3;

    uint256 public expeditionDeityWinningsMult = 125;
    uint256 public expeditionRunwayRounds = 30;

    uint256 public roundDuration = 2 hours;
    uint256 public roundNumber = 0;
    uint256 public roundEndTimestamp;                                    // Time at which each elevation's current round ends
    uint256 public harvestRoundSpread = 24; // Harvested SUMMIT gamed over 2 days

    mapping(uint8 => mapping(uint256 => uint256)) public totemWinsAccum;    // Accumulator of the total number of wins for each totem
    mapping(uint8 => mapping(uint256 => uint8)) public winningTotem;        // The specific winning totem for each elevation round

    mapping(uint8 => uint256) totemSupply;
    mapping(uint8 => uint256) elevationSupply;
    mapping(uint8 => mapping(uint256 => uint256)) totemRoundSupplyChange;
    mapping(uint8 => mapping(uint256 => uint256)) elevationRoundSupplyChange;

    mapping(uint8 => mapping(uint256 => uint256)) totemRoundMult;

    uint8 constant roundEndLockoutDuration = 120;

    struct UserYieldInfo {
        address user;
        uint256 roundSpread; // Default 24, options are 12 / 24 / 48 / 96
        uint256 expirationRound; // Round at which the users spread will expire

        uint8 totem; // 0 for no selection, 100 101 for plains, 200 201 202 203 204 for mesa

        uint256 prevInteractedRound;
        uint256 debt;

        uint256 roundSupply;
        uint256 unTotemedYield;

        uint256 lifetimeSupply;
        uint256 lifetimeWinnings;
    }

    mapping(address => UserYieldInfo) userInfo;

    // Rewards
        // If ejected unplayed summit points
        // minRound = Min(expirationRound, currentRound)
        // ((totemRoundMult of users totem using minRound) - debt) / 1e18

    // Actions
    // Harvest
        // Harvest winnings
    // switchTotem
        // Ensure lockout isn't active
        // Harvest winnings
        // If is initial totem selection
            // Perform everything done in receiveHarvest
        // If elevation changes
            // Remove supply from prev elev, add to new elev
            // Remove expiration adjustment from prev elev, add to new elev
        // Update debt to new totem's debt
    // receiveHarvest
        // Harvest winnings
        // Check if plainsTotem or mesaTotem is selected
        // Calculate points remaining (pts / round * rounds remaining)
        // Add new points
        // Perform spread over next rounds
        // Add supply expiration info to elevation round struct
    

    // How to update the amount of summit in the round after the 24 rounds have passed and the user expired
        // By round, struct to store how much summit will expire at the end of that round
        // Plains round 64 supply adjustment (-12)
        // Plains round 65 supply adjustment (-30)
        // When supply or suppliedRound changes, remove the previous adjustment from the future round, add the new adjustment
        // User's 10 summit per round expires in 5 rounds, harvest 240 summit, remove +5 round -10 adjustment, add +24 round -20 adjustment

    // Round locks for last 2 minutes before rollover
        // User's can't switch their totem but everything else should be fine

    // Round rollover
        // Totem mult of winning totem increased by gambled supply / supply of winning totem
        // Totem supply updated with round delta markers
        // Elevation supply updated with round delta markers
    
    struct UserTokenInteraction {
        uint256 safeDebt;
        uint256 deityDebt;
        uint256 lifetimeWinnings;
    }
    struct UserExpeditionInfo {
        address user;

        // Entry Requirements
        uint256 everestOwned;
        uint8 deity;
        bool deitySelected;
        uint256 deitySelectionRound;
        uint8 safetyFactor;
        bool safetyFactorSelected;

        // Expedition Interaction
        bool entered;
        uint256 prevInteractedRound;

        uint256 safeSupply;
        uint256 deitiedSupply;

        UserTokenInteraction summit;
        UserTokenInteraction usdc;
    }
    mapping(address => UserExpeditionInfo) public userExpeditionInfo;        // Users running staked information

    struct ExpeditionToken {
        IERC20 token;
        uint256 roundEmission;
        uint256 emissionsRemaining;
        uint256 markedForDist;
        uint256 distributed;
        uint256 safeMult;
        uint256[2] deityMult;
    }
    struct ExpeditionEverestSupplies {
        uint256 safe;
        uint256 deitied;
        uint256[2] deity;
    }
    struct ExpeditionInfo {
        bool live;                          // If the pool is manually enabled / disabled
        bool launched;

        uint256 roundsRemaining;            // Number of rounds of this expedition to run.

        ExpeditionEverestSupplies supplies;

        ExpeditionToken summit;
        ExpeditionToken usdc;
    }
    ExpeditionInfo public expeditionInfo;   // Expedition info

    



    // ---------------------------------------
    // --   E V E N T S
    // ---------------------------------------

    event UserJoinedExpedition(address indexed user, uint8 _deity, uint8 _safetyFactor, uint256 _everestOwned);
    event UserHarvestedExpedition(address indexed user, uint256 _summitHarvested, uint256 _usdcHarvested);

    event ExpeditionEmissionsRecalculated(uint256 _roundsRemaining, uint256 _summitEmissionPerRound, uint256 _usdcEmissionPerRound);
    event ExpeditionFundsAdded(address indexed token, uint256 _amount);
    event ExpeditionDisabled();
    event ExpeditionEnabled();
    event Rollover(address indexed user);
    event DeitySelected(address indexed user, uint8 _deity, uint256 _deitySelectionRound);
    event SafetyFactorSelected(address indexed user, uint8 _safetyFactor);

    event SetExpeditionDeityWinningsMult(uint256 _deityMult);
    event SetExpeditionRunwayRounds(uint256 _runwayRounds);
    





    // ---------------------------------------
    // --  A D M I N I S T R A T I O N
    // ---------------------------------------


    /// @dev Constructor, setting address of cartographer
    constructor(
        address _summit,
        address _masterChefV3,
    ) {
        require(_summit != address(0), "Summit required");
        require(_masterChefV3 != address(0), "MasterChefV3 required");
        summit = SummitToken(_summit);
        masterChefV3 = IMasterChefV3(_masterChefV3);
    }

        /// @dev Turns on the Summit ecosystem across all contracts
    /// @param _enableTimestamp Timestamp at which Summit was enabled, used to set unlock points for each elevation
    function enable(uint256 _enableTimestamp)
        public
        onlyOwner
    {
        // The next top of hour from the enable timestamp
        uint256 nextTwoHourTimestamp = _enableTimestamp + (2 hours - (_enableTimestamp % 2 hours));

        // The first 'round' ends when the elevation unlocks
        roundEndTimestamp = nextTwoHourTimestamp;
    }






    // ------------------------------------------------------
    // --   M O D I F I E R S 
    // ------------------------------------------------------

    function _validuser(address _user) internal pure {
        require(_user != address(0), "User address is zero");
    }
    modifier validuser(address _user) {
        _validuser(_user);
        _;
    }
    modifier interactionsAvailable() {
        require(roundEndTimestamp != 0 && block.timestamp >= (roundEndTimestamp - roundEndLockoutDuration), "Locked until rollover");
        _;
    }
    




    // ---------------------------------------
    // --   U T I L S (inlined for brevity)
    // ---------------------------------------


    function supply()
        public view
        returns (uint256, uint256, uint256, uint256)
    {
        return (
            expeditionInfo.supplies.safe,
            expeditionInfo.supplies.deitied,
            expeditionInfo.supplies.deity[0],
            expeditionInfo.supplies.deity[1]
        );
    }





    // ---------------------------------------
    // --   E X P E D   M A N A G E M E N T
    // ---------------------------------------


    /// @dev Recalculate and set emissions of single reward token
    /// @return Whether this token has some emissions
    function _recalculateExpeditionTokenEmissions(ExpeditionToken storage expedToken)
        internal
        returns (bool)
    {
        uint256 fund = expedToken.token.balanceOf(address(this)) - expedToken.markedForDist;

        expedToken.emissionsRemaining = fund;
        expedToken.roundEmission = fund == 0 ? 0 : fund / expeditionRunwayRounds;

        return fund > 0;
    }


    /// @dev Recalculate and set expedition emissions
    function _recalculateExpeditionEmissions()
        internal
    {
        bool summitFundNonZero = _recalculateExpeditionTokenEmissions(expeditionInfo.summit);
        bool usdcFundNonZero = _recalculateExpeditionTokenEmissions(expeditionInfo.usdc);
        expeditionInfo.roundsRemaining = (summitFundNonZero || usdcFundNonZero) ? expeditionRunwayRounds : 0;
    }
    function recalculateExpeditionEmissions()
        public
        onlyOwner
    {
        _recalculateExpeditionEmissions();
        emit ExpeditionEmissionsRecalculated(expeditionInfo.roundsRemaining, expeditionInfo.summit.roundEmission, expeditionInfo.usdc.roundEmission);
    }

    /// @dev Add funds to the expedition
    function addExpeditionFunds(address _token, uint256 _amount)
        public
        nonReentrant
    {
        require (_token == address(expeditionInfo.summit.token) || _token == address(expeditionInfo.usdc.token), "Invalid token to add to expedition");
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);

        emit ExpeditionFundsAdded(_token, _amount);
    }

    /// @dev Turn off an expedition
    function disableExpedition()
        public
        onlyOwner
    {
        require(expeditionInfo.live, "Expedition already disabled");
        expeditionInfo.live = false;

        emit ExpeditionDisabled();
    }

    /// @dev Turn on a turned off expedition
    function enableExpedition()
        public
        onlyOwner
    {
        require(!expeditionInfo.live, "Expedition already enabled");
        expeditionInfo.live = true;

        emit ExpeditionEnabled();
    }



    // ---------------------------------------
    // --   P O O L   R E W A R D S
    // ---------------------------------------
    
    function pendingRewards(address _user)
        public view
        validuser(_user)
        returns (uint256, uint256)
    {
        // Calculate and return the harvestable winnings for this expedition
        return _harvestableWinnings(userExpeditionInfo[_user]);
    }


    function _calculateEmissionMultipliers()
        internal view
        returns (uint256, uint256, uint256, uint256)
    {
        // Total Supply of the expedition
        uint256 deitiedSupplyWithBonus = expeditionInfo.supplies.deitied * expeditionDeityWinningsMult / 100;
        uint256 totalExpedSupply = deitiedSupplyWithBonus + expeditionInfo.supplies.safe;
        if (totalExpedSupply == 0) return (0, 0, 0, 0);

        // Calculate safe winnings multiplier or escape if div/0
        uint256 summitSafeEmission = (expeditionInfo.summit.roundEmission * 1e18 * expeditionInfo.supplies.safe) / totalExpedSupply;
        uint256 rewardSafeEmission = (expeditionInfo.usdc.roundEmission * 1e18 * expeditionInfo.supplies.safe) / totalExpedSupply;

        // Calculate winning deity's winnings multiplier or escape if div/0
        uint256 summitDeitiedEmission = (expeditionInfo.summit.roundEmission * 1e18 * deitiedSupplyWithBonus) / totalExpedSupply;
        uint256 rewardDeitiedEmission = (expeditionInfo.usdc.roundEmission * 1e18 * deitiedSupplyWithBonus) / totalExpedSupply;

        return (
            summitSafeEmission,
            rewardSafeEmission,
            summitDeitiedEmission,
            rewardDeitiedEmission
        );
    }


    /// @dev User's staked amount, and how much they will win with that stake amount
    /// @param _user User to check
    /// @return (
    ///     guaranteedSummitYield
    ///     guaranteedUSDCYield
    ///     deitiedSummitYield
    ///     deitiedUSDCYield
    /// )
    function potentialWinnings(address _user)
        public view
        validuser(_user)
        returns (uint256, uint256, uint256, uint256)
    {
        UserExpeditionInfo storage user = userExpeditionInfo[_user];

        if (!user.entered || !expeditionInfo.live || !expeditionInfo.launched) return (0, 0, 0, 0);

        uint256 userSafeEverest = _getUserSafeEverest(user, user.safetyFactor);
        uint256 userDeitiedEverest = _getUserDeitiedEverest(user, user.safetyFactor);

        (uint256 summitSafeEmissionMultE18, uint256 usdcSafeEmissionMultE18, uint256 summitDeitiedEmissionMultE18, uint256 usdcDeitiedEmissionMultE18) = _calculateEmissionMultipliers();

        return(
            expeditionInfo.supplies.safe == 0 ? 0 : ((summitSafeEmissionMultE18 * userSafeEverest) / expeditionInfo.supplies.safe) / 1e18,
            expeditionInfo.supplies.safe == 0 ? 0 : ((usdcSafeEmissionMultE18 * userSafeEverest) / expeditionInfo.supplies.safe) / 1e18,
            expeditionInfo.supplies.deity[user.deity] == 0 ? 0 : ((summitDeitiedEmissionMultE18 * userDeitiedEverest) / expeditionInfo.supplies.deity[user.deity]) / 1e18,
            expeditionInfo.supplies.deity[user.deity] == 0 ? 0 : ((usdcDeitiedEmissionMultE18 * userDeitiedEverest) / expeditionInfo.supplies.deity[user.deity]) / 1e18
        );
    }




    // ------------------------------------------------------------------
    // --   R O L L O V E R   E L E V A T I O N   R O U N D
    // ------------------------------------------------------------------
    
    
    /// @dev Rolling over all expeditions
    ///      Expeditions set to open (expedition.startRound == nextRound) are enabled
    ///      Expeditions set to end are disabled
    function rollover()
        public whenNotPaused
        nonReentrant
    {
        // TODO: validate rollover available
        // TODO: get winning totem
        // TODO: validate winning totem
        uint8 winningPlainsTotem = 101;
        uint8 winningMesaTotem = 203;

        // Plains
        if (totemSupply[winningPlainsTotem] > 0) {
            uint256 prevRoundMult = roundNumber == 0 ? 0 : totemRoundMult[winningPlainsTotem][roundNumber - 1];
            uint256 plainsMultIncrement = elevationSupply[100] * 1e18 / totemSupply[winningPlainsTotem];
            totemRoundMult[winningPlainsTotem][roundNumber] = prevRoundMult + plainsMultIncrement;
        }
        
        // Mesa
        if (totemSupply[winningMesaTotem] > 0) {
            uint256 prevRoundMult = roundNumber == 0 ? 0 : totemRoundMult[winningMesaTotem][roundNumber - 1];
            uint256 mesaMultIncrement = elevationSupply[200] * 1e18 / totemSupply[winningPlainsTotem];
            totemRoundMult[winningMesaTotem][roundNumber] = prevRoundMult + mesaMultIncrement;
        }

        // Update plains supplies
        elevationSupply[100] -= elevationRoundSupplyChange[100][roundNumber]; // TODO: is this the correct round?
        totemSupply[100] -= totemRoundSupplyChange[100][roundNumber];
        totemSupply[101] -= totemRoundSupplyChange[101][roundNumber];

        // Update mesa supplies
        elevationSupply[200] -= elevationRoundSupplyChange[200][roundNumber];
        totemSupply[200] -= totemRoundSupplyChange[200][roundNumber];
        totemSupply[201] -= totemRoundSupplyChange[201][roundNumber];
        totemSupply[202] -= totemRoundSupplyChange[202][roundNumber];
        totemSupply[203] -= totemRoundSupplyChange[203][roundNumber];
        totemSupply[204] -= totemRoundSupplyChange[204][roundNumber];

        // Increment round
        roundNumber += 1;

        // Update round end timestamp
        roundEndTimestamp += roundDuration;

        emit Rollover(msg.sender);
    }
    


    

    // ------------------------------------------------------------
    // --   W I N N I N G S   C A L C U L A T I O N S 
    // ------------------------------------------------------------

    /// @dev Calculation of winnings that are available to be harvested
    /// @return Total winnings for a user, including vesting on previous round's winnings (if any)
    function _harvestableWinnings(UserExpeditionInfo storage user)
        internal view
        returns (uint256 winnings)
    {
        // TODO: This needs a deeper look
        uint256 expirationRound = user.expirationRound;
        uint256 currRound = roundNumber;
        uint256 minRound = expirationRound < currRound ? expirationRound : currRound;

        uint256 userTotemMinRoundMult = _getUserTotemRoundMult(user, minRound);
        winnings = user.roundSupply * (userTotemMinRoundMult - user.debt) / 1e18;
    }

    function _harvestWinnings(UserExpeditionInfo storage user)
        internal
        returns (uint256 winnings)
    {
        winnings = _harvestableWinnings(user);

        if (winnings > 0) {
            // TODO: calculate and increment lifetimeSupply
            user.lifetimeWinnings += winnings;
            summit.safeTransfer(user.user, winnings);
        }
    }





    // ---------------------------------------
    // --   E V E R E S T
    // ---------------------------------------

    error NoTotemSelected();

    function _getTotemElevation(uint8 _totem) internal returns (uint8 elev) {
        elev = 0;
        if (_totem == 100 || _totem == 101) elev = 100;
        if (_totem >= 200 && _totem <= 204) elev = 200;
    }


    function farmYieldHarvested(address _user, uint256 _yield)
        public whenNotPaused nonReentrant
    {
        // TODO: onlyMCV3

        UserYieldInfo storage user = _getUserInfo(_user);
        if (user.totem == 0) {
            user.unTotemedYield = _yield;
            return;
        }

        uint8 elev = _getTotemElevation(user.totem);

        _harvestWinnings(user);

        uint256 unusedSupply = user.unTotemedYield; // During spread, more yield may be harvested.
        if (user.expirationRound != 0) {
            unusedSupply = (user.expirationRound - roundNumber) * user.roundSupply;

            // Remove existing supply change markers
            totemRoundSupplyChange[user.totem][user.expirationRound] -= user.roundSupply;
            elevationRoundSupplyChange[elev] -= user.roundSupply;
        }

        user.roundSupply = (_yield + unusedSupply) / user.roundSpread;
        user.expirationRound = roundNumber + user.roundSpread;
        user.debt = totemRoundMult[user.totem][roundNumber];
        user.prevInteractedRound = roundNumber;
        user.lifetimeSupply += _yield;
        if (user.unTotemedYield > 0) user.unTotemedYield = 0;

        // Add new supply change markers
        totemRoundSupplyChange[user.totem][user.expirationRound] += user.roundSupply;
        elevationRoundSupplyChange[elev] += user.roundSupply;
    }



    // ----------------------------------------------------------------------
    // --  E X P E D   D I R E C T   I N T E R A C T I O N S
    // ----------------------------------------------------------------------


    function _getUserInfo(address _user)
        internal
        returns (UserYieldInfo storage user)
    {
        user = userInfo[_user];
        if (user.user == address(0)) {
            user.user = _user;
            user.roundSpread = 24;
        }
    }

    error InvalidTotem();
    error SameTotem();


    /// @dev Select a user's deity, update the expedition's deities with the switched funds
    function selectTotem(uint8 _totem)
        public whenNotPaused nonReentrant
    {
        // TODO: only when interactions available check
        if (_totem != 100 && _totem != 101 && _totem != 200 && _totem != 201 && _totem != 202 && _totem != 203 && _totem != 204) revert InvalidTotem();

        UserYieldInfo storage user = _getUserInfo(msg.sender);
        if (_totem = user.totem) revert SameTotem();

        // Harvest any winnings in this expedition
        _harvestWinnings(user);

        if (_getTotemElevation(_totem) != _getTotemElevation(user.totem)) {
            // Move supply between elevations
            elevationSupply[_getTotemElevation(user.totem)] -= user.roundSupply;
            elevationSupply[_getTotemElevation(_totem)] += user.roundSupply;
            // Move round supply expiration markers between elevations
            elevationRoundSupplyChange[_getTotemElevation(user.totem)][user.expirationRound] -= user.roundSupply;
            elevationRoundSupplyChange[_getTotemElevation(_totem)][user.expirationRound] += user.roundSupply;
        }

        // Move supply between totems
        totemSupply[user.totem] -= user.roundSupply;
        totemSupply[_totem] += user.roundSupply;
        // Move round supply expiration markers between totems
        totemRoundSupplyChange[user.totem][user.expirationRound] -= user.roundSupply;
        totemRoundSupplyChange[_totem][user.expirationRound] += user.roundSupply;

        // Finally update totem
        user.totem = _totem;

        // Update debt and interacted round number
        user.debt = totemRoundMult[user.totem][roundNumber];
        user.prevInteractedRound = roundNumber;

        emit DeitySelected(msg.sender, _newDeity, user.deitySelectionRound);
    }
}
