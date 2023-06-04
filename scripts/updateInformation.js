const gasLimit = "100000"
const secrets = ""
const subscriptionId = ""
const InsuranceManagerContractAddress = ""

async function main() {
  const InsuranceManager = await ethers.getContractFactory("InsuranceManager")
  const insuranceManager = InsuranceManager.attach(InsuranceManagerContractAddress)

  if (secrets != (await insuranceManager.secrets())) {
    await insuranceManager.setSecrets(secrets)
  }

  if (subscriptionId != (await insuranceManager.chainlinkSubscriptionId()).toString()) {
    await insuranceManager.setChainlinkSubscriptionId(subscriptionId)
  }

  if (gasLimit != (await insuranceManager.chainlinkFunctionGasLimit()).toString()) {
    await insuranceManager.setChainlinkFunctionGasLimit(gasLimit)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
