require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");
require('dotenv').config({path:__dirname+'/.env'})

module.exports = {
  solidity: "0.8.4",
  paths: {
    artifacts: "./app/artifacts",
  },
  defaultNetwork: "hardhat", 
  networks: {
    hardhat: {
    },
    kovan: {
      url: process.env.RINKEBY_URL,
      accounts: [process.env.PRIVATE_KEY],
    }
  },
  etherscan: {
    apiKey: {
      kovan: process.env.ETHERSCAN_KEY
    }
  },
};