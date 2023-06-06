const { networks } = require("../networks")
const hre = require("hardhat")
const fs = require("fs")

const landContractDescription = "Land Contract Description"
const defaultCropImage = "https://nftstorage.link/ipfs/bafkreid6tmxbk4ufk5qng2jw4pa36c4gv7baxnbtr4cjhsxrfk4mvfxzgu"

const crops = [
  {
    name: "Maize",
    image: "https://nftstorage.link/ipfs/bafkreic3tgssdkvg56dmdj336vr7ayfhxalrctklqb5jijxyuvqfcde454",
  },
  {
    name: "Corn",
    image: "https://nftstorage.link/ipfs/bafkreihblxxple4za3ab5jil4tly4jbq2rcdgbfa6ijdu6tng4uv53e2l4",
  },
  {
    name: "Carrot",
    image: "https://nftstorage.link/ipfs/bafkreigwqpdgbdu7q4e6s6vqhxbk6nncbyt3xay4mmei26egymz7fzkdym",
  },
]

async function addCrops(landContract) {
  for (const crop of crops) {
    await landContract.addCrop(crop.name, crop.image)
  }
}

async function deployAndVerify(contractName, args) {
  const factory = await ethers.getContractFactory(contractName)
  const contract = await factory.deploy(...args)
  await contract.deployTransaction.wait(2)

  console.log(`${contractName} is deployed to ${contract.address}`)

  try {
    await hre.run("verify:verify", {
      address: contract.address,
      constructorArguments: args,
    })
  } catch (err) {
    console.log(err)
  }

  return contract
}

async function main() {
  const insurancePremiumCalculatorCode = fs.readFileSync("./calculate-premium.js").toString()
  const oracleAddress = networks[hre.network.name]["functionsOracleProxy"]

  const agroCoin = await deployAndVerify("AgroCoin", [])

  const landContract = await deployAndVerify("AgroSuranceLand", [landContractDescription, defaultCropImage])

  const fundManager = await deployAndVerify("FundManager", [])

  const stakingManager = await deployAndVerify("StakingManager", [agroCoin.address, fundManager.address])

  const insuranceManager = await deployAndVerify("InsuranceManager", [
    insurancePremiumCalculatorCode,
    landContract.address,
    fundManager.address,
    oracleAddress,
  ])

  // add some crops to the land contract
  await addCrops(landContract)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
