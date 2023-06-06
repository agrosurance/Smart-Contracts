const fs = require("fs")

function saveABIFile(fileName, content, dirPath = "./abi") {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath)
  }

  const filePath = `${dirPath}/${fileName}`

  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath)
  }

  fs.writeFileSync(filePath, content)
}

async function main() {
  const AgroCoin = await ethers.getContractFactory("AgroCoin")
  const AgroSuranceLand = await ethers.getContractFactory("AgroSuranceLand")
  const FundManager = await ethers.getContractFactory("FundManager")
  const StakingManager = await ethers.getContractFactory("StakingManager")
  const InsuranceManager = await ethers.getContractFactory("InsuranceManager")

  const AgroCoinABI = AgroCoin.interface.format(ethers.utils.FormatTypes.json)
  saveABIFile("AgroCoin.abi", AgroCoinABI)
  const AgroSuranceLandABI = AgroSuranceLand.interface.format(ethers.utils.FormatTypes.json)
  saveABIFile("AgroSuranceLand.abi", AgroSuranceLandABI)
  const FundManagerABI = FundManager.interface.format(ethers.utils.FormatTypes.json)
  saveABIFile("FundManager.abi", FundManagerABI)
  const StakingManagerABI = StakingManager.interface.format(ethers.utils.FormatTypes.json)
  saveABIFile("StakingManager.abi", StakingManagerABI)
  const InsuranceManagerABI = InsuranceManager.interface.format(ethers.utils.FormatTypes.json)
  saveABIFile("InsuranceManager.abi", InsuranceManagerABI)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
