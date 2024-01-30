# SummitSwap V3

## TODO
[x] Add split SUMMIT and EVEREST rewards to MasterchefV3 contract
[] EVEREST token
  [] Allow minting from MasterchefV3 upkeep
  [] Mint EVEREST at same amount when upkeep sends SUMMIT to MC3
  [] Create game holding contract for everest
  [] Integrate into Games
[] Yield gambling
  [] Scrape yield gambling from summit v2 protocol
  [] Integrate with EVEREST game holding contract
  [] Receive and proportionally distribute SUMMIT to winners of games
  [] Burn EVEREST when entering games


## Deployments

1. Add Key in `.env` file. It's a private key of the account that will deploy the contracts and should be gitignored.
2. bscTestnet `KEY_TESTNET` or bsc `KEY_MAINNET`
3. add `ETHERSCAN_API_KEY` in `.env` file. It's an API key for etherscan.
4. `yarn` in root directory
5. `NETWORK=$NETWORK yarn zx v3-deploy.mjs` where `$NETWORK` is either `eth`, `goerli`, `bscMainnet`, `bscTestnet` or `hardhat` (for local testing)
6. `NETWORK=$NETWORK yarn zx v3-verify.mjs` where `$NETWORK` is either `eth`, `goerli`, `bscMainnet`, `bscTestnet` or `hardhat` (for local testing)