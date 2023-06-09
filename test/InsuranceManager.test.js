const { expect } = require("chai")
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers")
const fs = require("fs")
const { SHARED_DON_PUBLIC_KEY } = require("../networks")
const { simulateRequest, buildRequest } = require("../FunctionsSandboxLibrary")
const { createRequestConfig } = require("./helpers")

function getDummyLatLongArea() {
  const lat = Math.round((Math.random() * 180 - 90) * 10 ** 6)
  const long = Math.round((Math.random() * 360 - 180) * 10 ** 6)
  const area = Math.round(Math.random() * 10000 * 10 ** 6)
  return [lat, long, area]
}

function parseTokenURI(uri) {
  return JSON.parse(atob(uri.split("data:application/json;base64,")[1]))
}

async function createLand(landContract, signer, name) {
  const [lat, long, area] = getDummyLatLongArea()
  await landContract.connect(signer).addLand(name, lat, long, area)
}

const crops = [{ name: "Crop 1", image: "https://agrosurance-spandan.netlify.app/images/lands/carrot.png" }]

const deployMockOracle = async () => {
  // Deploy mocks: LINK token & LINK/ETH price feed
  const linkTokenFactory = await ethers.getContractFactory("LinkToken")
  const linkPriceFeedFactory = await ethers.getContractFactory("MockV3Aggregator")
  const linkToken = await linkTokenFactory.deploy()
  const linkPriceFeed = await linkPriceFeedFactory.deploy(0, ethers.BigNumber.from(5021530000000000))
  // Deploy proxy admin
  await upgrades.deployProxyAdmin()
  // Deploy the oracle contract
  const oracleFactory = await ethers.getContractFactory("FunctionsOracle")
  const oracleProxy = await upgrades.deployProxy(oracleFactory, [], {
    kind: "transparent",
  })
  await oracleProxy.deployTransaction.wait(1)
  // Set the secrets encryption public DON key in the mock oracle contract
  await oracleProxy.setDONPublicKey("0x" + SHARED_DON_PUBLIC_KEY)
  // Deploy the mock registry billing contract
  const registryFactory = await ethers.getContractFactory("FunctionsBillingRegistry")
  const registryProxy = await upgrades.deployProxy(
    registryFactory,
    [linkToken.address, linkPriceFeed.address, oracleProxy.address],
    {
      kind: "transparent",
    }
  )
  await registryProxy.deployTransaction.wait(1)
  // Set registry configuration
  const config = {
    maxGasLimit: 300_000,
    stalenessSeconds: 86_400,
    gasAfterPaymentCalculation: 39_173,
    weiPerUnitLink: ethers.BigNumber.from("5000000000000000"),
    gasOverhead: 519_719,
    requestTimeoutSeconds: 300,
  }
  await registryProxy.setConfig(
    config.maxGasLimit,
    config.stalenessSeconds,
    config.gasAfterPaymentCalculation,
    config.weiPerUnitLink,
    config.gasOverhead,
    config.requestTimeoutSeconds
  )
  // Set the current account as an authorized sender in the mock registry to allow for simulated local fulfillments
  const accounts = await ethers.getSigners()
  const deployer = accounts[0]
  await registryProxy.setAuthorizedSenders([oracleProxy.address, deployer.address])
  await oracleProxy.setRegistry(registryProxy.address)
  return { oracle: oracleProxy, registry: registryProxy, linkToken }
}

const insurancePremiumCalculatorCode = fs.readFileSync("./calculate-premium.js").toString()

const secrets = `0x${Buffer.from(
  "https://gist.githubusercontent.com/yashgo0018/b60de01cec5e11e2f5f5b03007d8a013/raw/08413bd12f9d564331073c8dc9b9a65ecd439192/offchain-secrets.json"
).toString("hex")}`

