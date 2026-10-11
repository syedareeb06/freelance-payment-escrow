// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FreelanceEscrow - GigSafe, a smart-contract escrow for freelance work
/// @notice A client locks the full job budget in this contract, split into milestones
///         with deadlines. The freelancer delivers each milestone by committing the
///         SHA-256 hash of the deliverable file (proof of WHAT was delivered and WHEN).
///         The client approves (payment released at once) or asks for a revision. If the
///         client stays silent for the whole review window, the freelancer can claim the
///         milestone automatically. Either side can raise a dispute; a panel of three
///         independent arbiters, appointed by the GigSafe Council, votes on the split and
///         the decision is executed as soon as two of the three agree. Both parties rate
///         each other when the job is complete (on-chain reputation).
/// @dev    Money never leaves the contract inside the business functions: every payout is
///         CREDITED to `balances` and the owner pulls it with `withdraw()` (pull payments).
///         `withdraw()` follows checks-effects-interactions and runs behind a re-entrancy
///         lock. Invariant: address(this).balance == totalEscrowed + totalOwed.
contract FreelanceEscrow {
    enum Role { None, Client, Freelancer }
    /// @dev Open = funded, waiting for the freelancer to accept.
    enum JobStatus { Open, Active, Completed, Cancelled }
    enum MilestoneStatus { Pending, Submitted, RevisionRequested, Approved, AutoReleased, Refunded, Disputed, Resolved }

    struct User {
        Role role;
        string name;
        uint64 joinedAt;
        uint32 jobs;            // jobs posted (client) or accepted (freelancer)
        uint32 completedJobs;   // jobs in which every milestone was settled
        uint32 ratingSum;       // sum of the stars received
        uint32 ratingCount;     // number of ratings received
        uint256 earned;         // freelancer: wei received for work
        uint256 spent;          // client: wei paid to freelancers
    }

    struct Job {
        address client;
        address freelancer;
        string title;
        bytes32 descriptionHash;  // sha256 of the off-chain job brief (the agreed scope of work)
        uint256 budget;           // total wei locked when the job was posted
        uint256 released;         // wei credited to the freelancer so far
        uint256 refunded;         // wei credited back to the client so far
        uint64 reviewWindow;      // seconds the client has to review each submission
        uint64 createdAt;
        uint64 acceptedAt;
        JobStatus status;
        uint8 milestoneCount;
        uint8 settledCount;
        uint8 clientRating;       // stars the client gave the freelancer (0 = not rated yet)
        uint8 freelancerRating;   // stars the freelancer gave the client (0 = not rated yet)
    }

    struct Milestone {
        uint256 amount;
        uint64 deadline;           // deliver by this time (extended when a revision is requested)
        uint64 submittedAt;        // time of the latest submission: starts the review window
        uint64 settledAt;
        bytes32 deliverableHash;   // sha256 of the latest deliverable file
        string note;               // the freelancer's note with the latest submission
        string feedback;           // the client's latest revision request
        uint8 revisions;           // revisions requested so far (max MAX_REVISIONS)
        uint16 freelancerShareBps; // final split once settled: 10000 = everything to the freelancer
        MilestoneStatus status;
    }

    struct Dispute {
        address raisedBy;
        uint64 raisedAt;
        uint64 resolvedAt;
        string reason;
        uint8 voteCount;
        bool resolved;
        bool byMedian;             // true if all three votes differed and the median was executed
        uint16 shareBps;           // executed freelancer share (basis points)
        address[3] voters;         // arbiters, in the order they voted
        uint16[3] votes;           // each arbiter's proposed freelancer share (basis points)
    }

    uint256 public constant MAX_MILESTONES = 10;
    uint8 public constant MAX_REVISIONS = 2;
    uint64 public constant MIN_REVIEW_WINDOW = 1 hours;
    uint64 public constant MAX_REVIEW_WINDOW = 30 days;
    uint16 public constant BPS = 10_000; // 100 %

    /// @notice The GigSafe Council (the deployer): appoints the arbiter panel, nothing else.
    address public immutable admin;

    address[3] private arbiters;
    string[3] private arbiterNames;

    mapping(address => User) private users;
    address[] private userList;

    Job[] private jobs;
    mapping(uint256 => Milestone[]) private milestones;
    mapping(uint256 => mapping(uint256 => Dispute)) private disputes;
    mapping(address => uint256[]) private userJobs;

    /// @notice Pull payments: wei each account can withdraw.
    mapping(address => uint256) public balances;

    uint256 public totalEscrowed; // wei locked in milestones that are not settled yet
    uint256 public totalReleased; // wei credited to freelancers (all time)
    uint256 public totalRefunded; // wei credited back to clients (all time)
    uint256 public totalOwed;     // wei credited but not withdrawn yet
    uint256 public openDisputes;
    uint256 public disputeCount;

    uint256 private lock = 1;

    event ArbiterAppointed(uint8 seat, address indexed arbiter, string name);
    event UserRegistered(address indexed account, Role role, string name);
    event JobCreated(uint256 indexed jobId, address indexed client, address indexed freelancer, string title, uint256 budget, uint8 milestones);
    event JobCancelled(uint256 indexed jobId, uint256 refund);
    event JobAccepted(uint256 indexed jobId, address indexed freelancer);
    event MilestoneSubmitted(uint256 indexed jobId, uint256 index, bytes32 deliverableHash, string note, uint8 revision);
    event MilestoneApproved(uint256 indexed jobId, uint256 index, uint256 amount);
    event RevisionRequested(uint256 indexed jobId, uint256 index, string reason, uint8 revisions, uint64 newDeadline);
    event MilestoneAutoReleased(uint256 indexed jobId, uint256 index, uint256 amount);
    event MilestoneRefunded(uint256 indexed jobId, uint256 index, uint256 amount);
    event DisputeRaised(uint256 indexed jobId, uint256 index, address indexed raisedBy, string reason);
    event DisputeVoted(uint256 indexed jobId, uint256 index, address indexed arbiter, uint16 freelancerShareBps, uint8 votes);
    event DisputeResolved(uint256 indexed jobId, uint256 index, uint16 freelancerShareBps, uint256 toFreelancer, uint256 toClient, bool byMedian);
    event JobCompleted(uint256 indexed jobId, uint256 released, uint256 refunded);
    event Rated(uint256 indexed jobId, address indexed from, address indexed to, uint8 stars);
    event Credited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    error NotAdmin();
    error InvalidArbiters();
    error ConflictOfInterest(address account);
    error DisputesOpen(uint256 count);
    error InvalidRole();
    error InvalidName();
    error AlreadyRegistered(address account);
    error NotClient();
    error NotFreelancer(address account);
    error InvalidInput();
    error InvalidMilestones();
    error DeadlineInPast(uint256 index);
    error InvalidReviewWindow(uint256 minWindow, uint256 maxWindow);
    error WrongDeposit(uint256 expected, uint256 sent);
    error UnknownJob(uint256 jobId);
    error UnknownMilestone(uint256 jobId, uint256 index);
    error NotJobClient();
    error NotJobFreelancer();
    error NotJobParty();
    error JobNotOpen(uint256 jobId);
    error JobNotActive(uint256 jobId);
    error JobNotCompleted(uint256 jobId);
    error InvalidMilestoneState(MilestoneStatus status);
    error SameDeliverable();
    error RevisionLimitReached(uint256 max);
    error ReviewWindowOver(uint256 closedAt);
    error TooEarly(uint256 nowTime, uint256 allowedAt);
    error DeadlineNotPassed(uint256 deadline);
    error NoArbiterPanel();
    error NotArbiter();
    error NoOpenDispute(uint256 jobId, uint256 index);
    error AlreadyVoted();
    error InvalidShare();
    error InvalidRating();
    error AlreadyRated();
    error NothingToWithdraw();
    error TransferFailed();
    error Reentrancy();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    /// @dev Second line of defence next to checks-effects-interactions.
    modifier nonReentrant() {
        if (lock != 1) revert Reentrancy();
        lock = 2;
        _;
        lock = 1;
    }

    constructor() {
        admin = msg.sender;
    }

    // ------------------------------------------------------------------
    // Governance: the Council appoints a permissioned panel of 3 arbiters.
    // Clients and freelancers register themselves (permissionless).
    // ------------------------------------------------------------------

    /// @notice Appoint (or replace) the arbiter panel. Not allowed while a dispute is open,
    ///         so nobody can swap the judges in the middle of a case.
    function setArbiters(address[3] calldata accounts, string[3] calldata names) external onlyAdmin {
        if (openDisputes != 0) revert DisputesOpen(openDisputes);
        for (uint256 i = 0; i < 3; i++) {
            address a = accounts[i];
            if (a == address(0) || bytes(names[i]).length == 0) revert InvalidArbiters();
            if (a == admin || users[a].role != Role.None) revert ConflictOfInterest(a);
            for (uint256 k = 0; k < i; k++) {
                if (accounts[k] == a) revert InvalidArbiters();
            }
        }
        for (uint256 i = 0; i < 3; i++) {
            arbiters[i] = accounts[i];
            arbiterNames[i] = names[i];
            emit ArbiterAppointed(uint8(i), accounts[i], names[i]);
        }
    }

    /// @notice Join as a client or a freelancer, once. Arbiters and the Council cannot take
    ///         part in jobs (conflict of interest).
    function registerUser(Role role, string calldata name) external {
        if (role == Role.None) revert InvalidRole();
        uint256 len = bytes(name).length;
        if (len < 3 || len > 32) revert InvalidName();
        if (msg.sender == admin || isArbiter(msg.sender)) revert ConflictOfInterest(msg.sender);
        if (users[msg.sender].role != Role.None) revert AlreadyRegistered(msg.sender);

        User storage u = users[msg.sender];
        u.role = role;
        u.name = name;
        u.joinedAt = uint64(block.timestamp);
        userList.push(msg.sender);
        emit UserRegistered(msg.sender, role, name);
    }

    // ------------------------------------------------------------------
    // Jobs and escrow
    // ------------------------------------------------------------------

    /// @notice Post a job and lock its full budget. msg.value must equal the sum of the
    ///         milestone amounts.
    /// @param descriptionHash sha256 of the job brief kept off-chain (scope of work)
    /// @param amounts         wei per milestone
    /// @param deadlines       delivery deadline per milestone (unix time, not decreasing)
    /// @param reviewWindow    seconds the client has to review each submission
    function createJob(
        address freelancer,
        string calldata title,
        bytes32 descriptionHash,
        uint256[] calldata amounts,
        uint64[] calldata deadlines,
        uint64 reviewWindow
    ) external payable returns (uint256 jobId) {
        if (users[msg.sender].role != Role.Client) revert NotClient();
        if (users[freelancer].role != Role.Freelancer) revert NotFreelancer(freelancer);
        if (bytes(title).length == 0 || descriptionHash == bytes32(0)) revert InvalidInput();
        if (reviewWindow < MIN_REVIEW_WINDOW || reviewWindow > MAX_REVIEW_WINDOW) {
            revert InvalidReviewWindow(MIN_REVIEW_WINDOW, MAX_REVIEW_WINDOW);
        }
        uint256 total = _checkMilestones(amounts, deadlines);
        if (msg.value != total) revert WrongDeposit(total, msg.value);

        jobId = jobs.length;
        Job storage j = jobs.push();
        j.client = msg.sender;
        j.freelancer = freelancer;
        j.title = title;
        j.descriptionHash = descriptionHash;
        j.budget = total;
        j.reviewWindow = reviewWindow;
        j.createdAt = uint64(block.timestamp);
        j.milestoneCount = uint8(amounts.length);

        Milestone[] storage ms = milestones[jobId];
        for (uint256 i = 0; i < amounts.length; i++) {
            Milestone storage m = ms.push();
            m.amount = amounts[i];
            m.deadline = deadlines[i];
        }

        totalEscrowed += total;
        userJobs[msg.sender].push(jobId);
        userJobs[freelancer].push(jobId);
        users[msg.sender].jobs += 1;
        emit JobCreated(jobId, msg.sender, freelancer, title, total, uint8(amounts.length));
    }

    /// @notice The client takes the money back before the freelancer has accepted.
    function cancelJob(uint256 jobId) external {
        Job storage j = _job(jobId);
        if (msg.sender != j.client) revert NotJobClient();
        if (j.status != JobStatus.Open) revert JobNotOpen(jobId);

        j.status = JobStatus.Cancelled;
        Milestone[] storage ms = milestones[jobId];
        for (uint256 i = 0; i < ms.length; i++) {
            ms[i].status = MilestoneStatus.Refunded;
            ms[i].settledAt = uint64(block.timestamp);
        }
        j.settledCount = j.milestoneCount;
        j.refunded = j.budget;
        totalEscrowed -= j.budget;
        totalRefunded += j.budget;
        emit JobCancelled(jobId, j.budget);
        _credit(j.client, j.budget);
    }

    function acceptJob(uint256 jobId) external {
        Job storage j = _job(jobId);
        if (msg.sender != j.freelancer) revert NotJobFreelancer();
        if (j.status != JobStatus.Open) revert JobNotOpen(jobId);
        j.status = JobStatus.Active;
        j.acceptedAt = uint64(block.timestamp);
        users[msg.sender].jobs += 1;
        emit JobAccepted(jobId, msg.sender);
    }

    // ------------------------------------------------------------------
    // Milestones: deliver, review, auto-release, refund
    // ------------------------------------------------------------------

    /// @notice Deliver a milestone by committing the SHA-256 hash of the file. The block
    ///         time is the proof of when it was delivered. After a revision request the
    ///         freelancer submits again, and the new file must differ from the old one.
    function submitMilestone(uint256 jobId, uint256 index, bytes32 deliverableHash, string calldata note) external {
        (Job storage j, Milestone storage m) = _activeMilestone(jobId, index);
        if (msg.sender != j.freelancer) revert NotJobFreelancer();
        if (m.status != MilestoneStatus.Pending && m.status != MilestoneStatus.RevisionRequested) {
            revert InvalidMilestoneState(m.status);
        }
        if (deliverableHash == bytes32(0)) revert InvalidInput();
        if (deliverableHash == m.deliverableHash) revert SameDeliverable();

        m.deliverableHash = deliverableHash;
        m.note = note;
        m.submittedAt = uint64(block.timestamp);
        m.status = MilestoneStatus.Submitted;
        emit MilestoneSubmitted(jobId, index, deliverableHash, note, m.revisions);
    }

    /// @notice The client accepts the work: the milestone amount is credited to the freelancer.
    function approveMilestone(uint256 jobId, uint256 index) external {
        (Job storage j, Milestone storage m) = _activeMilestone(jobId, index);
        if (msg.sender != j.client) revert NotJobClient();
        if (m.status != MilestoneStatus.Submitted) revert InvalidMilestoneState(m.status);
        emit MilestoneApproved(jobId, index, m.amount);
        _settle(jobId, j, m, MilestoneStatus.Approved, BPS);
    }

    /// @notice Ask for changes, within the review window and at most MAX_REVISIONS times.
    ///         The freelancer gets at least one more review window to deliver again.
    function requestRevision(uint256 jobId, uint256 index, string calldata reason) external {
        (Job storage j, Milestone storage m) = _activeMilestone(jobId, index);
        if (msg.sender != j.client) revert NotJobClient();
        if (m.status != MilestoneStatus.Submitted) revert InvalidMilestoneState(m.status);
        uint256 reviewEnds = uint256(m.submittedAt) + j.reviewWindow;
        if (block.timestamp >= reviewEnds) revert ReviewWindowOver(reviewEnds);
        if (m.revisions >= MAX_REVISIONS) revert RevisionLimitReached(MAX_REVISIONS);
        if (bytes(reason).length == 0) revert InvalidInput();

        m.revisions += 1;
        m.feedback = reason;
        m.status = MilestoneStatus.RevisionRequested;
        uint64 due = uint64(block.timestamp) + j.reviewWindow;
        if (due > m.deadline) m.deadline = due;
        emit RevisionRequested(jobId, index, reason, m.revisions, m.deadline);
    }

    /// @notice Time-based auto-release: if the client did not approve, ask for a revision
    ///         or dispute within the review window, the freelancer claims the payment.
    function claimAfterReview(uint256 jobId, uint256 index) external {
        (Job storage j, Milestone storage m) = _activeMilestone(jobId, index);
        if (msg.sender != j.freelancer) revert NotJobFreelancer();
        if (m.status != MilestoneStatus.Submitted) revert InvalidMilestoneState(m.status);
        uint256 allowedAt = uint256(m.submittedAt) + j.reviewWindow;
        if (block.timestamp < allowedAt) revert TooEarly(block.timestamp, allowedAt);
        emit MilestoneAutoReleased(jobId, index, m.amount);
        _settle(jobId, j, m, MilestoneStatus.AutoReleased, BPS);
    }

    /// @notice The freelancer missed the deadline (nothing delivered, or no new version after
    ///         a revision request): the client gets the milestone amount back.
    function refundMissedDeadline(uint256 jobId, uint256 index) external {
        (Job storage j, Milestone storage m) = _activeMilestone(jobId, index);
        if (msg.sender != j.client) revert NotJobClient();
        if (m.status != MilestoneStatus.Pending && m.status != MilestoneStatus.RevisionRequested) {
            revert InvalidMilestoneState(m.status);
        }
        if (block.timestamp < m.deadline) revert DeadlineNotPassed(m.deadline);
        emit MilestoneRefunded(jobId, index, m.amount);
        _settle(jobId, j, m, MilestoneStatus.Refunded, 0);
    }

    // ------------------------------------------------------------------
    // Disputes: 3 appointed arbiters, executed when 2 of 3 agree
    // ------------------------------------------------------------------

    /// @notice Either party can dispute a delivered milestone (Submitted or RevisionRequested).
    ///         The client must do it inside the review window; after that the freelancer is
    ///         entitled to the automatic release.
    function raiseDispute(uint256 jobId, uint256 index, string calldata reason) external {
        (Job storage j, Milestone storage m) = _activeMilestone(jobId, index);
        bool isClient = msg.sender == j.client;
        if (!isClient && msg.sender != j.freelancer) revert NotJobParty();
        if (arbiters[0] == address(0)) revert NoArbiterPanel();
        if (bytes(reason).length == 0) revert InvalidInput();
        if (m.status == MilestoneStatus.Submitted) {
            uint256 reviewEnds = uint256(m.submittedAt) + j.reviewWindow;
            if (isClient && block.timestamp >= reviewEnds) revert ReviewWindowOver(reviewEnds);
        } else if (m.status != MilestoneStatus.RevisionRequested) {
            revert InvalidMilestoneState(m.status);
        }

        m.status = MilestoneStatus.Disputed;
        Dispute storage d = disputes[jobId][index];
        d.raisedBy = msg.sender;
        d.raisedAt = uint64(block.timestamp);
        d.reason = reason;
        openDisputes += 1;
        disputeCount += 1;
        emit DisputeRaised(jobId, index, msg.sender, reason);
    }

    /// @notice An arbiter proposes the freelancer's share of the milestone (0 - 10000 bps).
    ///         Rule: the split is executed as soon as two arbiters propose the SAME share. If
    ///         all three proposals differ, the median is executed: with at most one faulty or
    ///         biased arbiter, the median always lies between the two honest votes.
    function voteDispute(uint256 jobId, uint256 index, uint16 freelancerShareBps) external {
        if (!isArbiter(msg.sender)) revert NotArbiter();
        if (freelancerShareBps > BPS) revert InvalidShare();
        (Job storage j, Milestone storage m) = _activeMilestone(jobId, index);
        if (m.status != MilestoneStatus.Disputed) revert NoOpenDispute(jobId, index);
        Dispute storage d = disputes[jobId][index];
        for (uint256 i = 0; i < d.voteCount; i++) {
            if (d.voters[i] == msg.sender) revert AlreadyVoted();
        }

        d.voters[d.voteCount] = msg.sender;
        d.votes[d.voteCount] = freelancerShareBps;
        d.voteCount += 1;
        emit DisputeVoted(jobId, index, msg.sender, freelancerShareBps, d.voteCount);

        (bool decided, uint16 share, bool byMedian) = _tally(d);
        if (decided) _resolve(jobId, index, j, m, d, share, byMedian);
    }

    // ------------------------------------------------------------------
    // Reputation and withdrawals
    // ------------------------------------------------------------------

    /// @notice After a completed job each party rates the other once (1-5 stars).
    function rate(uint256 jobId, uint8 stars) external {
        Job storage j = _job(jobId);
        if (j.status != JobStatus.Completed) revert JobNotCompleted(jobId);
        if (stars < 1 || stars > 5) revert InvalidRating();
        address ratee;
        if (msg.sender == j.client) {
            if (j.clientRating != 0) revert AlreadyRated();
            j.clientRating = stars;
            ratee = j.freelancer;
        } else if (msg.sender == j.freelancer) {
            if (j.freelancerRating != 0) revert AlreadyRated();
            j.freelancerRating = stars;
            ratee = j.client;
        } else {
            revert NotJobParty();
        }
        users[ratee].ratingSum += stars;
        users[ratee].ratingCount += 1;
        emit Rated(jobId, msg.sender, ratee, stars);
    }

    /// @notice Pull payment: send everything credited to the caller to the caller's wallet.
    function withdraw() external nonReentrant {
        uint256 amount = balances[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        balances[msg.sender] = 0; // effects first ...
        totalOwed -= amount;
        emit Withdrawn(msg.sender, amount);
        (bool ok, ) = payable(msg.sender).call{value: amount}(""); // ... interaction last
        if (!ok) revert TransferFailed();
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function jobCount() external view returns (uint256) {
        return jobs.length;
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _job(jobId);
    }

    function getMilestones(uint256 jobId) external view returns (Milestone[] memory) {
        _job(jobId);
        return milestones[jobId];
    }

    function getDispute(uint256 jobId, uint256 index) external view returns (Dispute memory) {
        _milestone(jobId, index);
        return disputes[jobId][index];
    }

    /// @notice When the client's review window of a submitted milestone ends (0 if not submitted).
    function reviewEndsAt(uint256 jobId, uint256 index) external view returns (uint256) {
        Milestone storage m = _milestone(jobId, index);
        if (m.submittedAt == 0) return 0;
        return uint256(m.submittedAt) + jobs[jobId].reviewWindow;
    }

    function getUser(address account) external view returns (User memory) {
        return users[account];
    }

    function getUsers() external view returns (address[] memory accounts, User[] memory info) {
        accounts = userList;
        info = new User[](userList.length);
        for (uint256 i = 0; i < userList.length; i++) info[i] = users[userList[i]];
    }

    function getUserJobs(address account) external view returns (uint256[] memory) {
        return userJobs[account];
    }

    /// @return x100 average stars times 100 (e.g. 450 = 4.5 stars), 0 if never rated
    function averageRating(address account) external view returns (uint256 x100, uint32 count) {
        User storage u = users[account];
        count = u.ratingCount;
        x100 = count == 0 ? 0 : (uint256(u.ratingSum) * 100) / count;
    }

    function getArbiters() external view returns (address[3] memory accounts, string[3] memory names) {
        return (arbiters, arbiterNames);
    }

    function isArbiter(address account) public view returns (bool) {
        if (account == address(0)) return false;
        return account == arbiters[0] || account == arbiters[1] || account == arbiters[2];
    }

    /// @notice All ETH held by the contract (escrow + credited, not yet withdrawn).
    function escrowBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    function _job(uint256 jobId) private view returns (Job storage) {
        if (jobId >= jobs.length) revert UnknownJob(jobId);
        return jobs[jobId];
    }

    function _milestone(uint256 jobId, uint256 index) private view returns (Milestone storage) {
        _job(jobId);
        if (index >= milestones[jobId].length) revert UnknownMilestone(jobId, index);
        return milestones[jobId][index];
    }

    function _activeMilestone(uint256 jobId, uint256 index) private view returns (Job storage j, Milestone storage m) {
        m = _milestone(jobId, index);
        j = jobs[jobId];
        if (j.status != JobStatus.Active) revert JobNotActive(jobId);
    }

    /// @dev Validates the milestone plan and returns the total budget.
    function _checkMilestones(uint256[] calldata amounts, uint64[] calldata deadlines) private view returns (uint256 total) {
        uint256 n = amounts.length;
        if (n == 0 || n > MAX_MILESTONES || deadlines.length != n) revert InvalidMilestones();
        for (uint256 i = 0; i < n; i++) {
            if (amounts[i] == 0) revert InvalidMilestones();
            if (deadlines[i] <= block.timestamp) revert DeadlineInPast(i);
            if (i > 0 && deadlines[i] < deadlines[i - 1]) revert InvalidMilestones();
            total += amounts[i];
        }
    }

    /// @dev 2 matching votes decide; with 3 different votes the median decides.
    function _tally(Dispute storage d) private view returns (bool decided, uint16 share, bool byMedian) {
        if (d.voteCount == 2 && d.votes[0] == d.votes[1]) return (true, d.votes[0], false);
        if (d.voteCount == 3) {
            uint16 a = d.votes[0];
            uint16 b = d.votes[1];
            uint16 c = d.votes[2];
            if (c == a || c == b) return (true, c, false); // a != b, otherwise vote 2 had decided
            uint16 lo = a < b ? a : b;
            uint16 hi = a < b ? b : a;
            uint16 median = c < lo ? lo : (c > hi ? hi : c);
            return (true, median, true);
        }
        return (false, 0, false);
    }

    function _resolve(
        uint256 jobId,
        uint256 index,
        Job storage j,
        Milestone storage m,
        Dispute storage d,
        uint16 share,
        bool byMedian
    ) private {
        d.resolved = true;
        d.shareBps = share;
        d.byMedian = byMedian;
        d.resolvedAt = uint64(block.timestamp);
        openDisputes -= 1;
        uint256 toFreelancer = (m.amount * share) / BPS;
        emit DisputeResolved(jobId, index, share, toFreelancer, m.amount - toFreelancer, byMedian);
        _settle(jobId, j, m, MilestoneStatus.Resolved, share);
    }

    /// @dev Final bookkeeping of a milestone. Only credits balances: no ETH moves here.
    function _settle(uint256 jobId, Job storage j, Milestone storage m, MilestoneStatus outcome, uint16 shareBps) private {
        uint256 toFreelancer = (m.amount * shareBps) / BPS;
        uint256 toClient = m.amount - toFreelancer;
        m.status = outcome;
        m.freelancerShareBps = shareBps;
        m.settledAt = uint64(block.timestamp);
        totalEscrowed -= m.amount;

        if (toFreelancer > 0) {
            j.released += toFreelancer;
            totalReleased += toFreelancer;
            users[j.freelancer].earned += toFreelancer;
            users[j.client].spent += toFreelancer;
            _credit(j.freelancer, toFreelancer);
        }
        if (toClient > 0) {
            j.refunded += toClient;
            totalRefunded += toClient;
            _credit(j.client, toClient);
        }

        j.settledCount += 1;
        if (j.settledCount == j.milestoneCount) {
            j.status = JobStatus.Completed;
            users[j.client].completedJobs += 1;
            users[j.freelancer].completedJobs += 1;
            emit JobCompleted(jobId, j.released, j.refunded);
        }
    }

    function _credit(address account, uint256 amount) private {
        balances[account] += amount;
        totalOwed += amount;
        emit Credited(account, amount);
    }
}
