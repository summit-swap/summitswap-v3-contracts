// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

interface ICartographer {
    function ejectCartographer() external;
    function injectFarmYield(address user, uint256 yield) external;
}
