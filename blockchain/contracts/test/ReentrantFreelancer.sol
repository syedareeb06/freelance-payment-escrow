// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../FreelanceEscrow.sol";

/// @dev TEST ONLY. A malicious "freelancer" contract used by the Hardhat tests.
///      - default: when it receives its withdrawal it calls withdraw() again from inside
///        the transfer (a re-entrancy attack) to try to be paid twice;
///      - refuseEth = true: it rejects every incoming payment (to test TransferFailed and
///        to show that a bad recipient cannot block the client, thanks to pull payments).
contract ReentrantFreelancer {
    FreelanceEscrow private immutable target;
    uint256 public attempts;
    bool public reentered;   // true would mean the attack worked
    bytes public lastError;  // revert data of the nested call
    bool public refuseEth;

    constructor(FreelanceEscrow escrow) {
        target = escrow;
    }

    function register(string calldata name) external {
        target.registerUser(FreelanceEscrow.Role.Freelancer, name);
    }

    function accept(uint256 jobId) external {
        target.acceptJob(jobId);
    }

    function submit(uint256 jobId, uint256 index, bytes32 deliverableHash) external {
        target.submitMilestone(jobId, index, deliverableHash, "totally legit work");
    }

    function setRefuseEth(bool value) external {
        refuseEth = value;
    }

    function withdraw() external {
        target.withdraw();
    }

    receive() external payable {
        if (refuseEth) revert("no thanks");
        if (attempts == 0) {
            attempts = 1;
            try target.withdraw() {
                reentered = true;
            } catch (bytes memory reason) {
                lastError = reason;
            }
        }
    }
}
