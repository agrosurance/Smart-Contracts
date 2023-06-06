const { expect } = require("chai")
const { ethers } = require("hardhat")
const { time } = require("@nomicfoundation/hardhat-network-helpers")

const rewardRate = ethers.utils.parseEther("10000").div((60 * 60 * 24).toString())

describe("Staking Manager Contract", () => {
  const accounts = []
  let signers
  let stakingManager, fundManager, tokenContract

  before(async () => {
    signers = await ethers.getSigners()
    for (const signer of signers) {
      accounts.push(await signer.getAddress())
    }

    const AgroCoin = await ethers.getContractFactory("AgroCoin")
    tokenContract = await AgroCoin.deploy()
    tokenContract.deployed()

    const FundManager = await ethers.getContractFactory("FundManager")
    fundManager = await FundManager.deploy()
    fundManager.deployed()

    const StakingManager = await ethers.getContractFactory("StakingManager")
    stakingManager = await StakingManager.deploy(tokenContract.address, fundManager.address)
    stakingManager.deployed()
  })

  it("Should setup", async () => {
    const totalStakingRewardPortion = ethers.BigNumber.from(
      (await tokenContract.totalSupply()).div(ethers.utils.parseEther("100")).mul(ethers.utils.parseEther("40"))
    )
    await tokenContract.transfer(stakingManager.address, totalStakingRewardPortion)
    expect(await tokenContract.balanceOf(stakingManager.address)).to.be.equal(totalStakingRewardPortion)

    await fundManager.grantRole(await fundManager.TRUSTED_CONTRACT_ROLE(), stakingManager.address)
  })

  it("Should not set the reward rate if not the owner", async () => {
    await expect(stakingManager.connect(signers[1]).setTotalRewardRate(rewardRate)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    )
  })

  it("Should set the reward rate", async () => {
    await stakingManager.setTotalRewardRate(rewardRate)
  })

  it("Should start staking", async () => {
    await stakingManager.stake({ value: ethers.utils.parseEther("10") })
  })

  it("Should check the reward after 2 min", async () => {
    await time.increase(60 * 2)
    await stakingManager.connect(signers[1]).stake({ value: ethers.utils.parseEther("10") })
    await time.increase(60 * 2)
    await stakingManager.connect(signers[2]).stake({ value: ethers.utils.parseEther("20") })
    await time.increase(60 * 4)
    console.log(await stakingManager.checkUnclaimedBalance(accounts[1]))
    await stakingManager.connect(signers[1]).claimReward()
    console.log(await stakingManager.checkUnclaimedBalance(accounts[1]))
    console.log(await tokenContract.balanceOf(accounts[1]))
  })

  it("Should unstake the tokens", async () => {
    await time.increase(60 * 2)
    console.log(await ethers.provider.getBalance(fundManager.address))
    console.log(await ethers.provider.getBalance(accounts[1]))
    await stakingManager.connect(signers[1]).unstake()
    console.log(await ethers.provider.getBalance(fundManager.address))
    console.log(await ethers.provider.getBalance(accounts[1]))
  })
})
