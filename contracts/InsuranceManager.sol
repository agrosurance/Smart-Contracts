// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./AgroSuranceLand.sol";
import "./FundManager.sol";

import {Functions, FunctionsClient} from "./dev/functions/FunctionsClient.sol";
// import "@chainlink/contracts/src/v0.8/dev/functions/FunctionsClient.sol"; // Once published
import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/ConfirmedOwner.sol";

contract InsuranceManager is FunctionsClient, ConfirmedOwner {
  using Functions for Functions.Request;

  struct QuoteRequest {
    uint256 requestId;
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

  mapping(uint256 => QuoteRequest) public quoteRequests; // requestId => QuoteRequest
  mapping(uint256 => uint256[]) public insuranceHistory; // landId => requestId[]
  mapping(uint256 => uint256) public totalInsurances; // landId => no of insurances taken

  string public insurancePremiumCalculatorCode;
  string public checkInsuranceStatusCode;
  bytes public secrets;
  uint64 public chainlinkSubscriptionId;
  uint32 public chainlinkFunctionGasLimit;

  error Unauthorized();
  error NoCropFound();

  constructor(
    string memory _insurancePremiumCalculatorCode,
    AgroSuranceLand _landsContract,
    address oracle
  ) FunctionsClient(oracle) ConfirmedOwner(msg.sender) {
    landsContract = _landsContract;
    insurancePremiumCalculatorCode = _insurancePremiumCalculatorCode;
  }

  modifier onlyLandOwner(uint256 landId) {
    if (landsContract.ownerOf(landId) != msg.sender) revert Unauthorized();
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

  function getInsuranceQuotes(uint256 landId, uint256 coverage) public onlyLandOwner(landId) {
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
    // TODO: send chainlink function call and get the requestId
    uint256 requestId = 0;

    QuoteRequest storage quoteRequest = quoteRequests[requestId];
    quoteRequest.requestId = requestId;
    quoteRequest.owner = msg.sender;
    quoteRequest.landId = landId;
    quoteRequest.coverage = coverage;
    quoteRequest.cropId = currentCycleCropId;
    quoteRequest.insuranceFrom = block.timestamp;
    quoteRequest.insuranceTo = currentCycleTo;
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
  function fulfillRequest(bytes32 requestId, bytes memory response, bytes memory err) internal override {}

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
