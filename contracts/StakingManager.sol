// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./FundManager.sol";
import "hardhat/console.sol";

/// @custom:security-contact contact@yashgoyal.dev
contract StakingManager is Ownable {
  struct Stake {
    uint256 amount;
    uint256 startTime;
    uint256 initialRewardRate;
  }

  mapping(address => uint256) public unclaimedBalance;
  mapping(address => Stake) public stakes;

  uint256 rewardRate;
  uint256 lastUpdateTime;
  uint256 totalStaked;
  uint256 totalRewardRate;
  IERC20 rewardToken;
  FundManager fundManager;

  error InsufficientBalance();
  error FundTransferFailed();

  constructor(IERC20 _rewardToken, FundManager _fundManager) {
    rewardToken = _rewardToken;
    fundManager = _fundManager;
  }

  function setTotalRewardRate(uint256 _totalRewardRate) public onlyOwner {
    totalRewardRate = _totalRewardRate;
  }

  function stake() public payable {
    _updateUnclaimedBalance(msg.sender);

    totalStaked += msg.value;

    // update the stake amount
    stakes[msg.sender].amount += msg.value;

    // deposit the amount in tresury
    (bool success, ) = address(fundManager).call{value: msg.value}("");
    if (!success) revert FundTransferFailed();
  }

  function unstake() public {
    uint256 stakedAmount = stakes[msg.sender].amount;
    if (stakedAmount == 0) revert InsufficientBalance();

    _updateUnclaimedBalance(msg.sender);

    totalStaked -= stakedAmount;

    delete stakes[msg.sender];

    // send the amount back
    fundManager.transferEth(msg.sender, stakedAmount);
  }

  function claimReward() public {
    _updateUnclaimedBalance(msg.sender);
    uint256 balance = unclaimedBalance[msg.sender];
    if (balance == 0) revert InsufficientBalance();
    rewardToken.transfer(msg.sender, balance);
    unclaimedBalance[msg.sender] = 0;
  }

  function _updateUnclaimedBalance(address user) internal {
    if (totalStaked != 0) {
      rewardRate += ((block.timestamp - lastUpdateTime) * 10 ** 18 * totalRewardRate) / totalStaked;
    }
    lastUpdateTime = block.timestamp;
    Stake memory lastStake = stakes[user];
    unclaimedBalance[user] += (lastStake.amount * (rewardRate - lastStake.initialRewardRate)) / 10 ** 18;
    stakes[user].startTime = block.timestamp;
    stakes[user].initialRewardRate = rewardRate;
  }

  function checkUnclaimedBalance(address user) public view returns (uint256) {
    if (totalStaked == 0) return 0;
    uint256 currentRewardRate = rewardRate +
      ((block.timestamp - lastUpdateTime) * 10 ** 18 * totalRewardRate) /
      totalStaked;
    Stake memory lastStake = stakes[user];
    return unclaimedBalance[user] + (lastStake.amount * (currentRewardRate - lastStake.initialRewardRate)) / 10 ** 18;
  }
}
