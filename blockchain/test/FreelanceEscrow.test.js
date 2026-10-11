const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

const Role = { None: 0, Client: 1, Freelancer: 2 };
const JobStatus = { Open: 0, Active: 1, Completed: 2, Cancelled: 3 };
const MS = { Pending: 0, Submitted: 1, RevisionRequested: 2, Approved: 3, AutoReleased: 4, Refunded: 5, Disputed: 6, Resolved: 7 };
const ETH = (v) => ethers.parseEther(String(v));
const sha = (text) => ethers.sha256(ethers.toUtf8Bytes(text));
const DAY = 24 * 3600;
const AMOUNTS = [ETH(2), ETH("1.5"), ETH(1)];
const BUDGET = ETH("4.5");
const PANEL = ["Arbiter Meera", "Arbiter Daniel", "Arbiter Kofi"];

describe("FreelanceEscrow", function () {
  async function deployFixture() {
    const [council, meera, daniel, kofi, bluefin, bakery, priya, arjun, sam, outsider] = await ethers.getSigners();
    const escrow = await ethers.deployContract("FreelanceEscrow", [], council);
    await escrow.setArbiters([meera.address, daniel.address, kofi.address], PANEL);
    await escrow.connect(bluefin).registerUser(Role.Client, "Bluefin Startups");
    await escrow.connect(bakery).registerUser(Role.Client, "Corner Bakery Co.");
    await escrow.connect(priya).registerUser(Role.Freelancer, "pixel_priya");
    await escrow.connect(arjun).registerUser(Role.Freelancer, "dev_arjun");
    return { escrow, council, meera, daniel, kofi, bluefin, bakery, priya, arjun, sam, outsider };
  }

  async function deadlinesFromNow(days = [3, 7, 10]) {
    const now = await time.latest();
    return days.map((d) => now + d * DAY);
  }

  /** Job 0: Bluefin -> pixel_priya, 3 milestones (2 + 1.5 + 1 ETH), 3-day review window. */
  async function jobFixture() {
    const f = await deployFixture();
    const deadlines = await deadlinesFromNow();
    await f.escrow.connect(f.bluefin).createJob(f.priya.address, "Brand kit", sha("brief"), AMOUNTS, deadlines, 3 * DAY, { value: BUDGET });
    return { ...f, deadlines };
  }

  async function activeFixture() {
    const f = await jobFixture();
    await f.escrow.connect(f.priya).acceptJob(0);
    return f;
  }

  /** Milestone 0 of job 0 delivered (logo v1). */
  async function submittedFixture() {
    const f = await activeFixture();
    await f.escrow.connect(f.priya).submitMilestone(0, 0, sha("logo-v1"), "First logo concepts");
    return f;
  }

  async function disputedFixture() {
    const f = await submittedFixture();
    await f.escrow.connect(f.bluefin).raiseDispute(0, 0, "Logo does not follow the brief");
    return f;
  }

  async function expectInvariant(escrow) {
    const held = await ethers.provider.getBalance(await escrow.getAddress());
    expect(held).to.equal((await escrow.totalEscrowed()) + (await escrow.totalOwed()));
  }

  describe("Governance and registration", function () {
    it("the Council appoints a panel of three arbiters, nobody else can", async function () {
      const [council, meera, daniel, kofi, outsider] = await ethers.getSigners();
      const escrow = await ethers.deployContract("FreelanceEscrow", [], council);
      await expect(escrow.connect(outsider).setArbiters([meera.address, daniel.address, kofi.address], PANEL))
        .to.be.revertedWithCustomError(escrow, "NotAdmin");
      await expect(escrow.setArbiters([meera.address, daniel.address, kofi.address], PANEL))
        .to.emit(escrow, "ArbiterAppointed").withArgs(0, meera.address, "Arbiter Meera")
        .and.to.emit(escrow, "ArbiterAppointed").withArgs(2, kofi.address, "Arbiter Kofi");
      const [accounts, names] = await escrow.getArbiters();
      expect(accounts).to.deep.equal([meera.address, daniel.address, kofi.address]);
      expect(names).to.deep.equal(PANEL);
      expect(await escrow.isArbiter(daniel.address)).to.equal(true);
      expect(await escrow.isArbiter(outsider.address)).to.equal(false);
      expect(await escrow.admin()).to.equal(council.address);
    });

    it("rejects an invalid or conflicted panel", async function () {
      const { escrow, council, meera, daniel, bluefin } = await loadFixture(deployFixture);
      await expect(escrow.setArbiters([meera.address, meera.address, daniel.address], PANEL))
        .to.be.revertedWithCustomError(escrow, "InvalidArbiters");
      await expect(escrow.setArbiters([meera.address, ethers.ZeroAddress, daniel.address], PANEL))
        .to.be.revertedWithCustomError(escrow, "InvalidArbiters");
      await expect(escrow.setArbiters([meera.address, daniel.address, council.address], PANEL))
        .to.be.revertedWithCustomError(escrow, "ConflictOfInterest").withArgs(council.address);
      await expect(escrow.setArbiters([meera.address, daniel.address, bluefin.address], PANEL))
        .to.be.revertedWithCustomError(escrow, "ConflictOfInterest").withArgs(bluefin.address);
    });

    it("clients and freelancers register themselves once (permissionless)", async function () {
      const { escrow, council, meera, bluefin, priya, sam } = await loadFixture(deployFixture);
      await expect(escrow.connect(sam).registerUser(Role.Freelancer, "copy_sam"))
        .to.emit(escrow, "UserRegistered").withArgs(sam.address, Role.Freelancer, "copy_sam");
      const u = await escrow.getUser(sam.address);
      expect(u.role).to.equal(Role.Freelancer);
      expect(u.name).to.equal("copy_sam");
      expect(u.joinedAt).to.equal(await time.latest());
      await expect(escrow.connect(sam).registerUser(Role.Client, "sam again"))
        .to.be.revertedWithCustomError(escrow, "AlreadyRegistered").withArgs(sam.address);
      await expect(escrow.connect(bluefin).registerUser(Role.Freelancer, "moonlighting"))
        .to.be.revertedWithCustomError(escrow, "AlreadyRegistered");
      await expect(escrow.connect(priya).registerUser(Role.None, "nobody")).to.be.revertedWithCustomError(escrow, "InvalidRole");
      await expect(escrow.connect(meera).registerUser(Role.Client, "Meera Inc")).to.be.revertedWithCustomError(escrow, "ConflictOfInterest");
      await expect(escrow.connect(council).registerUser(Role.Client, "Council")).to.be.revertedWithCustomError(escrow, "ConflictOfInterest");
      const [, , , , , , , , , outsider] = await ethers.getSigners();
      await expect(escrow.connect(outsider).registerUser(Role.Client, "ab")).to.be.revertedWithCustomError(escrow, "InvalidName");
      const [accounts, info] = await escrow.getUsers();
      expect(accounts.length).to.equal(5);
      expect(info[4].name).to.equal("copy_sam");
    });
  });

  describe("Posting a job (escrow)", function () {
    it("locks exactly the budget and stores the milestone plan", async function () {
      const { escrow, bluefin, priya } = await loadFixture(deployFixture);
      const deadlines = await deadlinesFromNow();
      const tx = escrow.connect(bluefin).createJob(priya.address, "Brand kit", sha("brief"), AMOUNTS, deadlines, 3 * DAY, { value: BUDGET });
      await expect(tx).to.emit(escrow, "JobCreated").withArgs(0, bluefin.address, priya.address, "Brand kit", BUDGET, 3);
      await expect(tx).to.changeEtherBalances([bluefin, escrow], [-BUDGET, BUDGET]);
      const j = await escrow.getJob(0);
      expect(j.client).to.equal(bluefin.address);
      expect(j.descriptionHash).to.equal(sha("brief"));
      expect(j.budget).to.equal(BUDGET);
      expect(j.status).to.equal(JobStatus.Open);
      expect(j.milestoneCount).to.equal(3);
      const ms = await escrow.getMilestones(0);
      expect(ms.map((m) => m.amount)).to.deep.equal(AMOUNTS);
      expect(ms.map((m) => Number(m.deadline))).to.deep.equal(deadlines);
      expect(ms[0].status).to.equal(MS.Pending);
      expect(await escrow.totalEscrowed()).to.equal(BUDGET);
      expect(await escrow.escrowBalance()).to.equal(BUDGET);
      expect(await escrow.getUserJobs(priya.address)).to.deep.equal([0n]);
      expect((await escrow.getUser(bluefin.address)).jobs).to.equal(1);
      expect(await escrow.jobCount()).to.equal(1);
    });

    it("only a registered client can post, and only to a registered freelancer", async function () {
      const { escrow, bluefin, bakery, priya, sam, outsider } = await loadFixture(deployFixture);
      const d = await deadlinesFromNow();
      await expect(escrow.connect(priya).createJob(priya.address, "Self deal", sha("b"), AMOUNTS, d, DAY, { value: BUDGET }))
        .to.be.revertedWithCustomError(escrow, "NotClient");
      await expect(escrow.connect(outsider).createJob(priya.address, "Job", sha("b"), AMOUNTS, d, DAY, { value: BUDGET }))
        .to.be.revertedWithCustomError(escrow, "NotClient");
      await expect(escrow.connect(bluefin).createJob(sam.address, "Job", sha("b"), AMOUNTS, d, DAY, { value: BUDGET }))
        .to.be.revertedWithCustomError(escrow, "NotFreelancer").withArgs(sam.address);
      await expect(escrow.connect(bluefin).createJob(bakery.address, "Job", sha("b"), AMOUNTS, d, DAY, { value: BUDGET }))
        .to.be.revertedWithCustomError(escrow, "NotFreelancer").withArgs(bakery.address);
    });

    it("validates the deposit, milestones, deadlines and review window", async function () {
      const { escrow, bluefin, priya } = await loadFixture(deployFixture);
      const c = escrow.connect(bluefin);
      const d = await deadlinesFromNow();
      const p = priya.address;
      await expect(c.createJob(p, "Job", sha("b"), AMOUNTS, d, DAY, { value: ETH(4) }))
        .to.be.revertedWithCustomError(escrow, "WrongDeposit").withArgs(BUDGET, ETH(4));
      await expect(c.createJob(p, "Job", sha("b"), AMOUNTS, d.slice(0, 2), DAY, { value: BUDGET }))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestones");
      await expect(c.createJob(p, "Job", sha("b"), [ETH(2), 0, ETH(1)], d, DAY, { value: ETH(3) }))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestones");
      await expect(c.createJob(p, "Job", sha("b"), AMOUNTS, [d[1], d[0], d[2]], DAY, { value: BUDGET }))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestones");
      await expect(c.createJob(p, "Job", sha("b"), Array(11).fill(1n), Array(11).fill(d[0]), DAY, { value: 11 }))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestones");
      await expect(c.createJob(p, "Job", sha("b"), [], [], DAY, { value: 0 })).to.be.revertedWithCustomError(escrow, "InvalidMilestones");
      await expect(c.createJob(p, "Job", sha("b"), AMOUNTS, [d[0], (await time.latest()) - 1, d[2]], DAY, { value: BUDGET }))
        .to.be.revertedWithCustomError(escrow, "DeadlineInPast").withArgs(1);
      await expect(c.createJob(p, "Job", sha("b"), AMOUNTS, d, 60, { value: BUDGET }))
        .to.be.revertedWithCustomError(escrow, "InvalidReviewWindow").withArgs(3600, 30 * DAY);
      await expect(c.createJob(p, "", sha("b"), AMOUNTS, d, DAY, { value: BUDGET })).to.be.revertedWithCustomError(escrow, "InvalidInput");
      await expect(c.createJob(p, "Job", ethers.ZeroHash, AMOUNTS, d, DAY, { value: BUDGET })).to.be.revertedWithCustomError(escrow, "InvalidInput");
    });

    it("the client can cancel before acceptance and the whole budget is credited back", async function () {
      const { escrow, bluefin, priya } = await loadFixture(jobFixture);
      await expect(escrow.connect(priya).cancelJob(0)).to.be.revertedWithCustomError(escrow, "NotJobClient");
      await expect(escrow.connect(bluefin).cancelJob(0))
        .to.emit(escrow, "JobCancelled").withArgs(0, BUDGET)
        .and.to.emit(escrow, "Credited").withArgs(bluefin.address, BUDGET);
      expect(await escrow.balances(bluefin.address)).to.equal(BUDGET);
      expect(await escrow.totalEscrowed()).to.equal(0);
      expect((await escrow.getJob(0)).status).to.equal(JobStatus.Cancelled);
      expect((await escrow.getMilestones(0)).every((m) => Number(m.status) === MS.Refunded)).to.equal(true);
      await expect(escrow.connect(priya).acceptJob(0)).to.be.revertedWithCustomError(escrow, "JobNotOpen").withArgs(0);
      await expect(escrow.connect(bluefin).cancelJob(0)).to.be.revertedWithCustomError(escrow, "JobNotOpen");
      await expectInvariant(escrow);
    });

    it("only the chosen freelancer can accept, and only once", async function () {
      const { escrow, bluefin, priya, arjun } = await loadFixture(jobFixture);
      await expect(escrow.connect(arjun).acceptJob(0)).to.be.revertedWithCustomError(escrow, "NotJobFreelancer");
      await expect(escrow.connect(priya).acceptJob(0)).to.emit(escrow, "JobAccepted").withArgs(0, priya.address);
      const j = await escrow.getJob(0);
      expect(j.status).to.equal(JobStatus.Active);
      expect(j.acceptedAt).to.equal(await time.latest());
      expect((await escrow.getUser(priya.address)).jobs).to.equal(1);
      await expect(escrow.connect(priya).acceptJob(0)).to.be.revertedWithCustomError(escrow, "JobNotOpen").withArgs(0);
      await expect(escrow.connect(bluefin).cancelJob(0)).to.be.revertedWithCustomError(escrow, "JobNotOpen");
      await expect(escrow.connect(priya).acceptJob(9)).to.be.revertedWithCustomError(escrow, "UnknownJob").withArgs(9);
    });
  });

  describe("Delivering milestones", function () {
    it("a submission commits the deliverable hash and the block time", async function () {
      const { escrow, priya } = await loadFixture(activeFixture);
      await expect(escrow.connect(priya).submitMilestone(0, 0, sha("logo-v1"), "First logo concepts"))
        .to.emit(escrow, "MilestoneSubmitted").withArgs(0, 0, sha("logo-v1"), "First logo concepts", 0);
      const m = (await escrow.getMilestones(0))[0];
      expect(m.deliverableHash).to.equal(sha("logo-v1"));
      expect(m.submittedAt).to.equal(await time.latest());
      expect(m.note).to.equal("First logo concepts");
      expect(m.status).to.equal(MS.Submitted);
      expect(await escrow.reviewEndsAt(0, 0)).to.equal(Number(m.submittedAt) + 3 * DAY);
      expect(await escrow.reviewEndsAt(0, 1)).to.equal(0);
    });

    it("only the freelancer submits, only on an active job, once per round", async function () {
      const { escrow, bluefin, priya, arjun } = await loadFixture(jobFixture);
      await expect(escrow.connect(priya).submitMilestone(0, 0, sha("x"), "")).to.be.revertedWithCustomError(escrow, "JobNotActive").withArgs(0);
      await escrow.connect(priya).acceptJob(0);
      await expect(escrow.connect(bluefin).submitMilestone(0, 0, sha("x"), "")).to.be.revertedWithCustomError(escrow, "NotJobFreelancer");
      await expect(escrow.connect(arjun).submitMilestone(0, 0, sha("x"), "")).to.be.revertedWithCustomError(escrow, "NotJobFreelancer");
      await expect(escrow.connect(priya).submitMilestone(0, 0, ethers.ZeroHash, "")).to.be.revertedWithCustomError(escrow, "InvalidInput");
      await expect(escrow.connect(priya).submitMilestone(0, 5, sha("x"), ""))
        .to.be.revertedWithCustomError(escrow, "UnknownMilestone").withArgs(0, 5);
      await escrow.connect(priya).submitMilestone(0, 0, sha("x"), "");
      await expect(escrow.connect(priya).submitMilestone(0, 0, sha("y"), ""))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestoneState").withArgs(MS.Submitted);
    });

    it("approval credits the freelancer at once (pull payment: no ETH moves yet)", async function () {
      const { escrow, bluefin, priya, arjun } = await loadFixture(submittedFixture);
      await expect(escrow.connect(arjun).approveMilestone(0, 0)).to.be.revertedWithCustomError(escrow, "NotJobClient");
      await expect(escrow.connect(bluefin).approveMilestone(0, 1))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestoneState").withArgs(MS.Pending);
      const tx = escrow.connect(bluefin).approveMilestone(0, 0);
      await expect(tx).to.emit(escrow, "MilestoneApproved").withArgs(0, 0, ETH(2))
        .and.to.emit(escrow, "Credited").withArgs(priya.address, ETH(2));
      await expect(tx).to.changeEtherBalances([priya, escrow], [0, 0]);
      expect(await escrow.balances(priya.address)).to.equal(ETH(2));
      const m = (await escrow.getMilestones(0))[0];
      expect(m.status).to.equal(MS.Approved);
      expect(m.freelancerShareBps).to.equal(10000);
      expect((await escrow.getUser(priya.address)).earned).to.equal(ETH(2));
      expect((await escrow.getUser(bluefin.address)).spent).to.equal(ETH(2));
      expect(await escrow.totalReleased()).to.equal(ETH(2));
      expect(await escrow.totalEscrowed()).to.equal(ETH("2.5"));
      expect((await escrow.getJob(0)).released).to.equal(ETH(2));
      await expect(escrow.connect(bluefin).approveMilestone(0, 0))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestoneState").withArgs(MS.Approved);
      await expectInvariant(escrow);
    });

    it("a revision request extends the deadline and the new version must differ", async function () {
      const { escrow, bluefin, priya, deadlines } = await loadFixture(submittedFixture);
      await expect(escrow.connect(priya).requestRevision(0, 0, "Use the brand blue")).to.be.revertedWithCustomError(escrow, "NotJobClient");
      await expect(escrow.connect(bluefin).requestRevision(0, 0, "")).to.be.revertedWithCustomError(escrow, "InvalidInput");
      const tx = await escrow.connect(bluefin).requestRevision(0, 0, "Use the brand blue");
      const now = (await ethers.provider.getBlock((await tx.wait()).blockNumber)).timestamp;
      const expected = Math.max(deadlines[0], now + 3 * DAY);
      await expect(tx).to.emit(escrow, "RevisionRequested").withArgs(0, 0, "Use the brand blue", 1, expected);
      let m = (await escrow.getMilestones(0))[0];
      expect(m.status).to.equal(MS.RevisionRequested);
      expect(m.feedback).to.equal("Use the brand blue");
      expect(m.deadline).to.equal(expected);
      await expect(escrow.connect(priya).submitMilestone(0, 0, sha("logo-v1"), "same file"))
        .to.be.revertedWithCustomError(escrow, "SameDeliverable");
      await expect(escrow.connect(priya).submitMilestone(0, 0, sha("logo-v2"), "Brand blue applied"))
        .to.emit(escrow, "MilestoneSubmitted").withArgs(0, 0, sha("logo-v2"), "Brand blue applied", 1);
      m = (await escrow.getMilestones(0))[0];
      expect(m.deliverableHash).to.equal(sha("logo-v2"));
      expect(m.revisions).to.equal(1);
    });

    it("at most two revisions, and only inside the review window", async function () {
      const { escrow, bluefin, priya } = await loadFixture(submittedFixture);
      await escrow.connect(bluefin).requestRevision(0, 0, "Round 1");
      await escrow.connect(priya).submitMilestone(0, 0, sha("logo-v2"), "");
      await escrow.connect(bluefin).requestRevision(0, 0, "Round 2");
      await escrow.connect(priya).submitMilestone(0, 0, sha("logo-v3"), "");
      await expect(escrow.connect(bluefin).requestRevision(0, 0, "Round 3"))
        .to.be.revertedWithCustomError(escrow, "RevisionLimitReached").withArgs(2);
      const ends = await escrow.reviewEndsAt(0, 0);
      await time.increaseTo(ends);
      await expect(escrow.connect(bluefin).requestRevision(0, 0, "Too late"))
        .to.be.revertedWithCustomError(escrow, "ReviewWindowOver").withArgs(ends);
      await expect(escrow.connect(bluefin).approveMilestone(0, 0)).to.emit(escrow, "MilestoneApproved"); // approving is always allowed
    });
  });

  describe("Time-based rules", function () {
    it("auto-release: the freelancer can claim only after the review window", async function () {
      const { escrow, bluefin, priya } = await loadFixture(submittedFixture);
      const allowedAt = await escrow.reviewEndsAt(0, 0);
      await expect(escrow.connect(priya).claimAfterReview(0, 0)).to.be.revertedWithCustomError(escrow, "TooEarly");
      await time.increaseTo(allowedAt - 10n);
      await expect(escrow.connect(priya).claimAfterReview(0, 0))
        .to.be.revertedWithCustomError(escrow, "TooEarly").withArgs(anyValue, allowedAt);
      await time.increaseTo(allowedAt);
      await expect(escrow.connect(bluefin).claimAfterReview(0, 0)).to.be.revertedWithCustomError(escrow, "NotJobFreelancer");
      await expect(escrow.connect(priya).claimAfterReview(0, 0))
        .to.emit(escrow, "MilestoneAutoReleased").withArgs(0, 0, ETH(2))
        .and.to.emit(escrow, "Credited").withArgs(priya.address, ETH(2));
      expect((await escrow.getMilestones(0))[0].status).to.equal(MS.AutoReleased);
      await expect(escrow.connect(priya).claimAfterReview(0, 1))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestoneState").withArgs(MS.Pending);
    });

    it("a refund is possible only after the delivery deadline was missed", async function () {
      const { escrow, bluefin, priya, deadlines } = await loadFixture(submittedFixture);
      await expect(escrow.connect(bluefin).refundMissedDeadline(0, 1))
        .to.be.revertedWithCustomError(escrow, "DeadlineNotPassed").withArgs(deadlines[1]);
      await time.increaseTo(deadlines[1]);
      await expect(escrow.connect(priya).refundMissedDeadline(0, 1)).to.be.revertedWithCustomError(escrow, "NotJobClient");
      await expect(escrow.connect(bluefin).refundMissedDeadline(0, 1))
        .to.emit(escrow, "MilestoneRefunded").withArgs(0, 1, ETH("1.5"))
        .and.to.emit(escrow, "Credited").withArgs(bluefin.address, ETH("1.5"));
      expect(await escrow.balances(bluefin.address)).to.equal(ETH("1.5"));
      expect((await escrow.getJob(0)).refunded).to.equal(ETH("1.5"));
      // milestone 0 was delivered on time: it cannot be refunded, only reviewed or claimed
      await expect(escrow.connect(bluefin).refundMissedDeadline(0, 0))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestoneState").withArgs(MS.Submitted);
      await expectInvariant(escrow);
    });

    it("a revision request gives the freelancer a fresh window before any refund", async function () {
      const { escrow, bluefin, priya, deadlines } = await loadFixture(activeFixture);
      await time.increaseTo(deadlines[0] - 3600);
      await escrow.connect(priya).submitMilestone(0, 0, sha("logo-v1"), "Just in time");
      await escrow.connect(bluefin).requestRevision(0, 0, "Needs a darker variant");
      const due = (await escrow.getMilestones(0))[0].deadline;
      expect(due).to.be.greaterThan(deadlines[0]);
      await time.increaseTo(deadlines[0] + 60);
      await expect(escrow.connect(bluefin).refundMissedDeadline(0, 0))
        .to.be.revertedWithCustomError(escrow, "DeadlineNotPassed").withArgs(due);
      await time.increaseTo(due);
      await expect(escrow.connect(bluefin).refundMissedDeadline(0, 0)).to.emit(escrow, "MilestoneRefunded").withArgs(0, 0, ETH(2));
    });
  });

  describe("Disputes (2-of-3 arbiter panel)", function () {
    it("only the two parties can raise a dispute on a delivered milestone", async function () {
      const { escrow, bluefin, priya, meera, outsider } = await loadFixture(submittedFixture);
      await expect(escrow.connect(outsider).raiseDispute(0, 0, "x")).to.be.revertedWithCustomError(escrow, "NotJobParty");
      await expect(escrow.connect(meera).raiseDispute(0, 0, "x")).to.be.revertedWithCustomError(escrow, "NotJobParty");
      await expect(escrow.connect(bluefin).raiseDispute(0, 0, "")).to.be.revertedWithCustomError(escrow, "InvalidInput");
      await expect(escrow.connect(bluefin).raiseDispute(0, 1, "Nothing delivered"))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestoneState").withArgs(MS.Pending);
      await expect(escrow.connect(bluefin).raiseDispute(0, 0, "Logo does not follow the brief"))
        .to.emit(escrow, "DisputeRaised").withArgs(0, 0, bluefin.address, "Logo does not follow the brief");
      expect(await escrow.openDisputes()).to.equal(1);
      expect(await escrow.disputeCount()).to.equal(1);
      const d = await escrow.getDispute(0, 0);
      expect(d.raisedBy).to.equal(bluefin.address);
      expect(d.reason).to.equal("Logo does not follow the brief");
      // the money is frozen for both sides until the panel decides
      await expect(escrow.connect(bluefin).approveMilestone(0, 0))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestoneState").withArgs(MS.Disputed);
      await time.increase(4 * DAY);
      await expect(escrow.connect(priya).claimAfterReview(0, 0))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestoneState").withArgs(MS.Disputed);
    });

    it("the client disputes inside the review window; the freelancer can dispute a revision request", async function () {
      const { escrow, bluefin, priya } = await loadFixture(submittedFixture);
      const ends = await escrow.reviewEndsAt(0, 0);
      await escrow.connect(bluefin).requestRevision(0, 0, "Change everything");
      await expect(escrow.connect(priya).raiseDispute(0, 0, "Request is outside the agreed scope"))
        .to.emit(escrow, "DisputeRaised").withArgs(0, 0, priya.address, "Request is outside the agreed scope");

      const f = await loadFixture(submittedFixture);
      await time.increaseTo(ends);
      await expect(f.escrow.connect(f.bluefin).raiseDispute(0, 0, "Too late"))
        .to.be.revertedWithCustomError(f.escrow, "ReviewWindowOver").withArgs(ends);
    });

    it("two matching votes out of three execute the split", async function () {
      const { escrow, bluefin, priya, meera, daniel, kofi } = await loadFixture(disputedFixture);
      await expect(escrow.connect(meera).voteDispute(0, 0, 7000)).to.emit(escrow, "DisputeVoted").withArgs(0, 0, meera.address, 7000, 1);
      expect(await escrow.openDisputes()).to.equal(1); // one vote is not a decision
      const tx = escrow.connect(daniel).voteDispute(0, 0, 7000);
      await expect(tx).to.emit(escrow, "DisputeResolved").withArgs(0, 0, 7000, ETH("1.4"), ETH("0.6"), false);
      await expect(tx).to.emit(escrow, "Credited").withArgs(priya.address, ETH("1.4"));
      await expect(tx).to.emit(escrow, "Credited").withArgs(bluefin.address, ETH("0.6"));
      expect(await escrow.balances(priya.address)).to.equal(ETH("1.4"));
      expect(await escrow.balances(bluefin.address)).to.equal(ETH("0.6"));
      const m = (await escrow.getMilestones(0))[0];
      expect(m.status).to.equal(MS.Resolved);
      expect(m.freelancerShareBps).to.equal(7000);
      const d = await escrow.getDispute(0, 0);
      expect(d.resolved).to.equal(true);
      expect(d.voteCount).to.equal(2);
      expect(d.voters[1]).to.equal(daniel.address);
      expect(await escrow.openDisputes()).to.equal(0);
      await expect(escrow.connect(kofi).voteDispute(0, 0, 0)).to.be.revertedWithCustomError(escrow, "NoOpenDispute").withArgs(0, 0);
      await expectInvariant(escrow);
    });

    it("if the first two votes differ, the third decides; three different votes execute the median", async function () {
      const { escrow, meera, daniel, kofi } = await loadFixture(disputedFixture);
      await escrow.connect(meera).voteDispute(0, 0, 10000);
      await escrow.connect(daniel).voteDispute(0, 0, 2000);
      expect((await escrow.getDispute(0, 0)).resolved).to.equal(false);
      await expect(escrow.connect(kofi).voteDispute(0, 0, 6000))
        .to.emit(escrow, "DisputeResolved").withArgs(0, 0, 6000, ETH("1.2"), ETH("0.8"), true);
      expect((await escrow.getDispute(0, 0)).byMedian).to.equal(true);

      const g = await loadFixture(disputedFixture);
      await g.escrow.connect(g.meera).voteDispute(0, 0, 5000);
      await g.escrow.connect(g.daniel).voteDispute(0, 0, 8000);
      await expect(g.escrow.connect(g.kofi).voteDispute(0, 0, 8000))
        .to.emit(g.escrow, "DisputeResolved").withArgs(0, 0, 8000, ETH("1.6"), ETH("0.4"), false);
    });

    it("only appointed arbiters vote, each once, with a share between 0 and 100 %", async function () {
      const { escrow, council, bluefin, meera } = await loadFixture(disputedFixture);
      await expect(escrow.connect(bluefin).voteDispute(0, 0, 0)).to.be.revertedWithCustomError(escrow, "NotArbiter");
      await expect(escrow.connect(council).voteDispute(0, 0, 0)).to.be.revertedWithCustomError(escrow, "NotArbiter");
      await expect(escrow.connect(meera).voteDispute(0, 0, 10001)).to.be.revertedWithCustomError(escrow, "InvalidShare");
      await expect(escrow.connect(meera).voteDispute(0, 1, 5000)).to.be.revertedWithCustomError(escrow, "NoOpenDispute").withArgs(0, 1);
      await escrow.connect(meera).voteDispute(0, 0, 5000);
      await expect(escrow.connect(meera).voteDispute(0, 0, 6000)).to.be.revertedWithCustomError(escrow, "AlreadyVoted");
    });

    it("the panel cannot be replaced while a dispute is open", async function () {
      const { escrow, meera, daniel, outsider } = await loadFixture(disputedFixture);
      const newPanel = [meera.address, daniel.address, outsider.address];
      await expect(escrow.setArbiters(newPanel, PANEL)).to.be.revertedWithCustomError(escrow, "DisputesOpen").withArgs(1);
      await escrow.connect(meera).voteDispute(0, 0, 4000);
      await escrow.connect(daniel).voteDispute(0, 0, 4000);
      await expect(escrow.setArbiters(newPanel, ["Arbiter Meera", "Arbiter Daniel", "Arbiter Lina"]))
        .to.emit(escrow, "ArbiterAppointed").withArgs(2, outsider.address, "Arbiter Lina");
      expect(await escrow.isArbiter(outsider.address)).to.equal(true);
    });

    it("a dispute needs an appointed panel", async function () {
      const [council, client, freelancer] = await ethers.getSigners();
      const escrow = await ethers.deployContract("FreelanceEscrow", [], council);
      await escrow.connect(client).registerUser(Role.Client, "Solo Client");
      await escrow.connect(freelancer).registerUser(Role.Freelancer, "solo_dev");
      await escrow.connect(client).createJob(freelancer.address, "Job", sha("b"), [ETH(1)], await deadlinesFromNow([2]), DAY, { value: ETH(1) });
      await escrow.connect(freelancer).acceptJob(0);
      await escrow.connect(freelancer).submitMilestone(0, 0, sha("work"), "");
      await expect(escrow.connect(client).raiseDispute(0, 0, "Bad")).to.be.revertedWithCustomError(escrow, "NoArbiterPanel");
    });
  });

  describe("Completion and reputation", function () {
    it("a job completes when every milestone is settled; both sides then rate each other once", async function () {
      const { escrow, bluefin, priya, arjun } = await loadFixture(activeFixture);
      for (let i = 0; i < 3; i++) await escrow.connect(priya).submitMilestone(0, i, sha(`part-${i}`), "");
      await escrow.connect(bluefin).approveMilestone(0, 0);
      await escrow.connect(bluefin).approveMilestone(0, 1);
      await expect(escrow.connect(bluefin).rate(0, 5)).to.be.revertedWithCustomError(escrow, "JobNotCompleted").withArgs(0);
      await expect(escrow.connect(bluefin).approveMilestone(0, 2)).to.emit(escrow, "JobCompleted").withArgs(0, BUDGET, 0);
      expect((await escrow.getJob(0)).status).to.equal(JobStatus.Completed);
      expect((await escrow.getUser(priya.address)).completedJobs).to.equal(1);
      expect((await escrow.getUser(bluefin.address)).completedJobs).to.equal(1);

      await expect(escrow.connect(bluefin).rate(0, 0)).to.be.revertedWithCustomError(escrow, "InvalidRating");
      await expect(escrow.connect(bluefin).rate(0, 6)).to.be.revertedWithCustomError(escrow, "InvalidRating");
      await expect(escrow.connect(arjun).rate(0, 1)).to.be.revertedWithCustomError(escrow, "NotJobParty");
      await expect(escrow.connect(bluefin).rate(0, 5)).to.emit(escrow, "Rated").withArgs(0, bluefin.address, priya.address, 5);
      await expect(escrow.connect(priya).rate(0, 4)).to.emit(escrow, "Rated").withArgs(0, priya.address, bluefin.address, 4);
      await expect(escrow.connect(bluefin).rate(0, 1)).to.be.revertedWithCustomError(escrow, "AlreadyRated");
      const j = await escrow.getJob(0);
      expect(j.clientRating).to.equal(5);
      expect(j.freelancerRating).to.equal(4);
      const [avg, count] = await escrow.averageRating(priya.address);
      expect(avg).to.equal(500);
      expect(count).to.equal(1);
    });

    it("reputation is the average over all completed jobs", async function () {
      const { escrow, bluefin, bakery, priya } = await loadFixture(deployFixture);
      const one = async (client, stars) => {
        const id = await escrow.jobCount();
        await escrow.connect(client).createJob(priya.address, "Small job", sha(`b${id}`), [ETH(1)], await deadlinesFromNow([2]), DAY, { value: ETH(1) });
        await escrow.connect(priya).acceptJob(id);
        await escrow.connect(priya).submitMilestone(id, 0, sha(`w${id}`), "");
        await escrow.connect(client).approveMilestone(id, 0);
        await escrow.connect(client).rate(id, stars);
      };
      await one(bluefin, 5);
      await one(bakery, 4);
      const [avg, count] = await escrow.averageRating(priya.address);
      expect(avg).to.equal(450);
      expect(count).to.equal(2);
      const u = await escrow.getUser(priya.address);
      expect(u.earned).to.equal(ETH(2));
      expect(u.completedJobs).to.equal(2);
      expect((await escrow.averageRating(bakery.address))[1]).to.equal(0);
    });
  });

  describe("Withdrawals and security", function () {
    it("withdraw sends the credited ETH to the wallet and resets the balance", async function () {
      const { escrow, bluefin, priya } = await loadFixture(submittedFixture);
      await escrow.connect(bluefin).approveMilestone(0, 0);
      await expect(escrow.connect(bluefin).withdraw()).to.be.revertedWithCustomError(escrow, "NothingToWithdraw");
      const tx = escrow.connect(priya).withdraw();
      await expect(tx).to.changeEtherBalances([priya, escrow], [ETH(2), ETH(-2)]);
      await expect(tx).to.emit(escrow, "Withdrawn").withArgs(priya.address, ETH(2));
      expect(await escrow.balances(priya.address)).to.equal(0);
      expect(await escrow.totalOwed()).to.equal(0);
      await expect(escrow.connect(priya).withdraw()).to.be.revertedWithCustomError(escrow, "NothingToWithdraw");
      await expectInvariant(escrow);
    });

    it("the contract always holds exactly the escrow plus the unwithdrawn credits", async function () {
      const { escrow, bluefin, priya, meera, kofi, deadlines } = await loadFixture(activeFixture);
      await escrow.connect(priya).submitMilestone(0, 0, sha("logo"), "");
      await escrow.connect(bluefin).approveMilestone(0, 0);
      await expectInvariant(escrow);
      await escrow.connect(priya).submitMilestone(0, 2, sha("csv"), "");
      await escrow.connect(priya).raiseDispute(0, 2, "Client went silent");
      await escrow.connect(meera).voteDispute(0, 2, 2500);
      await escrow.connect(kofi).voteDispute(0, 2, 2500);
      await expectInvariant(escrow);
      await time.increaseTo(deadlines[1]);
      await escrow.connect(bluefin).refundMissedDeadline(0, 1);
      await escrow.connect(priya).withdraw();
      await expectInvariant(escrow);
      expect(await escrow.totalEscrowed()).to.equal(0);
      expect(await escrow.totalReleased()).to.equal(ETH("2.25"));
      expect(await escrow.totalRefunded()).to.equal(ETH("2.25"));
      expect((await escrow.getJob(0)).status).to.equal(JobStatus.Completed);
    });

    it("a malicious freelancer contract cannot re-enter withdraw() to be paid twice", async function () {
      const { escrow, bluefin, priya } = await loadFixture(deployFixture);
      // an honest job keeps 4.5 ETH in the contract that the attacker would love to drain
      await escrow.connect(bluefin).createJob(priya.address, "Brand kit", sha("brief"), AMOUNTS, await deadlinesFromNow(), DAY, { value: BUDGET });
      const attacker = await ethers.deployContract("ReentrantFreelancer", [await escrow.getAddress()]);
      await attacker.register("evil_dev");
      await escrow.connect(bluefin).createJob(await attacker.getAddress(), "Tiny job", sha("tiny"), [ETH(1)], await deadlinesFromNow([2]), DAY, { value: ETH(1) });
      await attacker.accept(1);
      await attacker.submit(1, 0, sha("payload"));
      await escrow.connect(bluefin).approveMilestone(1, 0);

      await attacker.withdraw();
      expect(await attacker.attempts()).to.equal(1); // it tried ...
      expect(await attacker.reentered()).to.equal(false); // ... and failed
      expect(await attacker.lastError()).to.equal(escrow.interface.encodeErrorResult("Reentrancy", []));
      expect(await ethers.provider.getBalance(await attacker.getAddress())).to.equal(ETH(1));
      expect(await escrow.escrowBalance()).to.equal(BUDGET); // the honest job's escrow is untouched
      await expectInvariant(escrow);
    });

    it("a recipient that rejects ETH cannot block approval; its failed withdrawal reverts cleanly", async function () {
      const { escrow, bluefin } = await loadFixture(deployFixture);
      const freelancer = await ethers.deployContract("ReentrantFreelancer", [await escrow.getAddress()]);
      await freelancer.register("no_receive");
      await freelancer.setRefuseEth(true);
      await escrow.connect(bluefin).createJob(await freelancer.getAddress(), "Job", sha("b"), [ETH(1)], await deadlinesFromNow([2]), DAY, { value: ETH(1) });
      await freelancer.accept(0);
      await freelancer.submit(0, 0, sha("w"));
      // with push payments this approval would revert; with pull payments it just credits
      await expect(escrow.connect(bluefin).approveMilestone(0, 0)).to.emit(escrow, "MilestoneApproved");
      await expect(freelancer.withdraw()).to.be.revertedWithCustomError(escrow, "TransferFailed");
      expect(await escrow.balances(await freelancer.getAddress())).to.equal(ETH(1)); // nothing lost
      await expectInvariant(escrow);
    });
  });
});
