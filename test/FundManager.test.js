const { expect } = require("chai")
const { ethers } = require("hardhat")

describe("Fund Manager Contract", () => {
  const accounts = []
  let signers
  let fundManager

  before(async () => {
    signers = await ethers.getSigners()
    for (const signer of signers) {
      accounts.push(await signer.getAddress())
    }

    const FundManager = await ethers.getContractFactory("FundManager")
    fundManager = await FundManager.deploy()
    fundManager.deployed()
  })

  it("Should add some funds to the fund manager contract", async () => {
    await signers[0].sendTransaction({ to: fundManager.address, value: ethers.utils.parseEther("10") })

    expect(await ethers.provider.getBalance(fundManager.address)).to.be.equal(ethers.utils.parseEther("10"))
  })

  it("Should not transfer the funds from the fund manager contract if not trusted contract", async () => {
    const error = `AccessControl: account ${accounts[0].toLowerCase()} is missing role ${await fundManager.TRUSTED_CONTRACT_ROLE()}`
    await expect(fundManager.transferEth(accounts[1], ethers.utils.parseEther("5"))).to.be.revertedWith(error)
  })

  it("Should not set the trusted contract if not the owner", async () => {
    const error = `AccessControl: account ${accounts[1].toLowerCase()} is missing role ${await fundManager.DEFAULT_ADMIN_ROLE()}`
    await expect(
      fundManager.connect(signers[1]).grantRole(await fundManager.TRUSTED_CONTRACT_ROLE(), accounts[1])
    ).to.be.revertedWith(error)
  })

  it("Should set the trusted contract", async () => {
    await fundManager.grantRole(await fundManager.TRUSTED_CONTRACT_ROLE(), accounts[1])
  })

  it("Should transfer the funds from the fund manager contract", async () => {
    await fundManager.connect(signers[1]).transferEth(accounts[1], ethers.utils.parseEther("5"))
    expect(await ethers.provider.getBalance(fundManager.address)).to.be.equal(ethers.utils.parseEther("5"))
  })
})
