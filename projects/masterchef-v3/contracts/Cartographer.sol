// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./libraries/SafeCast.sol";
import "./interfaces/IMasterChefV3.sol";
import "./interfaces/ICartographer.sol";

/*
---------------------------------------------------------------------------------------------
--   S U M M I T   S W A P
---------------------------------------------------------------------------------------------


Summit Swap is highly experimental.
It has been crafted to bring a new flavor to the defi world.
We hope you enjoy the Summit.defi experience.


Created with love by Architect and the Summit team

*/



contract Cartographer is Ownable, ReentrancyGuard, ICartographer {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    IERC20 public SUMMIT;

    // If problem arises, ejecting removes the cartographer from the MasterChefV3
    // Also acts as emergency valve, allowing users to withdraw their Summit directly without playing the games
    bool public ejected = false; 
    bool public enabled = false;

    /// @notice Record the SUMMIT amount belong to MasterChefV3.
    uint256 public summitAmountBelongToCart;

    IMasterChefV3 public masterChefV3;

    uint256 public expeditionDeityWinningsMult = 125;
    uint256 public expeditionRunwayRounds = 30;

    uint256 public roundDuration = 2 hours;
    uint256 public roundNumber = 1; // Prevent any subtraction underflow errors
    uint256 public roundEndTimestamp;                                    // Time at which each elevation's current round ends
    uint256 public harvestRoundSpread = 24; // Harvested SUMMIT gamed over 2 days
    uint8 constant roundEndLockoutDuration = 120;

    mapping(uint8 => mapping(uint256 => uint256)) public totemWinsAccum;    // Accumulator of the total number of wins for each totem
    mapping(uint8 => mapping(uint256 => uint8)) public winningTotem;        // The specific winning totem for each elevation round

    mapping(uint8 => uint256) totemSupply;
    mapping(uint8 => mapping(uint256 => uint256)) totemRoundExpiringSupply;

    /// Tracks earnings for each totem as the rounds progress
    /// @dev totemRoundMult[totemId][roundNumber], roundNumber is that of the round that closed
    mapping(uint8 => mapping(uint256 => uint256)) totemRoundMult;

    struct UserYieldInfo {
        address user;
        uint256 roundSpread; // Default 24, options are 12 / 24 / 48 / 96
        uint256 expirationRound; // Round at which the users spread will expire

        uint8 totem; // 0 for no selection, 100 101 for plains, 200 201 202 203 204 for mesa

        uint256 debt;

        uint256 roundSupply;
        uint256 inactiveYield;

        uint256 lifetimeSupply;
        uint256 lifetimeWinnings;
    }

    mapping(address => UserYieldInfo) userInfo;


    event UserJoinedExpedition(address indexed user, uint8 _deity, uint8 _safetyFactor, uint256 _everestOwned);
    event UserHarvestedExpedition(address indexed user, uint256 _summitHarvested, uint256 _usdcHarvested);

    event ExpeditionEmissionsRecalculated(uint256 _roundsRemaining, uint256 _summitEmissionPerRound, uint256 _usdcEmissionPerRound);
    event ExpeditionFundsAdded(address indexed token, uint256 _amount);
    event ExpeditionDisabled();
    event ExpeditionEnabled();
    event Rollover(address indexed user);
    event TotemSelected(address indexed user, uint8 totem);

    event SetExpeditionDeityWinningsMult(uint256 _deityMult);
    event SetExpeditionRunwayRounds(uint256 _runwayRounds);

    event EnableCartographer();
    





    // ---------------------------------------
    // --  A D M I N I S T R A T I O N
    // ---------------------------------------


    /// @dev Constructor, setting address of cartographer
    constructor(
        address _summit,
        address _masterChefV3
    ) {
        if (_summit == address(0)) revert ZeroAddress();
        if (_masterChefV3 == address(0)) revert ZeroAddress();
        SUMMIT = IERC20(_summit);
        masterChefV3 = IMasterChefV3(_masterChefV3);
    }

    /// @dev Turns on the Summit ecosystem across all contracts
    function enable()
        public
        onlyOwner
    {
        if (enabled) revert AlreadyEnabled();

        // The next top of hour from the enable timestamp
        uint256 nextTwoHourTimestamp = block.timestamp + (2 hours - (block.timestamp % 2 hours));

        // The first 'round' ends when the elevation unlocks
        roundEndTimestamp = nextTwoHourTimestamp;

        enabled = true;

        emit EnableCartographer();
    }

    /// @notice can be ejected by owner here or from MCV3 eject function. 
    function ejectCartographer() public onlyOwnerOrMCV3 {
        if (ejected) revert AlreadyEjected();

        if (msg.sender == owner()) {
            masterChefV3.ejectCartographer();
        }

        ejected = true;
    }





    error ZeroAddress();
    error InvalidTotem();
    error SameTotem();
    error RoundLocked();
    error NoTotemSelected();
    error NotMCV3();
    error NotOwnerOrMCV3();
    error RolloverNotAvailable();
    error AlreadyEnabled();
    error NotEnabled();
    error AlreadyEjected();
    error NotEjected();
    error Ejected();

    modifier onlyMCV3() {
        if (msg.sender != address(masterChefV3)) revert NotMCV3();
        _;
    }

    modifier validTotem(uint8 _totem) {
        if (!((_totem >= 100 && _totem <= 101) || (_totem >= 200 && _totem <= 204))) revert InvalidTotem();
        _;
    }

    modifier roundNotLocked()  {
        if (roundEndTimestamp != 0 && block.timestamp < (roundEndTimestamp - roundEndLockoutDuration)) revert RoundLocked();
        _;
    }

    function _getIsRoundLocked() internal view returns (bool) {
        if (roundEndTimestamp == 0) return false;
        return block.timestamp > (roundEndTimestamp - roundEndLockoutDuration);
    } 
    
    modifier rolloverAvailable() {
        if (roundEndTimestamp == 0 || block.timestamp <= roundEndTimestamp) revert RolloverNotAvailable();
        _;
    }

    modifier isEnabled() {
        if (!enabled) revert NotEnabled();
        _;
    }
    modifier notEjected() {
        if (ejected) revert Ejected();
        _;
    }
    modifier onlyOwnerOrMCV3() {
        if (msg.sender != address(masterChefV3) && msg.sender != owner()) revert NotOwnerOrMCV3();
        _;
    }
    

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


    function userEnteredSupply(address _user) public view returns (uint256) {
        UserYieldInfo memory user = userInfo[_user];

        // Exit if user doesn't have a position
        if (_user != user.user) return 0;
        
        // Exit if users yield has been expired
        if (user.expirationRound < roundNumber) return 0;

        return user.roundSupply;
    }

    function userUnusedSupply(address _user) public view returns (uint256) {
        return _userUnusedSupply(_user);
    }
    function _userUnusedSupply(address _user) internal view returns (uint256) {
        UserYieldInfo memory user = userInfo[_user];

        // Exit if user doesn't have a position
        if (_user != user.user) return 0;
        
        // Exit if users yield has been expired
        if (user.expirationRound < roundNumber) return user.inactiveYield;

        return user.inactiveYield + (user.roundSupply * (user.expirationRound - roundNumber));
    }
    function userInactiveYield(address _user) public view returns (uint256) {
        UserYieldInfo memory user = userInfo[_user];

        // Exit if user doesn't have a position
        if (_user != user.user) return 0;
        
        return user.inactiveYield;
    }
    
    function pendingReward(address _user)
        public view returns (uint256)
    {
        return _harvestableWinnings(userInfo[_user]);
    }



    /// @notice Calculation of winnings that are available to be harvested
    /// @return winnings Total winnings for a user, including vesting on previous round's winnings (if any)
    function _harvestableWinnings(UserYieldInfo storage user)
        internal view
        returns (uint256 winnings)
    {
        // Winnings calculated from last harvest (where debt is set) to previous round (or expiration round if it has passed) 
        uint256 latestEarningRound = user.expirationRound < (roundNumber - 1) ? user.expirationRound : (roundNumber - 1);

        winnings = user.roundSupply * (totemRoundMult[user.totem][latestEarningRound] - user.debt) / 1e18;
    }

    function _harvestWinnings(UserYieldInfo storage user)
        internal
        returns (uint256 winnings)
    {
        winnings = _harvestableWinnings(user);

        if (winnings > 0) {
            user.lifetimeWinnings += winnings;
            _safeTransferSUMMIT(user.user, winnings);
        }
    }



    /// @notice Select a user's totem
    function selectTotem(uint8 _totem)
        public nonReentrant validTotem(_totem) roundNotLocked
    {
        UserYieldInfo storage user = _getUserInfo(msg.sender);
        if (_totem == user.totem) revert SameTotem();

        // Harvest any winnings in this expedition
        _harvestWinnings(user);

        // Move supply between totems
        totemSupply[user.totem] -= user.roundSupply;
        totemSupply[_totem] += user.roundSupply;

        // Move supply expiration between totems
        totemRoundExpiringSupply[user.totem][user.expirationRound] -= user.roundSupply;
        totemRoundExpiringSupply[_totem][user.expirationRound] += user.roundSupply;

        // Update user's totem
        user.totem = _totem;

        // Update debt to mult at end of previous round
        user.debt = totemRoundMult[user.totem][roundNumber - 1];

        emit TotemSelected(msg.sender, _totem);
    }


    function injectFarmYield(address _user, uint256 _yield) public onlyMCV3 {
        UserYieldInfo storage user = _getUserInfo(_user);

        summitAmountBelongToCart += _yield;

        // Safety valve if ejected and still receiving farm yield (should never happen, ejection should also eject from MCV3)
        if (ejected) {
            _safeTransferSUMMIT(user.user, _yield);
            return;
        }

        // If totem unselected or round is locked until rollover, add _yield to inactiveYield, to be included in the next spread operation
        if (user.totem == 0 || !enabled || _getIsRoundLocked()) {
            user.inactiveYield += _yield;
            return;
        }

        _harvestWinnings(user);
        _spreadYield(user, _yield);
    }


    function respread() public nonReentrant roundNotLocked isEnabled notEjected {
        UserYieldInfo storage user = _getUserInfo(msg.sender);
        _harvestWinnings(user);
        _spreadYield(user, 0);
    }

    function _spreadYield(UserYieldInfo storage user, uint256 _yield) internal {
        uint256 unplayedYield = 0;
        if (user.expirationRound > 0 && user.expirationRound >= roundNumber) {
            unplayedYield += (user.expirationRound - roundNumber) * user.roundSupply;
        }

        // If user has some unplayed yield (if they are on round 5/24 on their yield spread),
        //   then the current yield being played must be replaced
        if (unplayedYield > 0) {
            totemSupply[user.totem] -= user.roundSupply;
            totemRoundExpiringSupply[user.totem][user.expirationRound] -= user.roundSupply;
        }

        user.roundSupply = (_yield + user.inactiveYield + unplayedYield) / user.roundSpread;
        user.expirationRound = roundNumber + user.roundSpread;
        user.lifetimeSupply += _yield;
        if (user.inactiveYield > 0) user.inactiveYield = 0;

        // Set debt to user's totem's mult at end of last round
        user.debt = totemRoundMult[user.totem][roundNumber - 1];

        // Add supply and its expiration
        totemSupply[user.totem] += user.roundSupply;
        totemRoundExpiringSupply[user.totem][user.expirationRound] += user.roundSupply;
    }


    function rollover()
        public
        nonReentrant
        rolloverAvailable
        notEjected
    {
        // TODO: get winning totem
        uint8 winningPlainsTotem = 101;
        uint8 winningMesaTotem = 203;

        // Ensure valid totem
        if (winningPlainsTotem < 100 || winningPlainsTotem > 101) winningPlainsTotem = 100;
        if (winningMesaTotem < 200 || winningMesaTotem > 204) winningMesaTotem = 200;

        // Pull previous round's mult into current round
        totemRoundMult[100][roundNumber] = totemRoundMult[100][roundNumber - 1];
        totemRoundMult[101][roundNumber] = totemRoundMult[101][roundNumber - 1];
        totemRoundMult[200][roundNumber] = totemRoundMult[200][roundNumber - 1];
        totemRoundMult[201][roundNumber] = totemRoundMult[201][roundNumber - 1];
        totemRoundMult[202][roundNumber] = totemRoundMult[202][roundNumber - 1];
        totemRoundMult[203][roundNumber] = totemRoundMult[203][roundNumber - 1];
        totemRoundMult[204][roundNumber] = totemRoundMult[204][roundNumber - 1];

        // Add plains winnings to mult
        if (totemSupply[winningPlainsTotem] > 0) {
            uint256 elevationSupply = totemSupply[100] + totemSupply[101];
            uint256 plainsMultIncrement = elevationSupply * 1e18 / totemSupply[winningPlainsTotem];

            // Set the winning totem's mult to the mult of last round
            totemRoundMult[winningPlainsTotem][roundNumber] += plainsMultIncrement;
        }
        
        // Add mesa winnings to mult
        if (totemSupply[winningMesaTotem] > 0) {
            uint256 elevationSupply = totemSupply[200] + totemSupply[201] + totemSupply[202] + totemSupply[203] + totemSupply[204];
            uint256 mesaMultIncrement = elevationSupply * 1e18 / totemSupply[winningPlainsTotem];

            // Set the winning totem's mult to the mult of last round
            totemRoundMult[winningMesaTotem][roundNumber] += mesaMultIncrement;
        }

        // Update plains supplies
        totemSupply[100] -= totemRoundExpiringSupply[100][roundNumber];
        totemSupply[101] -= totemRoundExpiringSupply[101][roundNumber];

        // Update mesa supplies
        totemSupply[200] -= totemRoundExpiringSupply[200][roundNumber];
        totemSupply[201] -= totemRoundExpiringSupply[201][roundNumber];
        totemSupply[202] -= totemRoundExpiringSupply[202][roundNumber];
        totemSupply[203] -= totemRoundExpiringSupply[203][roundNumber];
        totemSupply[204] -= totemRoundExpiringSupply[204][roundNumber];

        // Increment round
        roundNumber += 1;

        // Update round end timestamp
        roundEndTimestamp += roundDuration;

        emit Rollover(msg.sender);
    }


    function ejectedWithdraw() public nonReentrant {
        if (!ejected) revert NotEjected();
        UserYieldInfo storage user = _getUserInfo(msg.sender);

        uint256 withdrawable = _harvestableWinnings(user);
        withdrawable += _userUnusedSupply(msg.sender);

        _safeTransferSUMMIT(user.user, withdrawable);
    }



    /// @notice Safe Transfer SUMMIT.
    /// @param _to The SUMMIT receiver address.
    /// @param _amount Transfer SUMMIT amounts.
    function _safeTransferSUMMIT(address _to, uint256 _amount) internal {
        if (_amount > 0) {
            uint256 balance = SUMMIT.balanceOf(address(this));
            if (balance < _amount) {
                _amount = balance;
            }
            // Update summitAmountBelongToCart
            unchecked {
                if (summitAmountBelongToCart >= _amount) {
                    summitAmountBelongToCart -= _amount;
                } else {
                    summitAmountBelongToCart = balance - _amount;
                }
            }
            SUMMIT.safeTransfer(_to, _amount);
        }
    }


}
