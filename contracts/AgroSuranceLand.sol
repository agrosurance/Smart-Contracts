// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/// @custom:security-contact contact@yashgoyal.dev
contract AgroSuranceLand is ERC721, ERC721Enumerable, ERC721Burnable, Ownable {
    using Counters for Counters.Counter;
    using Strings for uint256;
    using Strings for int256;

    struct Land {
        uint256 landId;
        string name;
        uint256 area; // denoted in acres with 6 decimal precision
        int32 lat;
        int32 long;
        uint256 currentCycleCropId;
        uint256 currentCycleFrom;
        uint256 currentCycleTo;
        uint256 totalCycles;
    }

    struct Crop {
        uint256 cropId;
        string name;
        string image;
    }

    struct LandHistory {
        uint256 landId;
        uint256 historyId;
        uint256 cropId;
        uint256 from;
        uint256 to;
    }

    Counters.Counter private _landIdCounter;
    Counters.Counter private _cropIdCounter;

    string public description;

    uint8 public constant COORD_DECIMAL_PLACES = 6;

    mapping(uint256 => Land) public landDetails;
    mapping(uint256 => Crop) public cropDetails;
    mapping(uint256 => LandHistory[]) public landHistory;

    error InvalidCropId();
    error InvalidLandId();
    error Unauthorized();
    error LastCycleNotFinished();
    error CycleNotStartedYet();
    error CycleEndTimeLessThanStart();
    error EmptyString();

    constructor(
        string memory _description,
        string memory _defaultCropImage
    ) ERC721("AgroSuranceLand", "ASL") {
        description = _description;
        cropDetails[0].name = "No Crop";
        cropDetails[0].image = _defaultCropImage;
    }

    modifier onlyLandOwner(uint256 landId) {
        if (!_exists(landId)) revert InvalidLandId();
        if (ownerOf(landId) != _msgSender()) revert Unauthorized();
        _;
    }

    function addCrop(
        string calldata name,
        string calldata image
    ) external onlyOwner returns (uint256 cropId) {
        if (bytes(name).length == 0) revert EmptyString();
        _cropIdCounter.increment();
        cropId = _cropIdCounter.current();
        Crop storage crop = cropDetails[cropId];
        crop.name = name;
        crop.image = image;
    }

    function updateCrop(
        uint256 cropId,
        string calldata name,
        string calldata image
    ) external onlyOwner {
        if (bytes(name).length == 0) revert EmptyString();
        if (!cropExists(cropId)) revert InvalidCropId();
        Crop storage crop = cropDetails[cropId];
        crop.name = name;
        crop.image = image;
    }

    function addLand(
        string calldata name,
        int32 lat,
        int32 long,
        uint256 area
    ) external returns (uint256 landId) {
        if (bytes(name).length == 0) revert EmptyString();
        landId = _landIdCounter.current();
        _landIdCounter.increment();
        _safeMint(msg.sender, landId);
        Land storage land = landDetails[landId];
        land.landId = landId;
        land.name = name;
        land.lat = lat;
        land.long = long;
        land.area = area;
    }

    function addCurrentCycle(
        uint256 landId,
        uint256 cycleCropId,
        uint256 cycleFrom,
        uint256 cycleTo
    ) external onlyLandOwner(landId) {
        if (!cropExists(cycleCropId)) revert InvalidCropId();
        Land memory land = landDetails[landId];
        if (land.currentCycleTo < block.timestamp)
            revert LastCycleNotFinished();
        if (cycleFrom > block.timestamp) revert CycleNotStartedYet();
        if (cycleTo <= cycleFrom) revert CycleEndTimeLessThanStart();

        uint256 historyId = land.totalCycles;
        landHistory[landId].push(
            LandHistory({
                landId: landId,
                historyId: historyId,
                cropId: cycleCropId,
                from: cycleFrom,
                to: cycleTo
            })
        );

        landDetails[landId].totalCycles++;
        landDetails[landId].currentCycleCropId = cycleCropId;
        landDetails[landId].currentCycleFrom = cycleFrom;
        landDetails[landId].currentCycleTo = cycleTo;
    }

    // The following functions are overrides required by Solidity.

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override(ERC721, ERC721Enumerable) {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    function _burn(uint256 tokenId) internal override {
        super._burn(tokenId);
        delete landDetails[tokenId];
    }

    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        _requireMinted(tokenId);

        Land memory land = landDetails[tokenId];
        Crop memory crop = cropDetails[
            land.currentCycleTo > block.timestamp ? land.currentCycleCropId : 0
        ];
        string memory base = "data:application/json;base64,";
        string memory json = string(
            abi.encodePacked(
                '{"name":"',
                land.name,
                " (",
                crop.name,
                ')","image":"',
                crop.image,
                '","description":"',
                description,
                '","attributes":[{"trait_type":"lat","value":',
                int256(land.lat).toString(),
                '},{"trait_type":"long","value":',
                int256(land.long).toString(),
                '},{"trait_type":"area","value":',
                land.area.toString(),
                "}]}"
            )
        );

        return string(abi.encodePacked(base, Base64.encode(bytes(json))));
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function cropExists(uint256 cropId) public view returns (bool) {
        return cropId != 0 && cropId <= _cropIdCounter.current();
    }
}
