const { expect } = require("chai")
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers")

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

describe("Lands Contract", () => {
  const accounts = []
  let signers
  let landContract

  before(async () => {
    signers = await ethers.getSigners()
    for (const signer of signers) {
      accounts.push(await signer.getAddress())
    }

    const LandFactory = await ethers.getContractFactory("AgroSuranceLand")
    landContract = await LandFactory.deploy("AgroSurance Land", "https://image.com/default")
    landContract.deployed()
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
})
