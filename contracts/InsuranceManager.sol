// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./AgroSuranceLand.sol";
import "./FundManager.sol";

import {Functions, FunctionsClient} from "./dev/functions/FunctionsClient.sol";
// import "@chainlink/contracts/src/v0.8/dev/functions/FunctionsClient.sol"; // Once published
import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/ConfirmedOwner.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract InsuranceManager is FunctionsClient, ConfirmedOwner {
  using Functions for Functions.Request;
  using Strings for uint256;
  using Strings for int256;

  enum RequestType {
    CALCULATE_COVERAGE,
    CHECK_CLAIM
  }

  struct QuoteRequest {
    bytes32 requestId;
    address owner;
    uint256 landId;
    uint256 premium;
    uint256 coverage;
    uint256 cropId;
    uint256 insuranceFrom;
    uint256 insuranceTo;
    bool isRequestFulfilled;
    bytes latestResponse;
    bytes latestError;
    bool isInsured;
    bool isInsuranceClaimed;
  }

  AgroSuranceLand public immutable landsContract;

  mapping(bytes32 => QuoteRequest) public quoteRequests; // requestId => QuoteRequest
  mapping(uint256 => bytes32[]) public insuranceHistory; // landId => requestId[]
  mapping(uint256 => uint256) public totalInsurances; // landId => no of insurances taken
  mapping(bytes32 => RequestType) public requestTypes;

  FundManager public fundManager;

  string public insurancePremiumCalculatorCode;
  string public checkInsuranceStatusCode;
  bytes public secrets;
  uint64 public chainlinkSubscriptionId;
  uint32 public chainlinkFunctionGasLimit;

  event QuotesRequestMade(
    address indexed owner,
    uint256 indexed landId,
    bytes32 indexed requestId,
    uint256 cropId,
    uint256 insuranceFrom,
    uint256 insuranceTo,
    uint256 coverage
  );
  event QuotesRequestFulfilled(
    address indexed owner,
    uint256 indexed landId,
    bytes32 indexed requestId,
    uint256 premium
  );
  event Insured(address indexed owner, uint256 indexed landId, bytes32 indexed requestId);
  event InsuranceClaimed();

  error Unauthorized();
  error NoCropFound();
  error RequestNotFulfilled();
  error InvalidRequest();
  error AlreadyInsured();
  error QuotesExpired();
  error IncorrectPremium();
  error OnlyOneRequestEveryDay();

  constructor(
    string memory _insurancePremiumCalculatorCode,
    AgroSuranceLand _landsContract,
    FundManager _fundManager,
    address oracle
  ) FunctionsClient(oracle) ConfirmedOwner(msg.sender) {
    landsContract = _landsContract;
    insurancePremiumCalculatorCode = _insurancePremiumCalculatorCode;
    fundManager = _fundManager;
  }

  modifier onlyLandOwner(uint256 landId) {
    if (landsContract.ownerOf(landId) != msg.sender) revert Unauthorized();
    _;
  }

  modifier onlyRequestOwner(bytes32 requestId) {
    if (quoteRequests[requestId].owner == address(0)) revert InvalidRequest();
    if (quoteRequests[requestId].owner != msg.sender) revert Unauthorized();
    _;
  }

  function setInsurancePremiumCalculatorCode(string calldata _insurancePremiumCalculatorCode) public onlyOwner {
    insurancePremiumCalculatorCode = _insurancePremiumCalculatorCode;
  }

  function setSecrets(bytes calldata _secrets) public onlyOwner {
    secrets = _secrets;
  }

  function setChainlinkSubscriptionId(uint64 _chainlinkSubscriptionId) public onlyOwner {
    chainlinkSubscriptionId = _chainlinkSubscriptionId;
  }

  function setChainlinkFunctionGasLimit(uint32 _chainlinkFunctionGasLimit) public onlyOwner {
    chainlinkFunctionGasLimit = _chainlinkFunctionGasLimit;
  }

  function getInsuranceQuotes(
    uint256 landId,
    uint256 coverageTill,
    uint256 coverage
  ) public onlyLandOwner(landId) returns (bytes32 requestId) {
    (
      uint256 landId,
      string memory name,
      uint256 area,
      int32 lat,
      int32 long,
      uint256 currentCycleCropId,
      uint256 currentCycleFrom,
      uint256 currentCycleTo,
      uint256 totalCycles
    ) = landsContract.landDetails(landId);
    if (currentCycleTo < block.timestamp) revert NoCropFound();
    (uint256 cropId, string memory cropName, ) = landsContract.cropDetails(currentCycleCropId);

    // check if last request was made within last 24 hours ago
    uint256 noOfRequests = totalInsurances[landId];

    if (noOfRequests != 0) {
      bytes32 lastRequestId = insuranceHistory[landId][noOfRequests - 1];
      if (quoteRequests[lastRequestId].insuranceFrom > block.timestamp - 24 * 60 * 60) revert OnlyOneRequestEveryDay();
    }

    // TODO: send chainlink function call and get the requestId
    string[] memory args = new string[](5);

    args[0] = int256(lat).toString();
    args[1] = int256(long).toString();
    args[2] = cropName;
    args[3] = coverage.toString();
    args[4] = coverageTill.toString();

    requestId = _executeRequest(insurancePremiumCalculatorCode, args);
    requestTypes[requestId] = RequestType.CALCULATE_COVERAGE;

    QuoteRequest storage quoteRequest = quoteRequests[requestId];
    quoteRequest.requestId = requestId;
    quoteRequest.owner = msg.sender;
    quoteRequest.landId = landId;
    quoteRequest.coverage = coverage;
    quoteRequest.cropId = currentCycleCropId;
    quoteRequest.insuranceFrom = block.timestamp;
    quoteRequest.insuranceTo = coverageTill;

    insuranceHistory[landId].push(requestId);
    totalInsurances[landId]++;

    emit QuotesRequestMade(msg.sender, landId, requestId, currentCycleCropId, block.timestamp, coverageTill, coverage);
  }

  function claim(bytes32 requestId) public onlyRequestOwner(requestId) {}

  /**
   * @notice Send a simple request
   *
   * @param source JavaScript source code
   * @param args List of arguments accessible from within the source code
   * @return Functions request ID
   */
  function _executeRequest(string memory source, string[] memory args) internal returns (bytes32) {
    Functions.Request memory req;
    req.initializeRequest(Functions.Location.Inline, Functions.CodeLanguage.JavaScript, source);
    if (secrets.length > 0) {
      req.addRemoteSecrets(secrets);
    }
    if (args.length > 0) req.addArgs(args);

    bytes32 assignedReqID = sendRequest(req, chainlinkSubscriptionId, chainlinkFunctionGasLimit);
    return assignedReqID;
  }

  /**
   * @notice Callback that is invoked once the DON has resolved the request or hit an error
   *
   * @param requestId The request ID, returned by sendRequest()
   * @param response Aggregated response from the user code
   * @param err Aggregated error from the user code or from the execution pipeline
   * Either response or error parameter will be set, but never both
   */
  function fulfillRequest(bytes32 requestId, bytes memory response, bytes memory err) internal override {
    if (requestTypes[requestId] == RequestType.CALCULATE_COVERAGE) {
      _fulfillCalculateCoverageRequest(requestId, response, err);
    }
    if (requestTypes[requestId] == RequestType.CHECK_CLAIM) {
      _fulfillCheckClaimRequest(requestId, response, err);
    }
  }

  function _fulfillCalculateCoverageRequest(bytes32 requestId, bytes memory response, bytes memory err) internal {
    quoteRequests[requestId].isRequestFulfilled = true;
    quoteRequests[requestId].latestResponse = response;
    quoteRequests[requestId].latestError = err;
    uint256 premium = abi.decode(response, (uint256));
    quoteRequests[requestId].premium = premium;

    emit QuotesRequestFulfilled(quoteRequests[requestId].owner, quoteRequests[requestId].landId, requestId, premium);
  }

  function buyInsurance(bytes32 requestId) external payable onlyRequestOwner(requestId) {
    QuoteRequest memory request = quoteRequests[requestId];
    if (!request.isRequestFulfilled) revert RequestNotFulfilled();
    if (request.isInsured) revert AlreadyInsured();
    if (request.insuranceFrom + 24 days < block.timestamp) revert QuotesExpired();
    if (request.premium != msg.value) revert IncorrectPremium();
    address(fundManager).call{value: msg.value}("");
    quoteRequests[requestId].isInsured = true;

    emit Insured(msg.sender, request.landId, requestId);
  }

  function _fulfillCheckClaimRequest(bytes32 requestId, bytes memory response, bytes memory err) internal {}

  /**
   * @notice Allows the Functions oracle address to be updated
   *
   * @param oracle New oracle address
   */
  function updateOracleAddress(address oracle) public onlyOwner {
    setOracle(oracle);
  }

  function addSimulatedRequestId(address oracleAddress, bytes32 requestId) public onlyOwner {
    addExternalRequest(oracleAddress, requestId);
  }

  // function claim(uint256 requestId) public onlyLandOwner(requestId) {
  //     landsContract.Land memory land = landsContract.landDetails(landId);
  // }
}
