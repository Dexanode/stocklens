// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @title StockLens Registry
/// @notice Stores lightweight research proofs for the StockLens demo.
contract StockLensRegistry {
    struct Thesis {
        address researcher;
        string symbol;
        uint256 priceCents;
        int256 changeBps;
        uint8 riskScore;
        uint256 timestamp;
    }

    Thesis[] private theses;

    event ThesisRecorded(
        uint256 indexed thesisId,
        address indexed researcher,
        string symbol,
        uint256 priceCents,
        int256 changeBps,
        uint8 riskScore
    );

    function recordThesis(
        string calldata symbol,
        uint256 priceCents,
        int256 changeBps,
        uint8 riskScore
    ) external returns (uint256 thesisId) {
        require(bytes(symbol).length > 0, 'symbol required');
        require(riskScore <= 100, 'score out of range');

        thesisId = theses.length;
        theses.push(Thesis(msg.sender, symbol, priceCents, changeBps, riskScore, block.timestamp));
        emit ThesisRecorded(thesisId, msg.sender, symbol, priceCents, changeBps, riskScore);
    }

    function thesisCount() external view returns (uint256) {
        return theses.length;
    }

    function getThesis(uint256 thesisId) external view returns (Thesis memory) {
        require(thesisId < theses.length, 'unknown thesis');
        return theses[thesisId];
    }
}
