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
    bool isRequestFulfilled;
    bool isCheckClaimRequestFulfilled;
    bool isInsured;
    bool isInsuranceClaimable;
    bool isInsuranceClaimed;
    uint256 landId;
    uint256 premium;
    uint256 coverage;
    uint256 cropId;
    uint256 insuranceFrom;
    uint256 insuranceTo;
    uint256 insuranceStatusRequestTime;
    bytes latestError;
  }

  AgroSuranceLand public immutable landsContract;

  mapping(bytes32 => QuoteRequest) public quoteRequests; // requestId => QuoteRequest
  mapping(uint256 => bytes32[]) public insuranceHistory; // landId => requestId[]
  mapping(uint256 => uint256) public totalInsurances; // landId => no of insurances taken
  mapping(bytes32 => RequestType) public requestTypes;
  mapping(bytes32 => bytes32) public claimRequestToQuoteRequest; // claimRequestId => quoteRequestId

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
  event CheckClaimRequestMade(
    address indexed owner,
    uint256 indexed landId,
    bytes32 indexed requestId,
    uint256 cropId,
    uint256 insuranceFrom,
    uint256 insuranceTo,
    bytes32 claimRequestId
  );
  event CheckClaimRequestFulfilled(
    address indexed owner,
    uint256 indexed landId,
    bytes32 indexed requestId,
    bytes32 claimRequestId,
    bool isClaimable
  );
  event InsuranceClaimed(address indexed owner, uint256 indexed landId, bytes32 indexed requestId, uint256 amount);

  error Unauthorized();
  error NoCropFound();
  error RequestNotFulfilled();
  error InvalidRequest();
  error AlreadyInsured();
  error NotInsured();
  error AlreadyClaimed();
  error AlreadyClaimable();
  error NotClaimable();
  error QuotesExpired();
  error IncorrectPremium();
  error OnlyOneRequestEveryDay();
  error AmountTransferFailed();

  constructor(
    string memory _insurancePremiumCalculatorCode,
    string memory _checkInsuranceStatusCode,
    AgroSuranceLand _landsContract,
    FundManager _fundManager,
    address oracle
  ) FunctionsClient(oracle) ConfirmedOwner(msg.sender) {
    landsContract = _landsContract;
    insurancePremiumCalculatorCode = _insurancePremiumCalculatorCode;
    checkInsuranceStatusCode = _checkInsuranceStatusCode;
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

  function setCheckInsuranceStatusCode(string calldata _checkInsuranceStatusCode) public onlyOwner {
    checkInsuranceStatusCode = _checkInsuranceStatusCode;
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

  function checkInsuranceStatus(
    bytes32 requestId
  ) external onlyRequestOwner(requestId) returns (bytes32 claimRequestId) {
    QuoteRequest memory request = quoteRequests[requestId];
    if (!request.isInsured) revert NotInsured();
    if (request.isInsuranceClaimed) revert AlreadyClaimed();
    if (request.isInsuranceClaimable) revert AlreadyClaimable();
    if (request.insuranceStatusRequestTime > block.timestamp - 24 * 60 * 60) revert OnlyOneRequestEveryDay();
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
    ) = landsContract.landDetails(request.landId);
    if (currentCycleTo < block.timestamp) revert NoCropFound();
    (uint256 cropId, string memory cropName, ) = landsContract.cropDetails(currentCycleCropId);

    string[] memory args = new string[](5);

    uint256 insuranceTo = request.insuranceTo > block.timestamp ? block.timestamp : request.insuranceTo;
    args[0] = int256(lat).toString();
    args[1] = int256(long).toString();
    args[2] = cropName;
    args[3] = request.insuranceFrom.toString();
    args[4] = insuranceTo.toString();

    claimRequestId = _executeRequest(checkInsuranceStatusCode, args);
    requestTypes[claimRequestId] = RequestType.CHECK_CLAIM;

    claimRequestToQuoteRequest[claimRequestId] = requestId;

    quoteRequests[requestId].insuranceStatusRequestTime = block.timestamp;
    emit CheckClaimRequestMade(
      msg.sender,
      landId,
      requestId,
      cropId,
      request.insuranceFrom,
      insuranceTo,
      claimRequestId
    );
  }

  function claim(bytes32 requestId) public onlyRequestOwner(requestId) {
    QuoteRequest memory request = quoteRequests[requestId];
    if (!request.isInsured) revert NotInsured();
    if (request.isInsuranceClaimed) revert AlreadyClaimed();
    if (!request.isInsuranceClaimable) revert NotClaimable();

    quoteRequests[requestId].isInsuranceClaimed = true;

    (bool success, ) = address(msg.sender).call{value: request.coverage}("");

    if (!success) revert AmountTransferFailed();

    emit InsuranceClaimed(msg.sender, request.landId, requestId, request.coverage);
  }

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

  function _fulfillCheckClaimRequest(bytes32 claimRequestId, bytes memory response, bytes memory /* err */) internal {
    bytes32 requestId = claimRequestToQuoteRequest[claimRequestId];
    quoteRequests[requestId].isCheckClaimRequestFulfilled = true;
    bool isClaimable = abi.decode(response, (bool));
    quoteRequests[requestId].isInsuranceClaimable = isClaimable;

    emit CheckClaimRequestFulfilled(
      quoteRequests[requestId].owner,
      quoteRequests[requestId].landId,
      requestId,
      claimRequestId,
      isClaimable
    );
  }

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
