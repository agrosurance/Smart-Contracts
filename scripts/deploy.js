const { networks } = require("../networks")
const hre = require("hardhat")

const landContractDescription = "Land Contract Description"
const defaultCropImage = "http://"

async function main() {
  const insurancePremiumCalculatorCode = fs.readFileSync("./calculate-premium.js").toString()
  const oracleAddress = networks[hre.network.name]["functionsOracleProxy"]

  const AgroCoin = await ethers.getContractFactory("AgroCoin")
  const agroCoin = await AgroCoin.deploy()
  await agroCoin.deployed()
  console.log(`AgroCoin Contract is deployed to ${agroCoin.address}`)

  const AgroSuranceLand = await ethers.getContractFactory("AgroSuranceLand")
  const landContract = await AgroSuranceLand.deploy(landContractDescription, defaultCropImage)
  await landContract.deployed()
  console.log(`AgroSuranceLand Contract is deployed to ${landContract.address}`)

  const FundManager = await ethers.getContractFactory("FundManager")
  const fundManager = await FundManager.deploy()
  await fundManager.deployed()
  console.log(`FundManager contract is deployed to ${fundManager}`)

  const StakingManager = await ethers.getContractFactory("StakingManager")
  const stakingManager = await StakingManager.deploy(agroCoin.address, fundManager.address)
  await stakingManager.deployed()
  console.log(`StakingManager contract is deployed to ${stakingManager.address}`)

  const InsuranceManager = await ethers.getContractFactory("InsuranceManager")
  const insuranceManager = await InsuranceManager.deploy(
    insurancePremiumCalculatorCode,
    landContract.address,
    oracleAddress
  )
  await insuranceManager.deployed()
  console.log(`InsuranceManager contract is deployed to ${insuranceManager.address}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
