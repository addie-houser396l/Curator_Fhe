pragma solidity ^0.8.24;
import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CuratorFhe is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    mapping(uint256 => bool) public batchClosed;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event PauseToggled(bool paused);
    event CooldownSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 batchId);
    event BatchClosed(uint256 batchId);
    event ContentSubmitted(address indexed submitter, uint256 batchId, euint32 indexed encryptedContentId);
    event DecryptionRequested(uint256 indexed requestId, uint256 batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 batchId, uint32[] cleartexts);

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosedOrInvalid();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidBatchId();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        emit ProviderAdded(owner);
        cooldownSeconds = 60; // Default cooldown
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PauseToggled(_paused);
    }

    function setCooldown(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        batchClosed[currentBatchId] = false;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch(uint256 batchId) external onlyOwner {
        if (batchId == 0 || batchId > currentBatchId || !batchClosed[batchId]) revert InvalidBatchId();
        batchClosed[batchId] = true;
        emit BatchClosed(batchId);
    }

    function submitContent(euint32 encryptedContentId) external onlyProvider whenNotPaused {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        if (batchClosed[currentBatchId]) revert BatchClosedOrInvalid();

        lastSubmissionTime[msg.sender] = block.timestamp;

        // Store encrypted content. For this example, we just emit it.
        // A real contract would store it in a mapping, e.g., batchToContents[batchId].push(encryptedContentId);
        emit ContentSubmitted(msg.sender, currentBatchId, encryptedContentId);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 v) internal {
        if (!v.isInitialized()) {
            v.asEuint32(0); // Initialize to 0 if not already initialized
        }
    }

    function _requireInitialized(euint32 v) internal pure {
        if (!v.isInitialized()) revert("FHE: euint32 not initialized");
    }

    function _requireInitialized(ebool b) internal pure {
        if (!b.isInitialized()) revert("FHE: ebool not initialized");
    }

    function requestDecryptionForBatch(uint256 batchId) external onlyProvider whenNotPaused {
        if (batchId == 0 || batchId > currentBatchId) revert InvalidBatchId();
        if (!batchClosed[batchId]) revert BatchClosedOrInvalid(); // Must be closed to process

        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        // For this example, we'll assume we want to decrypt a count of items in the batch.
        // This count would typically be derived from encrypted data stored in the contract.
        // Here, we'll use a placeholder: the batchId itself, encrypted.
        euint32 encryptedCount = FHE.asEuint32(uint32(batchId)); // Placeholder for actual encrypted count

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = encryptedCount.toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        emit DecryptionRequested(requestId, batchId, stateHash);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();

        // Rebuild ciphertexts array in the exact same order as during requestDecryptionForBatch
        // For this example, it's just one ciphertext based on batchId
        euint32 encryptedCount = FHE.asEuint32(uint32(decryptionContexts[requestId].batchId));
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = encryptedCount.toBytes32();

        bytes32 currentHash = _hashCiphertexts(cts); // Recalculate state hash

        // State verification: ensure contract state relevant to this decryption hasn't changed
        if (currentHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        // Proof verification
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Decode cleartexts
        // The cleartexts array is expected to have elements corresponding to the cts array
        // Each element is 32 bytes, so for one euint32, it's one 32-byte element.
        // We need to cast it to the expected type (uint32 for euint32).
        uint32[] memory plaintextValues = new uint32[](1);
        assembly {
            plaintextValues[0] := mload(add(cleartexts, 0x20)) // Load first 32 bytes as uint32
        }

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, plaintextValues);
    }
}