describe("Insurance Manager Contract", () => {
  const accounts = []
  let signers
  let landContract
  let fundManager
  let insuranceManagerContract
  let oracleContract
  let registryContract
  let linkTokenContract

  before(async () => {
    signers = await ethers.getSigners()
    for (const signer of signers) {
      accounts.push(await signer.getAddress())
    }

    const mockContracts = await deployMockOracle()
    oracleContract = mockContracts.oracle
    registryContract = mockContracts.registry
    linkTokenContract = mockContracts.linkToken

    await oracleContract.addAuthorizedSenders([accounts[0]])

    const LandFactory = await ethers.getContractFactory("AgroSuranceLand")
    landContract = await LandFactory.deploy("AgroSurance Land", "https://image.com/default")
    landContract.deployed()

    const FundManager = await ethers.getContractFactory("FundManager")
    fundManager = await FundManager.deploy()
    fundManager.deployed()

    const InsuraceManagerContract = await ethers.getContractFactory("InsuranceManager")
    insuranceManagerContract = await InsuraceManagerContract.deploy(
      insurancePremiumCalculatorCode,
      landContract.address,
      fundManager.address,
      oracleContract.address
    )
    await insuranceManagerContract.deployed()
  })

  it("Should create & fund a subscription", async () => {
    const createSubscriptionTx = await registryContract.createSubscription()
    const createSubscriptionReceipt = await createSubscriptionTx.wait(1)
    const subscriptionId = createSubscriptionReceipt.events[0].args["subscriptionId"].toNumber()
    const juelsAmount = ethers.utils.parseUnits("10")
    await linkTokenContract.transferAndCall(
      registryContract.address,
      juelsAmount,
      ethers.utils.defaultAbiCoder.encode(["uint64"], [subscriptionId])
    )

    // Authorize the client contract to use the subscription
    await registryContract.addConsumer(subscriptionId, insuranceManagerContract.address)

    // update the subscription id in the insurance manager
    await insuranceManagerContract.setChainlinkSubscriptionId(subscriptionId)

    // update the gas limit and secrets also
    await insuranceManagerContract.setChainlinkFunctionGasLimit(300_000)
    await insuranceManagerContract.setSecrets(secrets)
  })

  it("Should create some lands", async () => {
    await expect(landContract.tokenURI(1)).to.be.revertedWith("ERC721: invalid token ID")

    await createLand(landContract, signers[0], "My Land 1")
    await createLand(landContract, signers[0], "My Land 2")
    await createLand(landContract, signers[1], "Your Land 1")
    await createLand(landContract, signers[0], "My Land 3")
    console.log(parseTokenURI(await landContract.tokenURI(0)))
    console.log(await landContract.balanceOf(accounts[0]))
    console.log(await landContract.tokenOfOwnerByIndex(accounts[0], 0))
    console.log(await landContract.tokenOfOwnerByIndex(accounts[0], 1))
    console.log(await landContract.tokenOfOwnerByIndex(accounts[0], 2))
    await landContract.burn(0)
    console.log(await landContract.tokenOfOwnerByIndex(accounts[0], 0))
    console.log(await landContract.tokenOfOwnerByIndex(accounts[0], 1))
  })

  it("Should not add cycle if crop doesn't exist", async () => {
    const now = await time.latest()
    const from = now
    const to = now + 3 * 30 * 24 * 60 * 60
    await expect(landContract.addCurrentCycle(1, 1, from, to)).to.be.revertedWithCustomError(
      landContract,
      "InvalidCropId"
    )
  })

  it("Should not add crop if not the owner", async () => {
    await expect(landContract.connect(signers[1]).addCrop(crops[0].name, crops[0].image)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    )
  })

  it("Should add crop", async () => {
    await landContract.addCrop(crops[0].name, crops[0].image)
  })

  it("Should add cycle", async () => {
    const now = await time.latest()
    const from = now
    const to = now + 3 * 30 * 24 * 60 * 60
    await landContract.addCurrentCycle(1, 1, from, to)

    expect(parseTokenURI(await landContract.tokenURI(1)).name).to.be.equal("My Land 2 (Crop 1)")
  })

  it("Should not add another cycle if already a cycle is going on", async () => {
    const now = await time.latest()
    const from = now
    const to = now + 3 * 30 * 24 * 60 * 60
    await expect(landContract.addCurrentCycle(1, 1, from, to)).to.be.revertedWithCustomError(
      landContract,
      "LastCycleNotFinished"
    )
  })

  it("Should not add another cycle if already a cycle is going on", async () => {
    const now = await time.latest()
    const from = now
    const to = now + 3 * 30 * 24 * 60 * 60
    await expect(landContract.addCurrentCycle(1, 1, from, to)).to.be.revertedWithCustomError(
      landContract,
      "LastCycleNotFinished"
    )
  })

  it("Should add another cycle", async () => {
    expect(parseTokenURI(await landContract.tokenURI(1)).name).to.be.equal("My Land 2 (Crop 1)")
    await time.increase(3 * 30 * 24 * 60 * 60)
    expect(parseTokenURI(await landContract.tokenURI(1)).name).to.be.equal("My Land 2 (No Crop)")

    const now = await time.latest()
    const from = now
    const to = now + 3 * 30 * 24 * 60 * 60
    await landContract.addCurrentCycle(1, 1, from, to)
  })

  it("Should make a quote request", async () => {
    const coverage = ethers.utils.parseEther("0.1")
    const now = await time.latest()
    const validTill = now + 10 * 24 * 60 * 60
    const tx = await insuranceManagerContract.getInsuranceQuotes(1, validTill, coverage)
    const l = await tx.wait(1)
    console.log(l.events[0].args)
    const requestId = l.events[2].args.id
    console.log(l.events)

    const requestConfig = createRequestConfig(insurancePremiumCalculatorCode, [
      "27000000",
      "80000000",
      "Maize",
      coverage.toString(),
      validTill.toString(),
    ])
    const DONPublicKey = await oracleContract.getDONPublicKey()
    requestConfig.DONPublicKey = DONPublicKey.slice(2)
    // const request = await buildRequest(requestConfig)

    const { success, result, resultLog } = await simulateRequest(requestConfig)
    console.log(`\n${resultLog}`)

    // Simulate a request fulfillment
    const accounts = await ethers.getSigners()
    const dummyTransmitter = accounts[0].address
    const dummySigners = Array(31).fill(dummyTransmitter)
    let i = 0
    try {
      const fulfillTx = await registryContract.fulfillAndBill(
        requestId,
        success ? result : "0x",
        success ? "0x" : result,
        dummyTransmitter,
        dummySigners,
        4,
        100_000,
        500_000,
        {
          gasLimit: 500_000,
        }
      )
      await fulfillTx.wait(1)
    } catch (fulfillError) {
      // Catch & report any unexpected fulfillment errors
      console.log("\nUnexpected error encountered when calling fulfillRequest in client contract.")
      console.log(fulfillError)
      resolve()
    }

    const requestObj = await insuranceManagerContract.quoteRequests(requestId)
    console.log(requestObj)
  })
})
