/* GigSafe - Smart Contract-Based Freelance Payment Escrow (web app) */
(function () {
  const ROLE = { None: 0, Client: 1, Freelancer: 2 };
  const JOB = { Open: 0, Active: 1, Completed: 2, Cancelled: 3 };
  const MS = { Pending: 0, Submitted: 1, RevisionRequested: 2, Approved: 3, AutoReleased: 4, Refunded: 5, Disputed: 6, Resolved: 7 };
  const MS_NAME = ["Pending", "Submitted", "Revision requested", "Approved", "Auto-released", "Refunded", "Disputed", "Resolved"];
  const SETTLED = [MS.Approved, MS.AutoReleased, MS.Refunded, MS.Resolved];
  const BPS = 10000;
  const MAX_REVISIONS = 2;

  // Demo community (all names fictional). Account 0 is the GigSafe Council (deployer, admin).
  const ARBITERS = [
    [1, "Arbiter Meera"],
    [2, "Arbiter Daniel"],
    [3, "Arbiter Kofi"],
  ];
  const CLIENTS = [
    [4, "Bluefin Startups"],
    [5, "Corner Bakery Co."],
  ];
  const FREELANCERS = [
    [6, "pixel_priya"],
    [7, "dev_arjun"],
  ];
  const CLIENT_SLOTS = [4, 5];
  const FREELANCER_SLOTS = [6, 7, 8]; // account 8 registers itself during the demo (permissionless)
  const SUGGESTED_NAME = { 8: "copy_sam", 9: "ux_lena" };

  const SAMPLE_JOBS = {
    "Bluefin Startups": {
      freelancer: ["pixel_priya"],
      title: "Brand kit for the Bluefin launch",
      description:
        "Bluefin Startups is opening a co-working space for early-stage founders. We need a simple logo, the copy for a one-page website and a two-week social media calendar for the launch. Tone: friendly and confident, no jargon. Brand colour: ocean blue.",
      milestones: [
        { title: "Logo concepts", kind: "logo", eth: "2", days: 3 },
        { title: "Landing page copy", kind: "copy", eth: "1.5", days: 7 },
        { title: "Launch content calendar", kind: "csv", eth: "1", days: 10 },
      ],
      reviewDays: 3,
    },
    "Corner Bakery Co.": {
      freelancer: ["copy_sam", "dev_arjun"],
      title: "Menu page and shop sign",
      description:
        "Corner Bakery Co. needs friendly copy for its new online menu page, a seasonal price list as a spreadsheet and a simple logo for the shop sign. Warm, local, a little playful.",
      milestones: [
        { title: "Menu page copy", kind: "copy", eth: "0.8", days: 2 },
        { title: "Seasonal price list", kind: "csv", eth: "0.4", days: 4 },
        { title: "Shop sign logo", kind: "logo", eth: "1.2", days: 6 },
      ],
      reviewDays: 2,
    },
  };
  const DEFAULT_JOB = {
    freelancer: [],
    title: "",
    description: "",
    milestones: [
      { title: "", kind: "logo", eth: "1", days: 3 },
      { title: "", kind: "copy", eth: "1", days: 7 },
      { title: "", kind: "csv", eth: "1", days: 10 },
    ],
    reviewDays: 3,
  };
  const REVISION_HINT = {
    logo: "Please use our brand blue and make the initials bolder.",
    copy: "Shorter headline please, and mention the free first visit.",
    csv: "Add one post per week about our community events.",
  };

  const ERRORS = {
    NotAdmin: () => "only the GigSafe Council (account 0) can do this.",
    InvalidArbiters: () => "the panel needs three different accounts, each with a name.",
    ConflictOfInterest: () => "arbiters and the Council cannot be clients or freelancers (conflict of interest).",
    DisputesOpen: (n) => `the arbiter panel cannot be changed while ${n} dispute(s) are open.`,
    InvalidRole: () => "choose client or freelancer.",
    InvalidName: () => "the name must be 3 to 32 characters long.",
    AlreadyRegistered: () => "this account is already registered.",
    NotClient: () => "only a registered client can post jobs.",
    NotFreelancer: () => "the chosen account is not a registered freelancer.",
    InvalidInput: () => "some required information is missing.",
    InvalidMilestones: () => "every milestone needs an amount above zero, deadlines must not go backwards, and a job has 1 to 10 milestones.",
    DeadlineInPast: (i) => `the deadline of milestone ${Number(i) + 1} is in the past.`,
    InvalidReviewWindow: (min, max) => `the review window must be between ${fmtWindow(min)} and ${fmtWindow(max)}.`,
    WrongDeposit: (exp, sent) => `the deposit must equal the budget: ${fmtEth(exp)} expected, ${fmtEth(sent)} sent.`,
    UnknownJob: (id) => `job #${id} does not exist.`,
    UnknownMilestone: (id, i) => `job #${id} has no milestone ${Number(i) + 1}.`,
    NotJobClient: () => "only the client who posted this job can do this.",
    NotJobFreelancer: () => "only the freelancer hired for this job can do this.",
    NotJobParty: () => "only the client or the freelancer of this job can do this.",
    JobNotOpen: (id) => `job #${id} is no longer waiting for acceptance.`,
    JobNotActive: (id) => `job #${id} is not in progress (it must be accepted first, and must not be finished).`,
    JobNotCompleted: (id) => `job #${id} is not completed yet. Ratings open when every milestone is settled.`,
    InvalidMilestoneState: (s) => `not possible while the milestone is "${MS_NAME[Number(s)]}".`,
    SameDeliverable: () => "this is the same file as before (same SHA-256). A revision must change the deliverable.",
    RevisionLimitReached: (max) => `all ${max} revisions are used. Approve the work or raise a dispute.`,
    ReviewWindowOver: (t) => `the review window closed at ${UI.fmtTime(t)}. The freelancer may now claim the payment automatically.`,
    TooEarly: (now, at) =>
      `too early! The client's review window is open until ${UI.fmtTime(at)} (${UI.fmtDuration(Number(at) - Number(now))} from now). Auto-release is possible after that.`,
    DeadlineNotPassed: (d) => `the delivery deadline (${UI.fmtTime(d)}) has not passed yet.`,
    NoArbiterPanel: () => "no arbiter panel has been appointed yet.",
    NotArbiter: () => "only the three appointed arbiters can vote.",
    NoOpenDispute: (id, i) => `milestone ${Number(i) + 1} of job #${id} has no open dispute.`,
    AlreadyVoted: () => "this arbiter has already voted on this dispute. Each arbiter votes once.",
    InvalidShare: () => "the share must be between 0 % and 100 %.",
    InvalidRating: () => "give 1 to 5 stars.",
    AlreadyRated: () => "you have already rated this job.",
    NothingToWithdraw: () => "nothing to withdraw: the GigSafe balance of this account is zero.",
    TransferFailed: () => "the ETH transfer failed.",
    Reentrancy: () => "re-entrant call blocked.",
  };

  const lower = (a) => (a || "").toLowerCase();
  const sameAddr = (a, b) => lower(a) === lower(b);
  const key = (jobId, idx) => `${jobId}:${idx}`;
  const parseKey = (k) => k.split(":").map(Number);
  const isSettled = (m) => SETTLED.includes(m.status);

  function fmtEth(wei, digits = 4) {
    const n = Number(ethers.formatEther(wei));
    return `${n.toLocaleString("en-US", { maximumFractionDigits: digits })} ETH`;
  }
  function fmtWindow(sec) {
    sec = Number(sec);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    if (d) return `${d} day${d > 1 ? "s" : ""}${h ? ` ${h} h` : ""}`;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const pct = (bps) => `${(Number(bps) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} %`;
  const countdown = (ts, done = "now") =>
    `<strong data-countdown="${ts}" data-done-text="${done}">${UI.fmtDuration(ts - Chain.now())}</strong>`;
  const starRow = (fraction, label) =>
    `<span class="stars" role="img" aria-label="${UI.esc(label)}" title="${UI.esc(label)}"><span class="stars-fill" style="width:${Math.max(0, Math.min(1, fraction)) * 100}%">★★★★★</span>★★★★★</span>`;
  function ratingHtml(u) {
    if (!u || !u.ratingCount) return `<span class="muted small">not rated yet</span>`;
    const avg = u.ratingSum / u.ratingCount;
    return `<span class="rating">${starRow(avg / 5, `${avg.toFixed(1)} out of 5 stars`)}<span class="small">${avg.toFixed(1)} (${u.ratingCount})</span></span>`;
  }
  const givenStars = (n) => `<span class="rating">${starRow(n / 5, `${n} out of 5 stars`)}<span class="small">${n}/5</span></span>`;

  // ------------------------------------------------------------------
  // Off-chain storage (simulated file server): deliverable files and job briefs.
  // Only their SHA-256 hashes are on the blockchain.
  // ------------------------------------------------------------------
  const files = () => Chain.store.get("files", {}); // deliverableHash -> { name, type, size, b64 | null }
  const briefs = () => Chain.store.get("briefs", {}); // descriptionHash -> canonical brief JSON
  function putIn(name, k, value) {
    const all = Chain.store.get(name, {});
    all[k] = value;
    Chain.store.set(name, all);
  }
  function storeFile(hash, f, size) {
    const keep = size <= GigCrypto.MAX_STORED;
    putIn("files", hash, { name: f.name, type: f.type, size, b64: keep ? f.b64 : null });
    return keep;
  }

  // ------------------------------------------------------------------
  // Data
  // ------------------------------------------------------------------
  async function load() {
    const c = Chain.contract;
    const A = Chain.accounts;
    A.forEach((a, i) => Chain.setName(a, i === 0 ? "GigSafe Council" : `Account #${i}`));
    const [[uAccts, uInfo], [arbAccts, arbNames], jCount, totals] = await Promise.all([
      c.getUsers(),
      c.getArbiters(),
      c.jobCount(),
      Promise.all([c.totalEscrowed(), c.totalReleased(), c.totalRefunded(), c.totalOwed(), c.openDisputes(), c.disputeCount()]),
    ]);
    const users = uAccts.map((a, i) => {
      const u = uInfo[i];
      return {
        address: a,
        role: Number(u.role),
        name: u.name,
        joinedAt: Number(u.joinedAt),
        jobs: Number(u.jobs),
        completedJobs: Number(u.completedJobs),
        ratingSum: Number(u.ratingSum),
        ratingCount: Number(u.ratingCount),
        earned: u.earned,
        spent: u.spent,
      };
    });
    users.forEach((u) => Chain.setName(u.address, u.name));
    const arbiters = [...arbAccts]
      .map((a, seat) => ({ address: a, name: arbNames[seat], seat }))
      .filter((x) => x.address !== ethers.ZeroAddress);
    arbiters.forEach((x) => Chain.setName(x.address, x.name));

    const storedBriefs = briefs();
    const jobs = await Promise.all(
      Array.from({ length: Number(jCount) }, async (_, id) => {
        const [j, ms] = await Promise.all([c.getJob(id), c.getMilestones(id)]);
        const job = {
          id,
          client: j.client,
          freelancer: j.freelancer,
          title: j.title,
          descriptionHash: j.descriptionHash,
          budget: j.budget,
          released: j.released,
          refunded: j.refunded,
          reviewWindow: Number(j.reviewWindow),
          createdAt: Number(j.createdAt),
          acceptedAt: Number(j.acceptedAt),
          status: Number(j.status),
          clientRating: Number(j.clientRating),
          freelancerRating: Number(j.freelancerRating),
        };
        job.milestones = ms.map((m, idx) => ({
          jobId: id,
          idx,
          amount: m.amount,
          deadline: Number(m.deadline),
          submittedAt: Number(m.submittedAt),
          settledAt: Number(m.settledAt),
          deliverableHash: m.deliverableHash,
          note: m.note,
          feedback: m.feedback,
          revisions: Number(m.revisions),
          share: Number(m.freelancerShareBps),
          status: Number(m.status),
        }));
        for (const m of job.milestones) {
          m.reviewEnds = m.submittedAt ? m.submittedAt + job.reviewWindow : 0;
          if (m.status === MS.Disputed || m.status === MS.Resolved) m.dispute = parseDispute(await c.getDispute(id, m.idx));
        }
        const text = storedBriefs[job.descriptionHash];
        if (text) {
          try {
            job.brief = GigCrypto.parseBrief(text);
            job.briefOk = (await UI.sha256(text)) === job.descriptionHash;
          } catch {
            job.brief = null;
          }
        }
        job.locked = job.milestones.filter((m) => !isSettled(m)).reduce((s, m) => s + m.amount, 0n);
        job.settled = job.milestones.filter(isSettled).length;
        return job;
      })
    );

    const [wallets, credits, held] = await Promise.all([
      Promise.all(A.map((a) => Chain.provider.getBalance(a))),
      Promise.all(A.map((a) => c.balances(a))),
      Chain.provider.getBalance(Chain.address),
    ]);
    const wallet = {};
    const credit = {};
    A.forEach((a, i) => {
      wallet[lower(a)] = wallets[i];
      credit[lower(a)] = credits[i];
    });
    const [escrowed, released, refunded, owed, openDisputes, disputeCount] = totals;
    return {
      users,
      clients: users.filter((u) => u.role === ROLE.Client),
      freelancers: users.filter((u) => u.role === ROLE.Freelancer),
      arbiters,
      jobs,
      wallet,
      credit,
      held,
      totals: { escrowed, released, refunded, owed, openDisputes: Number(openDisputes), disputeCount: Number(disputeCount) },
      accounts: A,
    };
  }

  function parseDispute(d) {
    const n = Number(d.voteCount);
    return {
      raisedBy: d.raisedBy,
      raisedAt: Number(d.raisedAt),
      resolvedAt: Number(d.resolvedAt),
      reason: d.reason,
      resolved: d.resolved,
      byMedian: d.byMedian,
      share: Number(d.shareBps),
      votes: Array.from({ length: n }, (_, i) => ({ voter: d.voters[i], bps: Number(d.votes[i]) })),
    };
  }

  const userOf = (data, addr) => data.users.find((u) => sameAddr(u.address, addr));
  const msTitle = (j, idx) => (j.brief && j.brief.milestones[idx] && j.brief.milestones[idx].title) || `Milestone ${idx + 1}`;
  const msKind = (j, idx) => (j.brief && j.brief.milestones[idx] && j.brief.milestones[idx].kind) || "copy";

  function slotsFor(data, role, indices) {
    const A = data.accounts;
    const list = indices.filter((i) => A[i]).map((i) => A[i]);
    for (const u of data.users) if (u.role === role && !list.some((a) => sameAddr(a, u.address))) list.push(u.address);
    return list;
  }

  /** Display state of a milestone. `seg` is the progress-bar colour class. */
  function msState(m) {
    const now = Chain.now();
    switch (m.status) {
      case MS.Pending:
        return now >= m.deadline ? { label: "Deadline missed", chip: "chip-bad", seg: "" } : { label: "Not delivered", chip: "", seg: "" };
      case MS.Submitted:
        return now >= m.reviewEnds ? { label: "Review window over", chip: "chip-warn", seg: "s-sub" } : { label: "In review", chip: "chip-info", seg: "s-sub" };
      case MS.RevisionRequested:
        return { label: `Revision ${m.revisions} requested`, chip: "chip-warn", seg: "s-rev" };
      case MS.Approved:
        return { label: "Approved · paid", chip: "chip-ok", seg: "s-paid" };
      case MS.AutoReleased:
        return { label: "Auto-released", chip: "chip-ok", seg: "s-paid" };
      case MS.Refunded:
        return { label: "Refunded", chip: "", seg: "s-ref" };
      case MS.Disputed:
        return { label: "In dispute", chip: "chip-bad", seg: "s-dis" };
      default:
        return { label: `Split ${pct(m.share)} / ${pct(BPS - m.share)}`, chip: "chip-violet", seg: "s-res" };
    }
  }

  function jobState(j) {
    if (j.status === JOB.Open) return { label: "Awaiting acceptance", chip: "chip-warn" };
    if (j.status === JOB.Active)
      return j.milestones.some((m) => m.status === MS.Disputed) ? { label: "In progress · dispute", chip: "chip-bad" } : { label: "In progress", chip: "chip-accent" };
    if (j.status === JOB.Completed) return { label: "Completed", chip: "chip-ok" };
    return { label: "Cancelled", chip: "" };
  }

  function progressBar(j) {
    const segs = j.milestones
      .map((m) => {
        const w = Math.max(0.05, Number(ethers.formatEther(m.amount)));
        return `<span class="${msState(m).seg}" style="flex:${w} 1 0" title="${UI.esc(`${msTitle(j, m.idx)}: ${msState(m).label}`)}"></span>`;
      })
      .join("");
    return `<div class="mbar" role="img" aria-label="${j.settled} of ${j.milestones.length} milestones settled">${segs}</div>`;
  }
  const legend = () =>
    `<div class="legend"><span><i></i>Not delivered</span><span><i class="s-sub"></i>In review</span><span><i class="s-rev"></i>Revision</span><span><i class="s-paid"></i>Paid</span><span><i class="s-dis"></i>Dispute</span><span><i class="s-res"></i>Split by arbiters</span><span><i class="s-ref"></i>Refunded</span></div>`;

  // ------------------------------------------------------------------
  // Core actions
  // ------------------------------------------------------------------
  /** Client: hash the brief, lock the budget in escrow (createJob), share the brief off-chain. */
  async function postJob(client, f) {
    let brief, descriptionHash, amounts, deadlines, total, result, jobId;
    const host = document.getElementById("post-steps");
    const run = await UI.runSteps(host, [
      {
        title: "Write the job brief and fingerprint it (SHA-256)",
        run: async () => {
          brief = GigCrypto.canonicalBrief({
            ...f,
            client: Chain.label(client),
            freelancer: Chain.label(f.freelancer),
            salt: UI.bytesToHex(UI.randomBytes(16)),
          });
          descriptionHash = await UI.sha256(brief);
          return `${brief.length} bytes · descriptionHash ${UI.short(descriptionHash, 8)}: the agreed scope of work, fixed before work starts`;
        },
      },
      {
        title: "Plan the milestones (amount and deadline each)",
        run: async () => {
          amounts = f.milestones.map((m) => ethers.parseEther(String(m.eth)));
          total = amounts.reduce((s, x) => s + x, 0n);
          const now = Chain.now();
          deadlines = f.milestones.map((m) => now + Math.round(Number(m.days) * 86400));
          return f.milestones.map((m, i) => `${i + 1}. ${m.title}: ${m.eth} ETH, due in ${m.days} d`).join(" · ");
        },
      },
      {
        title: "Lock the full budget in the escrow contract (createJob)",
        run: async () => {
          result = await Chain.send(client, "createJob", [
            f.freelancer,
            f.title,
            descriptionHash,
            amounts,
            deadlines,
            Math.round(Number(f.reviewDays) * 86400),
            { value: total },
          ]);
          jobId = Number(result.events.find((e) => e.name === "JobCreated").args.jobId);
          return `Job #${jobId} · block #${result.block.number} · ${fmtEth(total)} is now held by the smart contract, not by a platform`;
        },
      },
      {
        title: "Share the brief with the freelancer (off-chain)",
        run: async () => {
          putIn("briefs", descriptionHash, brief);
          return "Only its hash is on-chain. The freelancer and the arbiters can check that it was never changed.";
        },
      },
    ]);
    Shell.state.postResult = { client, items: run.items, jobId };
    if (!run.ok) throw run.error;
    UI.toast(`Job #${jobId} posted: ${fmtEth(total)} locked in escrow until the work is delivered`, "success");
    return jobId;
  }

  async function acceptJob(freelancer, jobId) {
    await Chain.send(freelancer, "acceptJob", [jobId]);
    UI.toast(`Job #${jobId} accepted. Deliver the milestones before their deadlines.`, "success");
  }

  async function cancelJob(client, jobId) {
    const { events } = await Chain.send(client, "cancelJob", [jobId]);
    UI.toast(`Job #${jobId} cancelled: ${fmtEth(events.find((e) => e.name === "JobCancelled").args.refund)} credited back to you`, "success");
  }

  /** Freelancer: fingerprint the file, commit its hash on-chain, upload the file off-chain. */
  async function submitDeliverable(freelancer, jobId, idx, file, note) {
    let bytes, hash, result;
    const host = document.getElementById("deliver-steps");
    const run = await UI.runSteps(host, [
      {
        title: "Read the deliverable file",
        run: async () => {
          bytes = UI.base64ToBytes(file.b64);
          return `${file.name} · ${GigCrypto.fmtBytes(bytes.length)} · ${file.type || "unknown type"}`;
        },
      },
      {
        title: "Fingerprint it in this browser (SHA-256)",
        run: async () => {
          hash = await UI.sha256(bytes);
          return hash;
        },
      },
      {
        title: "Commit the hash on the blockchain (submitMilestone)",
        run: async () => {
          result = await Chain.send(freelancer, "submitMilestone", [jobId, idx, hash, note]);
          return `Block #${result.block.number} · ${UI.fmtTime(result.block.timestamp)}: proof of WHAT you delivered and WHEN`;
        },
      },
      {
        title: "Upload the file to off-chain storage for the client",
        run: async () =>
          storeFile(hash, file, bytes.length)
            ? "The client downloads it and checks it against the on-chain hash."
            : `Larger than ${GigCrypto.fmtBytes(GigCrypto.MAX_STORED)}: only the hash is kept here. Send the file to the client directly; it can still be verified against the chain.`,
      },
      {
        title: "The client's review window starts",
        run: async () => {
          const j = await Chain.contract.getJob(jobId);
          const ends = result.block.timestamp + Number(j.reviewWindow);
          return `The client has until ${UI.fmtTime(ends)} to approve, ask for a revision or dispute. After that you can claim the payment yourself.`;
        },
      },
    ]);
    Shell.state.deliverResult = { freelancer, jobId, idx, items: run.items };
    if (!run.ok) throw run.error;
    Shell.state.draft = null;
    UI.toast(`Milestone ${idx + 1} delivered: hash ${UI.short(hash, 4)} committed on-chain`, "success");
    return hash;
  }

  /** Anyone holding the file: is it exactly the deliverable committed on-chain? (never throws) */
  async function verifyDeliverable(job, idx, opts = {}) {
    const m = job.milestones[idx];
    let bytes, hash;
    const host = document.getElementById(opts.hostId || "verify-steps");
    return UI.runSteps(host, [
      {
        title: opts.bytes ? "Read the file you received" : "Download the deliverable from off-chain storage",
        run: async () => {
          if (opts.bytes) {
            bytes = opts.bytes;
            return `${opts.name} · ${GigCrypto.fmtBytes(bytes.length)}`;
          }
          const rec = files()[m.deliverableHash];
          if (!rec || !rec.b64)
            throw new Error('The file is not in off-chain storage (too large, or delivered in another browser). Get it from the freelancer and use "Verify a file I received".');
          bytes = UI.base64ToBytes(rec.b64);
          if (opts.tamper) {
            bytes = bytes.slice();
            const at = Math.floor(bytes.length / 2);
            bytes[at] ^= 0x01;
            return `${rec.name} · ${GigCrypto.fmtBytes(bytes.length)} · simulated tampering: one bit flipped in byte ${at}`;
          }
          return `${rec.name} · ${GigCrypto.fmtBytes(bytes.length)}`;
        },
      },
      {
        title: "Compute its SHA-256 fingerprint in this browser",
        run: async () => {
          hash = await UI.sha256(bytes);
          return hash;
        },
      },
      {
        title: "Compare with the hash committed on-chain",
        run: async () => {
          const onChain = (await Chain.contract.getMilestones(job.id))[idx].deliverableHash;
          if (hash !== onChain)
            throw new Error(`Hash mismatch: on-chain ${UI.short(onChain, 6)}, file ${UI.short(hash, 6)}. This is NOT the delivered file: it was changed after delivery.`);
          return `${UI.short(onChain, 8)} ✓ identical, byte for byte`;
        },
      },
      {
        title: "Check when it was delivered",
        run: async () =>
          `Committed by ${Chain.label(job.freelancer)} at ${UI.fmtTime(m.submittedAt)} (block time) · ${m.submittedAt <= m.deadline ? "on time" : "late"}, deadline ${UI.fmtTime(m.deadline)}${
            m.revisions ? ` · version ${m.revisions + 1}` : ""
          }`,
      },
    ]);
  }

  async function reviewDeliverable(client, job, idx, opts = {}) {
    const run = await verifyDeliverable(job, idx, { ...opts, hostId: "verify-steps" });
    Shell.state.review = { client, jobId: job.id, idx, hash: job.milestones[idx].deliverableHash, items: run.items, ok: run.ok, tamper: !!opts.tamper };
    if (run.ok) UI.toast("Verified: this is exactly the file the freelancer committed on-chain", "success");
    else UI.toast(run.error.message, "error", 7000); // an expected outcome (e.g. the tamper test), not a bug
    return run.ok;
  }

  function afterSettle(events) {
    const done = events.find((e) => e.name === "JobCompleted");
    if (done) UI.toast(`Job #${done.args.jobId} completed. Both sides can now rate each other.`, "success", 6000);
  }

  async function approve(client, jobId, idx) {
    const { events } = await Chain.send(client, "approveMilestone", [jobId, idx]);
    const c = events.find((e) => e.name === "Credited");
    UI.toast(`Approved: ${fmtEth(c.args.amount)} released to ${Chain.label(c.args.account)} (ready to withdraw)`, "success");
    afterSettle(events);
  }

  async function requestRevision(client, jobId, idx, reason) {
    const { events } = await Chain.send(client, "requestRevision", [jobId, idx, reason]);
    const e = events.find((x) => x.name === "RevisionRequested");
    UI.toast(`Revision ${e.args.revisions} of ${MAX_REVISIONS} requested. New version due by ${UI.fmtTime(e.args.newDeadline)}.`, "success");
  }

  async function raiseDispute(from, jobId, idx, reason) {
    await Chain.send(from, "raiseDispute", [jobId, idx, reason]);
    UI.toast(`Dispute raised on milestone ${idx + 1}. The money is frozen until 2 of 3 arbiters agree.`, "success", 6000);
  }

  async function claim(freelancer, jobId, idx) {
    const { events } = await Chain.send(freelancer, "claimAfterReview", [jobId, idx]);
    const e = events.find((x) => x.name === "MilestoneAutoReleased");
    UI.toast(`Auto-released: the client did not respond in time, ${fmtEth(e.args.amount)} credited to you`, "success");
    afterSettle(events);
  }

  async function refund(client, jobId, idx) {
    const { events } = await Chain.send(client, "refundMissedDeadline", [jobId, idx]);
    const e = events.find((x) => x.name === "MilestoneRefunded");
    UI.toast(`Deadline missed: ${fmtEth(e.args.amount)} credited back to you`, "success");
    afterSettle(events);
  }

  async function vote(arbiter, jobId, idx, bps) {
    const { events } = await Chain.send(arbiter, "voteDispute", [jobId, idx, bps]);
    const r = events.find((e) => e.name === "DisputeResolved");
    const v = events.find((e) => e.name === "DisputeVoted");
    if (r)
      UI.toast(
        `${r.args.byMedian ? "Three different votes: the median" : "2 of 3 arbiters agreed:"} ${pct(r.args.freelancerShareBps)} executed. ${fmtEth(r.args.toFreelancer)} to the freelancer, ${fmtEth(
          r.args.toClient
        )} back to the client.`,
        "success",
        7000
      );
    else UI.toast(`Vote recorded (${v.args.votes} of 3). The split is executed when two arbiters agree.`, "success");
    afterSettle(events);
  }

  async function rate(from, jobId, stars) {
    const { events } = await Chain.send(from, "rate", [jobId, stars]);
    const e = events.find((x) => x.name === "Rated");
    UI.toast(`You rated ${Chain.label(e.args.to)} ${stars}/5. The rating is now part of their on-chain reputation.`, "success");
  }

  async function withdraw(addr) {
    const { events } = await Chain.send(addr, "withdraw", []);
    UI.toast(`${fmtEth(events.find((e) => e.name === "Withdrawn").args.amount)} moved from GigSafe to the wallet of ${Chain.label(addr)}`, "success");
  }

  async function register(addr, role, name) {
    await Chain.send(addr, "registerUser", [role, name]);
    UI.toast(`Welcome, ${name}! Registered as a ${role === ROLE.Client ? "client" : "freelancer"}, no approval needed.`, "success");
  }

  async function jump(ts, message) {
    await Chain.fastForward(Math.max(1, ts - Chain.now() + 5));
    UI.toast(message, "success");
  }

  /** Arbiter: check both sides' evidence against the chain (never throws). */
  async function verifyEvidence(job, idx) {
    const m = job.milestones[idx];
    let rec;
    const host = document.getElementById("evidence-steps");
    const run = await UI.runSteps(host, [
      {
        title: "Check the job brief against its on-chain hash",
        run: async () => {
          const text = briefs()[job.descriptionHash];
          if (!text) throw new Error("The job brief is not in this browser.");
          if ((await UI.sha256(text)) !== job.descriptionHash) throw new Error("The brief was changed after the job was posted.");
          return `✓ unchanged since ${UI.fmtTime(job.createdAt)}: "${msTitle(job, idx)}" was agreed as ${fmtEth(m.amount)}`;
        },
      },
      {
        title: "Check the deliverable against the hash the freelancer committed",
        run: async () => {
          rec = files()[m.deliverableHash];
          if (!rec || !rec.b64) throw new Error("The deliverable file is not in this browser.");
          const h = await UI.sha256(UI.base64ToBytes(rec.b64));
          if (h !== m.deliverableHash) throw new Error("The stored file does not match the on-chain hash.");
          return `✓ ${rec.name} is exactly what was delivered (${UI.short(h, 6)})`;
        },
      },
      {
        title: "Read the timeline from the blockchain",
        run: async () =>
          `Delivered ${UI.fmtTime(m.submittedAt)} (${m.submittedAt <= m.deadline ? "on time" : "late"}) · revisions used ${m.revisions}/${MAX_REVISIONS} · dispute raised ${UI.fmtTime(
            m.dispute.raisedAt
          )} by ${Chain.label(m.dispute.raisedBy)}`,
      },
      {
        title: "Both sides' statements (stored on-chain)",
        run: async () =>
          `Client: "${m.feedback || "no revision request"}" · Freelancer's note: "${m.note || "-"}" · Dispute reason: "${m.dispute.reason}"`,
      },
    ]);
    Shell.state.evidence = { jobId: job.id, idx, items: run.items, ok: run.ok };
    if (!run.ok) UI.toast(run.error.message, "error", 6000);
    return run.ok;
  }

  // ------------------------------------------------------------------
  // Shared view pieces
  // ------------------------------------------------------------------
  const pageHead = (title, sub, actions = "") =>
    `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="row">${actions}</div></div>`;
  const miniStats = (items) =>
    `<div class="mini-stats">${items.map(([label, value]) => `<div><span class="mini-label">${label}</span><span class="mini-value">${value}</span></div>`).join("")}</div>`;

  function jobsTable(jobs) {
    if (!jobs.length) return `<div class="empty">No jobs yet. <a href="#/client">Post one as a client</a>.</div>`;
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Job</th><th>Budget</th><th>Progress</th><th>Status</th></tr></thead>
      <tbody>${jobs
        .slice()
        .reverse()
        .map((j) => {
          const st = jobState(j);
          return `<tr>
          <td data-label="Job"><div><strong>${UI.esc(j.title)}</strong><div class="muted small">#${j.id} · ${UI.esc(Chain.label(j.client))} → ${UI.esc(Chain.label(j.freelancer))}</div></div></td>
          <td data-label="Budget" class="nowrap">${UI.esc(fmtEth(j.budget))}</td>
          <td data-label="Progress" class="progress-cell"><div class="pc">${progressBar(j)}<div class="muted small">${j.settled} of ${j.milestones.length} settled</div></div></td>
          <td data-label="Status"><span class="chip ${st.chip}">${st.label}</span></td>
        </tr>`;
        })
        .join("")}</tbody></table></div>`;
  }

  function briefHtml(j) {
    if (!j.brief) return `<div class="brief muted small">Job brief not in this browser. Its hash on-chain: <code>${UI.esc(UI.short(j.descriptionHash, 6))}</code></div>`;
    return `<div class="brief"><p>${UI.esc(j.brief.description)}</p><div class="small muted">Brief hash <code>${UI.esc(UI.short(j.descriptionHash, 6))}</code> ${
      j.briefOk ? `<span class="chip chip-ok">matches the chain</span>` : `<span class="chip chip-bad">does not match</span>`
    }</div></div>`;
  }

  /** A file with its preview: images as a thumbnail beside the details, text and CSV below. */
  function previewBox(rec, details) {
    const stored = rec && rec.b64;
    const img = stored && GigCrypto.isImage(rec);
    return `<div class="file-box"><div class="file-grid">${img ? GigCrypto.preview(rec) : ""}<div class="file-info">${details}</div></div>${
      stored && !img ? GigCrypto.preview(rec) : ""
    }</div>`;
  }

  function fileBox(m, { actions = "" } = {}) {
    const rec = files()[m.deliverableHash];
    return previewBox(
      rec,
      `<div class="file-head"><span class="file-name">${rec ? UI.esc(rec.name) : "Deliverable"}</span><span class="muted small">${rec ? GigCrypto.fmtBytes(rec.size) : ""}</span></div>
      <div class="kv" style="margin-top:6px"><span>SHA-256 on-chain</span><code title="${UI.esc(m.deliverableHash)}">${UI.esc(UI.short(m.deliverableHash, 8))}</code></div>
      ${actions ? `<div class="row" style="margin-top:8px;gap:6px">${actions}</div>` : ""}
      ${rec && rec.b64 ? "" : `<p class="muted small" style="margin:8px 0 0">The file itself is not stored in this browser; only its hash is on-chain.</p>`}`
    );
  }

  function votesHtml(data, m, meAddr) {
    const votes = (m.dispute && m.dispute.votes) || [];
    return `<ul class="votes">${data.arbiters
      .map((a) => {
        const v = votes.find((x) => sameAddr(x.voter, a.address));
        return `<li class="${v ? "voted" : ""} ${meAddr && sameAddr(meAddr, a.address) ? "me" : ""}"><span class="vote-name">${UI.esc(a.name)}</span><span class="vote-val">${
          v ? `${pct(v.bps)} to freelancer` : m.status === MS.Disputed ? "not voted yet" : "did not need to vote"
        }</span></li>`;
      })
      .join("")}</ul>`;
  }

  function settledText(j, m) {
    const who = Chain.label(j.freelancer);
    switch (m.status) {
      case MS.Approved:
        return `Approved by the client: ${fmtEth(m.amount)} released to ${who}.`;
      case MS.AutoReleased:
        return `The client did not respond within the review window: ${fmtEth(m.amount)} auto-released to ${who}.`;
      case MS.Refunded:
        return `Refunded: ${fmtEth(m.amount)} went back to ${Chain.label(j.client)}.`;
      case MS.Resolved: {
        const toF = (m.amount * BigInt(m.share)) / BigInt(BPS);
        return `Arbiters decided ${pct(m.share)} for the freelancer${m.dispute && m.dispute.byMedian ? " (median of three different votes)" : " (2 of 3 agreed)"}: ${fmtEth(toF)} to ${who}, ${fmtEth(
          m.amount - toF
        )} back to ${Chain.label(j.client)}.`;
      }
      default:
        return "";
    }
  }

  // ------------------------------------------------------------------
  // Views
  // ------------------------------------------------------------------
  async function viewHome(el, { data, state, action, go }) {
    const t = data.totals;
    const js = data.jobs;
    const active = js.filter((j) => j.status === JOB.Active).length;
    const now = Chain.now();
    const nextReview = js
      .flatMap((j) => j.milestones)
      .filter((m) => m.status === MS.Submitted && m.reviewEnds > now)
      .sort((a, b) => a.reviewEnds - b.reviewEnds)[0];

    el.innerHTML = `
      ${pageHead(
        "Freelance Payment Escrow",
        "Clients lock the whole job budget in a smart contract before work starts. Freelancers prove every delivery with a SHA-256 hash on-chain and are paid on approval, or automatically if the client stays silent. Disputes go to a panel of 3 arbiters: 2 of 3 decide.",
        `<button class="btn" id="sample-job-btn">${Shell.icon("coins")} Post sample job</button>
         ${nextReview ? `<button class="btn btn-secondary" id="jump-review-btn">${Shell.icon("forward")} Jump past next review window</button>` : ""}`
      )}
      <div class="grid-4" style="margin-bottom:16px">
        <div class="card stat"><span class="stat-value">${js.length}</span><span class="stat-label">Jobs posted · ${active} in progress</span></div>
        <div class="card stat"><span class="stat-value">${UI.esc(fmtEth(t.escrowed, 2))}</span><span class="stat-label">Locked in escrow (test ETH)</span></div>
        <div class="card stat"><span class="stat-value">${UI.esc(fmtEth(t.released, 2))}</span><span class="stat-label">Paid to freelancers</span></div>
        <div class="card stat"><span class="stat-value">${t.disputeCount}</span><span class="stat-label">Disputes · ${t.openDisputes} open</span></div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h2>How it works</h2></div>
        <div class="flow" style="--steps:4">
          <div class="flow-step"><h3>Lock the budget</h3><p>The client posts milestones with deadlines and deposits the full budget. The smart contract holds it, not a platform.</p></div>
          <div class="flow-step"><h3>Deliver &amp; commit</h3><p>The freelancer submits each deliverable. Its SHA-256 hash goes on-chain: proof of what was delivered and when.</p></div>
          <div class="flow-step"><h3>Approve or auto-release</h3><p>The client approves (paid at once) or asks for a revision. Silent past the review window? The freelancer claims it.</p></div>
          <div class="flow-step"><h3>Dispute: 2 of 3 decide</h3><p>Either side can dispute. Three appointed arbiters vote on the split; it is executed when two agree.</p></div>
        </div>
      </div>
      <div class="grid-2" style="align-items:start">
        <div class="card"><div class="card-head"><h2>Jobs</h2><a href="#/jobs" class="small">Jobs Board</a></div>${jobsTable(js)}</div>
        <div class="card">
          <div class="card-head"><h2>Demo script (5 minutes)</h2></div>
          <ol class="demo-list">
            <li><em>Post sample job</em> → <a href="#/client">Client</a> Bluefin Startups locks <strong>4.5 ETH</strong> for 3 milestones (logo, website copy, content calendar).</li>
            <li><a href="#/freelancer">Freelancer</a> pixel_priya: <em>Accept</em>, then <em>Deliver</em> milestone 1 → <em>Generate sample logo</em> → <em>Hash &amp; submit</em>.</li>
            <li>Client: <em>Review</em> → <em>Verify against blockchain</em> (try the <em>Tamper test</em>) → <em>Approve</em>. pixel_priya clicks <em>Withdraw</em>.</li>
            <li>Freelancer: deliver milestone 2, <em>Claim payment</em> → <strong>"too early"</strong>. <em>Jump past review window</em> → claim again: auto-released.</li>
            <li>Milestone 3: the client asks for a revision, the freelancer resubmits, the client raises a dispute.</li>
            <li><a href="#/arbitration">Arbitration Panel</a>: two arbiters vote <strong>70 %</strong> → split executed (0.7 / 0.3 ETH).</li>
            <li>Both rate each other → <a href="#/reputation">Reputation</a>, <a href="#/jobs">Jobs Board</a>, <a href="#/explorer">Blockchain Explorer</a>.</li>
          </ol>
        </div>
      </div>`;

    el.querySelector("#sample-job-btn").addEventListener("click", () => {
      const c = data.clients.find((x) => x.name === CLIENTS[0][1]) || data.clients[0];
      if (c) state.client = c.address;
      state.prefillJob = true;
      state.clientTab = "post";
      go("client");
    });
    const jb = el.querySelector("#jump-review-btn");
    if (jb)
      jb.addEventListener("click", () =>
        action(jb, () => jump(nextReview.reviewEnds, `Blockchain time moved past the review window of job #${nextReview.jobId}, milestone ${nextReview.idx + 1}`))
      );
  }

  async function viewJobs(el, { data }) {
    const js = data.jobs.slice().reverse();
    el.innerHTML = `
      ${pageHead(
        "Jobs Board",
        "Public view of every job in the contract. Anyone can check that the money really is locked in escrow, and how far each job has progressed, without trusting either side."
      )}
      <div class="card" style="margin-bottom:16px">${legend()}</div>
      ${
        js.length
          ? `<div class="grid-2" style="align-items:start">${js
              .map((j) => {
                const st = jobState(j);
                return `<div class="card job-card">
                  <div class="card-head"><div><h2>${UI.esc(j.title)}</h2><div class="job-sub">Job #${j.id} · ${UI.esc(Chain.label(j.client))} → ${UI.esc(Chain.label(j.freelancer))}</div></div><span class="chip ${st.chip}">${st.label}</span></div>
                  ${progressBar(j)}
                  ${miniStats([
                    ["Budget", UI.esc(fmtEth(j.budget))],
                    ["In escrow", UI.esc(fmtEth(j.locked))],
                    ["Paid", `<span class="money-up">${UI.esc(fmtEth(j.released))}</span>`],
                    ["Refunded", UI.esc(fmtEth(j.refunded))],
                  ])}
                  <ol class="ms-list">${j.milestones
                    .map((m) => {
                      const s = msState(m);
                      return `<li class="ms-row"><div class="ms-main"><div class="ms-title">${m.idx + 1}. ${UI.esc(msTitle(j, m.idx))}</div><div class="ms-meta">${UI.esc(fmtEth(m.amount))} · due ${UI.fmtTime(m.deadline)}${
                        m.submittedAt ? ` · delivered ${UI.fmtTime(m.submittedAt)}` : ""
                      }</div></div><div class="ms-side"><span class="chip ${s.chip}">${UI.esc(s.label)}</span></div></li>`;
                    })
                    .join("")}</ol>
                  <div class="kv" style="margin-top:10px"><span>Review window</span><span>${fmtWindow(j.reviewWindow)} per delivery</span></div>
                  <div class="kv"><span>Brief hash</span><code title="${UI.esc(j.descriptionHash)}">${UI.esc(UI.short(j.descriptionHash, 6))}</code></div>
                  ${j.status === JOB.Completed ? `<div class="kv"><span>Ratings</span><span>${j.clientRating ? `client gave ${j.clientRating}★` : "client: not yet"} · ${j.freelancerRating ? `freelancer gave ${j.freelancerRating}★` : "freelancer: not yet"}</span></div>` : ""}
                </div>`;
              })
              .join("")}</div>`
          : `<div class="card empty">No jobs yet. <a href="#/client">Post one as a client</a>.</div>`
      }`;
  }

  // ---------- Client ----------
  async function viewClient(el, { data, state, action }) {
    const slots = slotsFor(data, ROLE.Client, CLIENT_SLOTS);
    if (!slots.some((a) => sameAddr(a, state.client))) state.client = slots[0];
    const addr = state.client;
    const idx = data.accounts.findIndex((a) => sameAddr(a, addr));
    const me = userOf(data, addr);
    const isClient = me && me.role === ROLE.Client;
    const mine = data.jobs.filter((j) => sameAddr(j.client, addr));
    let tab = state.clientTab || (mine.length ? "jobs" : "post");
    if (!["jobs", "post"].includes(tab)) tab = "jobs";
    state.clientTab = tab;
    const credit = data.credit[lower(addr)] || 0n;
    const locked = mine.reduce((s, j) => s + j.locked, 0n);
    const toReview = mine.flatMap((j) => j.milestones).filter((m) => m.status === MS.Submitted).length;

    const tabs = `<div class="segmented" style="margin-bottom:12px" role="tablist" aria-label="Client account">${slots
      .map((a) => {
        const u = userOf(data, a);
        const i = data.accounts.findIndex((x) => sameAddr(x, a));
        return `<button type="button" role="tab" data-client="${a}" class="${sameAddr(a, addr) ? "active" : ""}">${UI.esc(u ? u.name : `Account #${i} (new)`)}</button>`;
      })
      .join("")}</div>`;
    const info = `<div class="card" style="margin-bottom:16px">
      <div class="card-head" style="margin-bottom:8px"><h2>${UI.esc(me ? me.name : `Account #${idx}`)}</h2>${
        isClient ? `<span class="chip chip-ok">Registered client</span>` : me ? `<span class="chip chip-warn">Registered as a freelancer</span>` : `<span class="chip chip-warn">Not registered yet</span>`
      }</div>
      ${miniStats([
        ["Account", `<code>${UI.esc(UI.short(addr, 4))}</code>`],
        ["Wallet balance", UI.esc(fmtEth(data.wallet[lower(addr)] || 0n))],
        ["Locked in escrow", UI.esc(fmtEth(locked))],
        ["Paid to freelancers", UI.esc(fmtEth(me ? me.spent : 0n))],
        [
          "Available to withdraw",
          `${UI.esc(fmtEth(credit))}${credit > 0n ? ` <button class="btn btn-sm" id="withdraw-btn">${Shell.icon("coins")} Withdraw</button>` : ""}`,
        ],
        ["Reputation", ratingHtml(me)],
      ])}
    </div>`;

    let body = "";
    if (!me) body = registerForm(ROLE.Client, idx);
    else if (!isClient) body = `<div class="card callout">This account is registered as a freelancer. Choose a client account above.</div>`;
    else {
      body = `<div class="segmented" style="margin-bottom:16px" role="tablist" aria-label="Client sections">
          <button type="button" role="tab" data-ctab="jobs" class="${tab === "jobs" ? "active" : ""}">My jobs (${mine.length})${toReview ? ` <span class="badge">${toReview}</span>` : ""}</button>
          <button type="button" role="tab" data-ctab="post" class="${tab === "post" ? "active" : ""}">Post a job</button>
        </div>
        ${tab === "jobs" ? clientJobs(data, state, addr, mine) : postForm(data, state, me)}`;
    }

    el.innerHTML = `
      ${pageHead(
        "Client",
        "Post a job and lock its budget in escrow, then review each delivery: download it, check its hash against the chain, and approve, ask for a revision or dispute. Payments are credited instantly; nobody can run away with the money."
      )}
      ${tabs}${info}${body}`;

    el.querySelectorAll("[data-client]").forEach((b) =>
      b.addEventListener("click", () => {
        state.client = b.dataset.client;
        state.clientTab = null;
        Shell.render();
      })
    );
    el.querySelectorAll("[data-ctab]").forEach((b) =>
      b.addEventListener("click", () => {
        state.clientTab = b.dataset.ctab;
        Shell.render();
      })
    );
    const wb = el.querySelector("#withdraw-btn");
    if (wb) wb.addEventListener("click", () => action(wb, () => withdraw(addr)));
    bindRegister(el, addr, ROLE.Client, action);
    if (isClient && tab === "jobs") bindClientJobs(el, data, state, addr, mine, action);
    if (isClient && tab === "post") bindPostForm(el, data, state, me, action);
  }

  function registerForm(role, idx) {
    const what = role === ROLE.Client ? "client" : "freelancer";
    return `<div class="grid-2" style="align-items:start">
      <form class="card" id="reg-form" autocomplete="off">
        <div class="card-head"><h2>Register as a ${what}</h2></div>
        <p class="muted small">Joining is <strong>permissionless</strong>: any account can register once, with no approval from the Council. Only the arbiter panel is appointed.</p>
        <div class="field"><label for="reg-name">${role === ROLE.Client ? "Business name" : "Handle"} (3-32 characters)</label><input id="reg-name" type="text" maxlength="32" required value="${UI.esc(SUGGESTED_NAME[idx] || "")}"></div>
        <button class="btn" type="submit" id="register-btn">${Shell.icon("users")} Register on-chain</button>
      </form>
      <div class="card callout"><h2>Why register?</h2><p style="margin-top:8px">Your name is how the other side, the arbiters and the reputation board see you. Ratings and completed jobs are tied to your account for good, so a good record follows you to every client.</p></div>
    </div>`;
  }
  function bindRegister(el, addr, role, action) {
    const f = el.querySelector("#reg-form");
    if (!f) return;
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = el.querySelector("#reg-name").value.trim();
      action(el.querySelector("#register-btn"), () => register(addr, role, name));
    });
  }

  function clientJobs(data, state, addr, mine) {
    if (!mine.length) return `<div class="card empty">No jobs yet. Open <em>Post a job</em> to lock a budget in escrow.</div>`;
    let sel = state.reviewSel && sameAddr(state.reviewSel.client, addr) ? state.reviewSel : null;
    if (sel && !(data.jobs[sel.jobId] && data.jobs[sel.jobId].milestones[sel.idx])) sel = null;
    if (!sel) {
      const first = mine.flatMap((j) => j.milestones).find((m) => m.status === MS.Submitted);
      if (first) sel = state.reviewSel = { client: addr, jobId: first.jobId, idx: first.idx };
    }
    const now = Chain.now();
    const cards = mine
      .slice()
      .reverse()
      .map((j) => {
        const st = jobState(j);
        const rows = j.milestones
          .map((m) => {
            const s = msState(m);
            const selected = sel && sel.jobId === j.id && sel.idx === m.idx;
            let actions = "";
            if (m.status === MS.Submitted) actions = `<button class="btn btn-sm" data-review="${key(j.id, m.idx)}">Review</button>`;
            else if (m.deliverableHash !== ethers.ZeroHash) actions = `<button class="btn btn-secondary btn-sm" data-review="${key(j.id, m.idx)}">View</button>`;
            if (j.status === JOB.Active && (m.status === MS.Pending || m.status === MS.RevisionRequested)) {
              if (now >= m.deadline) actions += `<button class="btn btn-danger btn-sm" data-refund="${key(j.id, m.idx)}">Refund (deadline missed)</button>`;
              else
                actions += `<button class="btn btn-ghost btn-sm" data-jump-deadline="${key(j.id, m.idx)}" title="Demo: move blockchain time past this deadline">${Shell.icon("forward")} Jump past deadline</button>`;
            }
            const meta =
              m.status === MS.Submitted && now < m.reviewEnds
                ? `review closes in ${countdown(m.reviewEnds, "now")}`
                : m.status === MS.Pending || m.status === MS.RevisionRequested
                ? `due ${UI.esc(UI.fmtTime(m.deadline))}${now < m.deadline ? ` · ${countdown(m.deadline, "passed")}` : ""}`
                : UI.esc(m.settledAt ? `settled ${UI.fmtTime(m.settledAt)}` : m.submittedAt ? `delivered ${UI.fmtTime(m.submittedAt)}` : "");
            return `<li class="ms-row ${selected ? "selected" : ""}"><div class="ms-main"><div class="ms-title">${m.idx + 1}. ${UI.esc(msTitle(j, m.idx))} · ${UI.esc(fmtEth(m.amount))}</div><div class="ms-meta">${meta}</div></div>
              <div class="ms-side"><span class="chip ${s.chip}">${UI.esc(s.label)}</span>${actions}</div></li>`;
          })
          .join("");
        let foot = "";
        if (j.status === JOB.Open)
          foot = `<div class="job-foot"><span class="muted small">Waiting for ${UI.esc(Chain.label(j.freelancer))} to accept. You can still take the money back.</span><button class="btn btn-secondary btn-sm" data-cancel="${j.id}">Cancel &amp; refund</button></div>`;
        else if (j.status === JOB.Completed)
          foot = `<div class="job-foot">${
            j.clientRating
              ? `<span class="small">You rated ${UI.esc(Chain.label(j.freelancer))}: ${givenStars(j.clientRating)}</span>`
              : `<span class="small">Job completed. Rate ${UI.esc(Chain.label(j.freelancer))}:</span>${rateForm(j.id, "freelancer")}`
          }</div>`;
        return `<div class="card job-card">
          <div class="card-head"><div><h2>${UI.esc(j.title)}</h2><div class="job-sub">Job #${j.id} · freelancer ${UI.esc(Chain.label(j.freelancer))} · review window ${fmtWindow(j.reviewWindow)}</div></div><span class="chip ${st.chip}">${st.label}</span></div>
          ${progressBar(j)}
          <div class="muted small">${UI.esc(fmtEth(j.locked))} still in escrow · ${UI.esc(fmtEth(j.released))} paid · ${UI.esc(fmtEth(j.refunded))} refunded</div>
          <ol class="ms-list">${rows}</ol>${foot}
        </div>`;
      })
      .join("");
    return `<div class="grid-2" style="align-items:start"><div class="stack" id="client-jobs">${cards}</div><div class="card side-panel" id="review-panel">${reviewPanel(data, state, addr, sel)}</div></div>`;
  }

  function rateForm(jobId, who) {
    return `<div class="inline-form"><select data-stars-for="${jobId}" aria-label="Stars for the ${who}">${[5, 4, 3, 2, 1]
      .map((n) => `<option value="${n}">${"★".repeat(n)} ${n}</option>`)
      .join("")}</select><button class="btn btn-sm" data-rate-job="${jobId}">${Shell.icon("check")} Rate ${who}</button></div>`;
  }

  function reviewPanel(data, state, addr, sel) {
    if (!sel) return `<div class="card-head"><h2>Review</h2></div><p class="muted">Choose a delivered milestone to review it. You will download the file, check its SHA-256 against the hash on the blockchain and then decide.</p>`;
    const j = data.jobs[sel.jobId];
    const m = j.milestones[sel.idx];
    const s = msState(m);
    const now = Chain.now();
    const rv = state.review && state.review.jobId === j.id && state.review.idx === m.idx && state.review.hash === m.deliverableHash ? state.review : null;
    const delivered = m.deliverableHash !== ethers.ZeroHash;
    const rec = delivered ? files()[m.deliverableHash] : null;
    let out = `<div class="card-head"><div><h2>${m.idx + 1}. ${UI.esc(msTitle(j, m.idx))}</h2><div class="job-sub">Job #${j.id} · ${UI.esc(j.title)}</div></div><span class="chip ${s.chip}">${UI.esc(s.label)}</span></div>
      <div class="kv"><span>Amount</span><strong>${UI.esc(fmtEth(m.amount))}</strong></div>
      ${
        m.submittedAt
          ? `<div class="kv"><span>Delivered</span><span>${UI.fmtTime(m.submittedAt)} (block time) · ${m.submittedAt <= m.deadline ? "on time" : "late"}</span></div>`
          : `<div class="kv"><span>Deadline</span><span>${UI.fmtTime(m.deadline)}</span></div>`
      }
      <div class="kv"><span>Revisions used</span><span>${m.revisions} of ${MAX_REVISIONS}</span></div>
      ${m.note ? `<div class="kv"><span>Freelancer's note</span><span>"${UI.esc(m.note)}"</span></div>` : ""}
      ${m.feedback ? `<div class="kv"><span>Your last request</span><span>"${UI.esc(m.feedback)}"</span></div>` : ""}`;
    if (delivered) {
      out += fileBox(m, {
        actions: `<button class="btn btn-sm" id="verify-btn">${Shell.icon("shield")} Verify against blockchain</button>
          ${rec && rec.b64 ? `<button class="btn btn-secondary btn-sm" id="download-btn">Download</button><button class="btn btn-secondary btn-sm" id="tamper-btn" title="Flip one bit of the file and verify again">Tamper test</button>` : ""}
          <label class="btn btn-ghost btn-sm">Verify a file I received<input type="file" id="verify-file" hidden></label>`,
      });
      out += `<div id="verify-steps" style="margin-top:12px">${rv ? UI.checklist(rv.items) : ""}</div>`;
    }
    if (j.status !== JOB.Active) {
      if (isSettled(m)) out += `<div class="callout ${m.status === MS.Refunded ? "" : "callout-ok"}" style="margin-top:12px">${UI.esc(settledText(j, m))}</div>`;
      return out;
    }
    if (m.status === MS.Submitted) {
      const open = now < m.reviewEnds;
      const left = MAX_REVISIONS - m.revisions;
      out += `<form class="panel-actions" id="decide-form" onsubmit="return false">
        ${open ? `<div class="callout">Review window: ${countdown(m.reviewEnds, "closed")} left. If you do nothing, ${UI.esc(Chain.label(j.freelancer))} can claim the payment automatically.</div>` : `<div class="callout callout-warn">The review window closed at ${UI.fmtTime(m.reviewEnds)}. ${UI.esc(Chain.label(j.freelancer))} can now claim automatically; you can still approve.</div>`}
        <div><div class="label">Accept the work</div><button type="button" class="btn" id="approve-btn">${Shell.icon("check")} Approve &amp; release ${UI.esc(fmtEth(m.amount))}</button></div>
        <div><div class="label">Ask for changes</div><div class="inline-form"><input type="text" id="revision-reason" aria-label="What should change" maxlength="140" value="${UI.esc(REVISION_HINT[msKind(j, m.idx)] || "")}" ${open && left ? "" : "disabled"}>
          <button type="button" class="btn btn-secondary" id="revision-btn" ${open && left ? "" : "disabled"}>Request revision</button></div>
          <span class="hint">${left} of ${MAX_REVISIONS} revisions left. The freelancer gets at least one more review window to deliver again.</span></div>
        <div><div class="label">Disagree? Raise a dispute</div><div class="inline-form"><input type="text" id="dispute-reason" aria-label="Dispute reason" maxlength="140" value="The delivery does not match the agreed brief." ${open ? "" : "disabled"}>
          <button type="button" class="btn btn-danger" id="dispute-btn" ${open ? "" : "disabled"}>Raise dispute</button></div>
          <span class="hint">Freezes this milestone. Three arbiters vote on the split; 2 of 3 decide.</span></div>
      </form>`;
    } else if (m.status === MS.RevisionRequested) {
      out += `<form class="panel-actions" id="decide-form" onsubmit="return false">
        <div class="callout callout-warn">You asked for revision ${m.revisions}: "${UI.esc(m.feedback)}". A new version is due by ${UI.fmtTime(m.deadline)}${now < m.deadline ? ` (${countdown(m.deadline, "passed")})` : ""}.</div>
        ${now >= m.deadline ? `<div><button type="button" class="btn btn-danger" data-refund="${key(j.id, m.idx)}">Refund (no new version in time)</button></div>` : ""}
        <div><div class="label">Raise a dispute instead</div><div class="inline-form"><input type="text" id="dispute-reason" aria-label="Dispute reason" maxlength="140" value="The freelancer will not fix the agreed issues.">
          <button type="button" class="btn btn-danger" id="dispute-btn">Raise dispute</button></div></div>
      </form>`;
    } else if (m.status === MS.Disputed) {
      out += `<div class="panel-actions"><div class="callout callout-bad">With the arbitration panel: ${m.dispute.votes.length} of 3 votes. Raised by ${UI.esc(Chain.label(m.dispute.raisedBy))}: "${UI.esc(m.dispute.reason)}"</div>${votesHtml(data, m)}</div>`;
    } else if (isSettled(m)) {
      out += `<div class="callout ${m.status === MS.Refunded ? "" : "callout-ok"}" style="margin-top:12px">${UI.esc(settledText(j, m))}</div>`;
    } else if (m.status === MS.Pending) {
      out += `<p class="muted" style="margin-top:12px">Nothing delivered yet. ${now >= m.deadline ? "The deadline has passed: you can take this milestone's money back." : `Due in ${countdown(m.deadline, "passed")}.`}</p>`;
    }
    return out;
  }

  function bindClientJobs(el, data, state, addr, mine, action) {
    el.querySelectorAll("[data-review]").forEach((b) =>
      b.addEventListener("click", () => {
        const [jobId, idx] = parseKey(b.dataset.review);
        state.reviewSel = { client: addr, jobId, idx };
        Shell.render().then(() => {
          if (window.innerWidth < 860) document.getElementById("review-panel")?.scrollIntoView({ block: "start" });
        });
      })
    );
    el.querySelectorAll("[data-refund]").forEach((b) =>
      b.addEventListener("click", () => {
        const [jobId, idx] = parseKey(b.dataset.refund);
        action(b, () => refund(addr, jobId, idx));
      })
    );
    el.querySelectorAll("[data-jump-deadline]").forEach((b) =>
      b.addEventListener("click", () => {
        const [jobId, idx] = parseKey(b.dataset.jumpDeadline);
        const m = data.jobs[jobId].milestones[idx];
        action(b, () => jump(m.deadline, `Blockchain time moved past the deadline of milestone ${idx + 1} (job #${jobId})`));
      })
    );
    el.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => action(b, () => cancelJob(addr, Number(b.dataset.cancel)))));
    el.querySelectorAll("[data-rate-job]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = Number(b.dataset.rateJob);
        const stars = Number(el.querySelector(`[data-stars-for="${id}"]`).value);
        action(b, () => rate(addr, id, stars));
      })
    );
    const sel = state.reviewSel && sameAddr(state.reviewSel.client, addr) ? state.reviewSel : null;
    if (!sel) return;
    const j = data.jobs[sel.jobId];
    const m = j && j.milestones[sel.idx];
    if (!m) return;
    const vb = el.querySelector("#verify-btn");
    if (vb) vb.addEventListener("click", () => action(vb, () => reviewDeliverable(addr, j, m.idx)));
    const tb = el.querySelector("#tamper-btn");
    if (tb) tb.addEventListener("click", () => action(tb, () => reviewDeliverable(addr, j, m.idx, { tamper: true })));
    const db = el.querySelector("#download-btn");
    if (db)
      db.addEventListener("click", () => {
        const rec = files()[m.deliverableHash];
        UI.download(rec.name, new Blob([UI.base64ToBytes(rec.b64)], { type: rec.type || "application/octet-stream" }));
      });
    const vf = el.querySelector("#verify-file");
    if (vf)
      vf.addEventListener("change", async () => {
        const f = vf.files[0];
        if (!f) return;
        if (f.size > GigCrypto.MAX_UPLOAD) return UI.toast(`This file is ${GigCrypto.fmtBytes(f.size)}; the limit is 5 MB.`, "error");
        const bytes = await UI.readFileBytes(f);
        action(null, () => reviewDeliverable(addr, j, m.idx, { bytes, name: f.name }));
      });
    const ab = el.querySelector("#approve-btn");
    if (ab) ab.addEventListener("click", () => action(ab, () => approve(addr, j.id, m.idx)));
    const rb = el.querySelector("#revision-btn");
    if (rb)
      rb.addEventListener("click", () => {
        const reason = el.querySelector("#revision-reason").value.trim();
        if (!reason) return UI.toast("Say what should change", "error");
        action(rb, () => requestRevision(addr, j.id, m.idx, reason));
      });
    const xb = el.querySelector("#dispute-btn");
    if (xb)
      xb.addEventListener("click", () => {
        const reason = el.querySelector("#dispute-reason").value.trim();
        if (!reason) return UI.toast("Give a short reason for the arbiters", "error");
        action(xb, () => raiseDispute(addr, j.id, m.idx, reason));
      });
  }

  function postForm(data, state, me) {
    const prefill = state.prefillJob;
    state.prefillJob = false;
    let d = state.postDraft && sameAddr(state.postDraft.client, me.address) ? state.postDraft : null;
    if (prefill || !d) d = draftFromSample(data, me, prefill);
    state.postDraft = d;
    const res = state.postResult && sameAddr(state.postResult.client, me.address) ? state.postResult : null;
    const fl = data.freelancers;
    return `<div class="grid-2" style="align-items:start">
      <form class="card" id="post-form" autocomplete="off">
        <div class="card-head"><h2>Post a job and lock the budget</h2><button type="button" class="btn btn-ghost btn-sm" id="load-sample-job">Load sample</button></div>
        ${
          fl.length
            ? `<div class="field"><label for="f-freelancer">Hire freelancer</label><select id="f-freelancer" name="freelancer">${fl
                .map(
                  (u) =>
                    `<option value="${u.address}" ${sameAddr(u.address, d.freelancer) ? "selected" : ""}>${UI.esc(u.name)} · ${
                      u.ratingCount ? `${(u.ratingSum / u.ratingCount).toFixed(1)}★ (${u.ratingCount})` : "new"
                    } · ${u.completedJobs} job(s) done</option>`
                )
                .join("")}</select></div>`
            : `<div class="callout callout-warn" style="margin-bottom:12px">No freelancers have registered yet.</div>`
        }
        <div class="field"><label for="f-title">Job title</label><input id="f-title" name="title" type="text" required maxlength="80" value="${UI.esc(d.title)}" placeholder="Brand kit for our launch"></div>
        <div class="field"><label for="f-desc">Brief (scope of work, kept off-chain, its hash goes on-chain)</label><textarea id="f-desc" name="description" rows="4" style="min-height:96px">${UI.esc(d.description)}</textarea></div>
        <div class="field"><label>Milestones <span class="muted small">(leave a title empty to skip a row)</span></label>
          <div class="ms-inputs">${d.milestones
            .map(
              (m, i) => `<div class="ms-input">
              <div><span class="hint">Milestone ${i + 1}</span><input type="text" data-ms="${i}" data-f="title" maxlength="60" value="${UI.esc(m.title)}" aria-label="Milestone ${i + 1} title"></div>
              <div><span class="hint">Deliverable</span><select data-ms="${i}" data-f="kind" aria-label="Milestone ${i + 1} deliverable type">${Object.entries(GigCrypto.KINDS)
                .map(([k, v]) => `<option value="${k}" ${k === m.kind ? "selected" : ""}>${v.label}</option>`)
                .join("")}</select></div>
              <div><span class="hint">ETH</span><input type="number" data-ms="${i}" data-f="eth" min="0" step="0.01" value="${UI.esc(m.eth)}" aria-label="Milestone ${i + 1} amount in ETH"></div>
              <div><span class="hint">Due (days)</span><input type="number" data-ms="${i}" data-f="days" min="1" step="1" value="${UI.esc(m.days)}" aria-label="Milestone ${i + 1} due in days"></div>
            </div>`
            )
            .join("")}</div></div>
        <div class="field"><label for="f-review">Review window per delivery</label><select id="f-review" name="review">${[1, 2, 3, 7]
          .map((n) => `<option value="${n}" ${Number(d.reviewDays) === n ? "selected" : ""}>${n} day${n > 1 ? "s" : ""}</option>`)
          .join("")}</select><span class="hint">If you neither approve nor object in this time, the freelancer can claim the payment.</span></div>
        <div class="total-line"><span>Escrow deposit (sum of milestones)</span><strong id="total-eth">${UI.esc(draftTotal(d))}</strong></div>
        <button class="btn" type="submit" id="post-btn" ${fl.length ? "" : "disabled"}>${Shell.icon("coins")} Lock budget &amp; post job</button>
      </form>
      <div class="card">
        <div class="card-head"><h2>What happens</h2></div>
        <div id="post-steps">${
          res
            ? UI.checklist(res.items)
            : `<p class="muted">The brief is fingerprinted with SHA-256, the full budget is deposited into the smart contract together with the milestone plan, and the brief is shared off-chain. From now on the money can only go to the freelancer (for delivered work) or back to you (missed deadlines, arbiters' decision).</p>`
        }</div>
        ${res && res.items.every((i) => i.status === "ok") ? `<button type="button" class="btn btn-secondary btn-sm" data-ctab="jobs" style="margin-top:14px">See it in My jobs</button>` : ""}
      </div>
    </div>`;
  }

  function draftFromSample(data, me, useSample) {
    const s = useSample ? SAMPLE_JOBS[me.name] || DEFAULT_JOB : DEFAULT_JOB;
    const fl = s.freelancer.map((n) => data.freelancers.find((u) => u.name === n)).find(Boolean) || data.freelancers[0];
    return {
      client: me.address,
      freelancer: fl ? fl.address : "",
      title: s.title,
      description: s.description,
      milestones: s.milestones.map((m) => ({ ...m })),
      reviewDays: s.reviewDays,
    };
  }
  function draftTotal(d) {
    let sum = 0n;
    for (const m of d.milestones) {
      if (!String(m.title).trim()) continue;
      try {
        sum += ethers.parseEther(String(m.eth || "0"));
      } catch {}
    }
    return fmtEth(sum);
  }

  function bindPostForm(el, data, state, me, action) {
    const form = el.querySelector("#post-form");
    const d = state.postDraft;
    const sync = () => {
      d.freelancer = form.freelancer ? form.freelancer.value : "";
      d.title = form.title.value;
      d.description = form.description.value;
      d.reviewDays = Number(form.review.value);
      form.querySelectorAll("[data-ms]").forEach((inp) => (d.milestones[Number(inp.dataset.ms)][inp.dataset.f] = inp.value));
      el.querySelector("#total-eth").textContent = draftTotal(d);
    };
    form.addEventListener("input", sync);
    form.addEventListener("change", sync);
    el.querySelector("#load-sample-job").addEventListener("click", () => {
      state.postDraft = draftFromSample(data, me, true);
      Shell.render();
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      sync();
      const milestones = d.milestones
        .filter((m) => String(m.title).trim())
        .map((m) => ({ title: m.title.trim(), kind: m.kind, eth: String(m.eth).trim(), days: Number(m.days) }));
      if (!d.freelancer) return UI.toast("Choose a freelancer", "error");
      if (!d.title.trim()) return UI.toast("Give the job a title", "error");
      if (!milestones.length) return UI.toast("Add at least one milestone with a title", "error");
      if (milestones.some((m) => !(Number(m.eth) > 0) || !(m.days >= 1))) return UI.toast("Each milestone needs an amount above 0 ETH and at least 1 day", "error");
      action(el.querySelector("#post-btn"), async () => {
        const jobId = await postJob(me.address, {
          freelancer: d.freelancer,
          title: d.title.trim(),
          description: d.description.replace(/\r\n/g, "\n").trim(),
          milestones,
          reviewDays: d.reviewDays,
        });
        state.postDraft = null;
        state.reviewSel = null;
        return jobId;
      });
    });
  }

  // ---------- Freelancer ----------
  async function viewFreelancer(el, { data, state, action }) {
    const slots = slotsFor(data, ROLE.Freelancer, FREELANCER_SLOTS);
    if (!slots.some((a) => sameAddr(a, state.freelancer))) state.freelancer = slots[0];
    const addr = state.freelancer;
    const idx = data.accounts.findIndex((a) => sameAddr(a, addr));
    const me = userOf(data, addr);
    const isFreelancer = me && me.role === ROLE.Freelancer;
    const mine = data.jobs.filter((j) => sameAddr(j.freelancer, addr));
    const offers = mine.filter((j) => j.status === JOB.Open);
    const working = mine.filter((j) => j.status !== JOB.Open && j.status !== JOB.Cancelled);
    const credit = data.credit[lower(addr)] || 0n;
    const pending = working.reduce((s, j) => s + j.locked, 0n);

    const tabs = `<div class="segmented" style="margin-bottom:12px" role="tablist" aria-label="Freelancer account">${slots
      .map((a) => {
        const u = userOf(data, a);
        const i = data.accounts.findIndex((x) => sameAddr(x, a));
        return `<button type="button" role="tab" data-freelancer="${a}" class="${sameAddr(a, addr) ? "active" : ""}">${UI.esc(u ? u.name : `Account #${i} (new)`)}</button>`;
      })
      .join("")}</div>`;
    const info = `<div class="card" style="margin-bottom:16px">
      <div class="card-head" style="margin-bottom:8px"><h2>${UI.esc(me ? me.name : `Account #${idx}`)}</h2>${
        isFreelancer ? `<span class="chip chip-ok">Registered freelancer</span>` : me ? `<span class="chip chip-warn">Registered as a client</span>` : `<span class="chip chip-warn">Not registered yet</span>`
      }</div>
      ${miniStats([
        ["Account", `<code>${UI.esc(UI.short(addr, 4))}</code>`],
        ["Wallet balance", UI.esc(fmtEth(data.wallet[lower(addr)] || 0n))],
        [
          "Available to withdraw",
          `<span class="${credit > 0n ? "money-up" : ""}">${UI.esc(fmtEth(credit))}</span>${credit > 0n ? ` <button class="btn btn-sm" id="withdraw-btn">${Shell.icon("coins")} Withdraw</button>` : ""}`,
        ],
        ["Earned (all time)", UI.esc(fmtEth(me ? me.earned : 0n))],
        ["Still in escrow for you", UI.esc(fmtEth(pending))],
        ["Reputation", ratingHtml(me)],
      ])}
    </div>`;

    let body = "";
    if (!me) body = registerForm(ROLE.Freelancer, idx);
    else if (!isFreelancer) body = `<div class="card callout">This account is registered as a client. Choose a freelancer account above.</div>`;
    else body = freelancerWork(data, state, addr, offers, working);

    el.innerHTML = `
      ${pageHead(
        "Freelancer",
        "The money is locked before you start. Deliver each milestone by committing the file's SHA-256 hash on-chain: a timestamped proof of what you delivered. If the client stays silent past the review window, claim the payment yourself."
      )}
      ${tabs}${info}${body}`;

    el.querySelectorAll("[data-freelancer]").forEach((b) =>
      b.addEventListener("click", () => {
        state.freelancer = b.dataset.freelancer;
        Shell.render();
      })
    );
    const wb = el.querySelector("#withdraw-btn");
    if (wb) wb.addEventListener("click", () => action(wb, () => withdraw(addr)));
    bindRegister(el, addr, ROLE.Freelancer, action);
    if (isFreelancer) bindFreelancerWork(el, data, state, addr, action);
  }

  function freelancerWork(data, state, addr, offers, working) {
    const now = Chain.now();
    let sel = state.deliverSel && sameAddr(state.deliverSel.freelancer, addr) ? state.deliverSel : null;
    if (sel && !(data.jobs[sel.jobId] && data.jobs[sel.jobId].milestones[sel.idx])) sel = null;
    if (!sel) {
      const first = working
        .filter((j) => j.status === JOB.Active)
        .flatMap((j) => j.milestones)
        .find((m) => m.status === MS.Pending || m.status === MS.RevisionRequested);
      if (first) sel = state.deliverSel = { freelancer: addr, jobId: first.jobId, idx: first.idx };
    }

    const offerCards = offers
      .map(
        (j) => `<div class="card job-card">
        <div class="card-head"><div><h2>${UI.esc(j.title)}</h2><div class="job-sub">Job offer #${j.id} from ${UI.esc(Chain.label(j.client))} ${ratingHtml(userOf(data, j.client))}</div></div><span class="chip chip-warn">New offer</span></div>
        <div class="callout callout-ok"><strong>${UI.esc(fmtEth(j.budget))} already locked in escrow</strong> by the client. You will be paid from it, milestone by milestone.</div>
        ${briefHtml(j)}
        <ol class="ms-list">${j.milestones
          .map(
            (m) =>
              `<li class="ms-row"><div class="ms-main"><div class="ms-title">${m.idx + 1}. ${UI.esc(msTitle(j, m.idx))}</div><div class="ms-meta">${UI.esc(fmtEth(m.amount))} · due ${UI.fmtTime(m.deadline)}</div></div></li>`
          )
          .join("")}</ol>
        <div class="job-foot"><button class="btn" data-accept="${j.id}">${Shell.icon("check")} Accept job</button><span class="muted small">Review window: ${fmtWindow(j.reviewWindow)} per delivery.</span></div>
      </div>`
      )
      .join("");

    const jobCards = working
      .slice()
      .reverse()
      .map((j) => {
        const st = jobState(j);
        const rows = j.milestones
          .map((m) => {
            const s = msState(m);
            const selected = sel && sel.jobId === j.id && sel.idx === m.idx;
            let actions = "";
            let meta = "";
            if (j.status === JOB.Active && (m.status === MS.Pending || m.status === MS.RevisionRequested)) {
              actions = `<button class="btn btn-sm" data-deliver="${key(j.id, m.idx)}">${Shell.icon("upload")} ${m.status === MS.RevisionRequested ? `Deliver v${m.revisions + 1}` : "Deliver"}</button>`;
              meta = `due ${UI.esc(UI.fmtTime(m.deadline))}${now < m.deadline ? ` · ${countdown(m.deadline, "passed")}` : " · deadline passed: the client may take a refund"}`;
            } else if (m.status === MS.Submitted) {
              const early = now < m.reviewEnds;
              actions = `<button class="btn ${early ? "btn-secondary" : ""} btn-sm" data-claim="${key(j.id, m.idx)}">${Shell.icon("coins")} Claim payment</button>${
                early ? `<button class="btn btn-ghost btn-sm" data-jump-review="${key(j.id, m.idx)}" title="Demo: move blockchain time past the review window">${Shell.icon("forward")} Jump past review window</button>` : ""
              }`;
              meta = early ? `client review: ${countdown(m.reviewEnds, "over")} left, then auto-release` : "review window over: claim the payment";
            } else if (m.status === MS.Disputed) {
              meta = `with the arbiters · ${m.dispute.votes.length} of 3 votes`;
              actions = `<button class="btn btn-ghost btn-sm" data-deliver="${key(j.id, m.idx)}">Details</button>`;
            } else if (isSettled(m)) {
              const got = (m.amount * BigInt(m.share)) / BigInt(BPS);
              meta = `${got > 0n ? `you received ${UI.esc(fmtEth(got))}` : "nothing paid"} · ${UI.esc(UI.fmtTime(m.settledAt))}`;
              if (m.deliverableHash !== ethers.ZeroHash) actions = `<button class="btn btn-ghost btn-sm" data-deliver="${key(j.id, m.idx)}">Details</button>`;
            }
            return `<li class="ms-row ${selected ? "selected" : ""}"><div class="ms-main"><div class="ms-title">${m.idx + 1}. ${UI.esc(msTitle(j, m.idx))} · ${UI.esc(fmtEth(m.amount))}</div><div class="ms-meta">${meta}</div>
              ${m.status === MS.RevisionRequested ? `<div class="ms-note">Client: "${UI.esc(m.feedback)}"</div>` : ""}</div>
              <div class="ms-side"><span class="chip ${s.chip}">${UI.esc(s.label)}</span>${actions}</div></li>`;
          })
          .join("");
        let foot = "";
        if (j.status === JOB.Completed)
          foot = `<div class="job-foot">${
            j.freelancerRating
              ? `<span class="small">You rated ${UI.esc(Chain.label(j.client))}: ${givenStars(j.freelancerRating)}</span>`
              : `<span class="small">Job completed. Rate ${UI.esc(Chain.label(j.client))}:</span>${rateForm(j.id, "client")}`
          }${j.clientRating ? `<span class="small muted">Client's rating of you: ${givenStars(j.clientRating)}</span>` : ""}</div>`;
        return `<div class="card job-card">
          <div class="card-head"><div><h2>${UI.esc(j.title)}</h2><div class="job-sub">Job #${j.id} · client ${UI.esc(Chain.label(j.client))} · review window ${fmtWindow(j.reviewWindow)}</div></div><span class="chip ${st.chip}">${st.label}</span></div>
          ${progressBar(j)}
          <div class="muted small">${UI.esc(fmtEth(j.released))} paid to you · ${UI.esc(fmtEth(j.locked))} still in escrow</div>
          <ol class="ms-list">${rows}</ol>${foot}
        </div>`;
      })
      .join("");

    if (!offers.length && !working.length) return `<div class="card empty">No job offers yet. A client must post a job for you first.</div>`;
    return `<div class="grid-2" style="align-items:start">
      <div class="stack" id="freelancer-jobs">${offerCards}${jobCards}</div>
      <div class="card side-panel" id="deliver-panel">${deliverPanel(data, state, addr, sel)}</div>
    </div>`;
  }

  function deliverPanel(data, state, addr, sel) {
    if (!sel) return `<div class="card-head"><h2>Deliver</h2></div><p class="muted">Accept a job, then choose a milestone to deliver. The file is fingerprinted in your browser; only the SHA-256 hash goes on-chain.</p>`;
    const j = data.jobs[sel.jobId];
    const m = j.milestones[sel.idx];
    const s = msState(m);
    const res = state.deliverResult && state.deliverResult.jobId === j.id && state.deliverResult.idx === m.idx && sameAddr(state.deliverResult.freelancer, addr) ? state.deliverResult : null;
    const canDeliver = j.status === JOB.Active && (m.status === MS.Pending || m.status === MS.RevisionRequested);
    const version = m.revisions + 1;
    let out = `<div class="card-head"><div><h2>${m.idx + 1}. ${UI.esc(msTitle(j, m.idx))}</h2><div class="job-sub">Job #${j.id} · ${UI.esc(j.title)} · ${UI.esc(fmtEth(m.amount))}</div></div><span class="chip ${s.chip}">${UI.esc(s.label)}</span></div>`;
    if (canDeliver) {
      const draft = state.draft && sameAddr(state.draft.freelancer, addr) && state.draft.jobId === j.id && state.draft.idx === m.idx ? state.draft : null;
      const kind = msKind(j, m.idx);
      const noun = (GigCrypto.KINDS[kind] || GigCrypto.KINDS.copy).noun;
      const note = draft && draft.note != null ? draft.note : version === 1 ? `First version of the ${noun}.` : `Version ${version}: changes from the revision request applied.`;
      out += `${m.status === MS.RevisionRequested ? `<div class="callout callout-warn">The client asked for revision ${m.revisions}: "${UI.esc(m.feedback)}". Deliver a new version by ${UI.fmtTime(m.deadline)}.</div>` : ""}
        <form id="deliver-form" onsubmit="return false" autocomplete="off">
          <div class="label" style="margin-top:12px">1. Choose the deliverable (version ${version})</div>
          <div class="gen-row">${Object.entries(GigCrypto.KINDS)
            .map(
              ([k, v]) =>
                `<button type="button" class="btn ${k === kind ? "btn-secondary" : "btn-ghost"} btn-sm" data-gen="${k}">Generate sample ${UI.esc(v.noun)}</button>`
            )
            .join("")}<label class="btn btn-ghost btn-sm">${Shell.icon("upload")} Upload my own file<input type="file" id="upload-file" hidden></label></div>
          <span class="hint muted small">Up to ${GigCrypto.fmtBytes(GigCrypto.MAX_UPLOAD)}. Files over ${GigCrypto.fmtBytes(GigCrypto.MAX_STORED)} are hashed but not stored here.</span>
          ${
            draft
              ? previewBox(
                  draft.size <= GigCrypto.MAX_STORED ? draft : null,
                  `<div class="file-head"><span class="file-name">${UI.esc(draft.name)}</span><span class="muted small">${GigCrypto.fmtBytes(draft.size)}</span></div>
                   <p class="muted small" style="margin:6px 0 0">${
                     draft.size <= GigCrypto.MAX_STORED ? "Ready to fingerprint. Nothing has left your browser yet." : "Large file: preview skipped, only its hash will be shared."
                   }</p>`
                )
              : `<p class="muted small" style="margin-top:8px">No file chosen yet.</p>`
          }
          <div class="field" style="margin-top:12px"><label for="note">2. Note for the client (stored on-chain, public)</label><input type="text" id="note" maxlength="140" value="${UI.esc(note)}"></div>
          <button type="button" class="btn" id="submit-btn" ${draft ? "" : "disabled"}>${Shell.icon("shield")} Hash &amp; submit on-chain</button>
        </form>`;
      if (m.status === MS.RevisionRequested)
        out += `<form class="panel-actions" onsubmit="return false"><div><div class="label">Revision outside the agreed scope? Raise a dispute</div><div class="inline-form"><input type="text" id="f-dispute-reason" aria-label="Dispute reason" maxlength="140" value="The revision request goes beyond the agreed brief.">
          <button type="button" class="btn btn-danger" id="f-dispute-btn">Raise dispute</button></div><span class="hint">The arbiters will compare the brief, the delivery and the request.</span></div></form>`;
    } else {
      if (m.deliverableHash !== ethers.ZeroHash) out += fileBox(m);
      if (m.status === MS.Submitted)
        out += `<div class="callout" style="margin-top:12px">${
          Chain.now() < m.reviewEnds
            ? `The client can review until ${UI.fmtTime(m.reviewEnds)} (${countdown(m.reviewEnds, "over")}). After that, <em>Claim payment</em> releases the money without the client.`
            : "The review window is over: use <em>Claim payment</em>."
        }</div>`;
      else if (m.status === MS.Disputed) out += `<div class="callout callout-bad" style="margin-top:12px">In dispute: "${UI.esc(m.dispute.reason)}"</div>${votesHtml(data, m)}`;
      else if (isSettled(m)) out += `<div class="callout ${m.status === MS.Refunded ? "" : "callout-ok"}" style="margin-top:12px">${UI.esc(settledText(j, m))}</div>`;
    }
    out += `<div id="deliver-steps" style="margin-top:14px">${res ? UI.checklist(res.items) : ""}</div>`;
    return out;
  }

  function bindFreelancerWork(el, data, state, addr, action) {
    el.querySelectorAll("[data-accept]").forEach((b) => b.addEventListener("click", () => action(b, () => acceptJob(addr, Number(b.dataset.accept)))));
    el.querySelectorAll("[data-deliver]").forEach((b) =>
      b.addEventListener("click", () => {
        const [jobId, idx] = parseKey(b.dataset.deliver);
        state.deliverSel = { freelancer: addr, jobId, idx };
        Shell.render().then(() => {
          if (window.innerWidth < 860) document.getElementById("deliver-panel")?.scrollIntoView({ block: "start" });
        });
      })
    );
    el.querySelectorAll("[data-claim]").forEach((b) =>
      b.addEventListener("click", () => {
        const [jobId, idx] = parseKey(b.dataset.claim);
        action(b, () => claim(addr, jobId, idx));
      })
    );
    el.querySelectorAll("[data-jump-review]").forEach((b) =>
      b.addEventListener("click", () => {
        const [jobId, idx] = parseKey(b.dataset.jumpReview);
        const m = data.jobs[jobId].milestones[idx];
        action(b, () => jump(m.reviewEnds, `Blockchain time moved past the client's review window (job #${jobId}, milestone ${idx + 1})`));
      })
    );
    el.querySelectorAll("[data-rate-job]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = Number(b.dataset.rateJob);
        const stars = Number(el.querySelector(`[data-stars-for="${id}"]`).value);
        action(b, () => rate(addr, id, stars));
      })
    );
    const sel = state.deliverSel && sameAddr(state.deliverSel.freelancer, addr) ? state.deliverSel : null;
    if (!sel) return;
    const j = data.jobs[sel.jobId];
    const m = j.milestones[sel.idx];
    const setDraft = (f) => {
      state.draft = { freelancer: addr, jobId: j.id, idx: m.idx, note: state.draft && state.draft.jobId === j.id && state.draft.idx === m.idx ? state.draft.note : null, ...f };
      Shell.render();
    };
    el.querySelectorAll("[data-gen]").forEach((b) =>
      b.addEventListener("click", () => {
        const f = GigCrypto.sample(b.dataset.gen, { brand: Chain.label(j.client), author: Chain.label(addr), jobId: j.id, index: m.idx, version: m.revisions + 1 });
        setDraft({ name: f.name, type: f.type, size: f.bytes.length, b64: UI.bytesToBase64(f.bytes) });
      })
    );
    const up = el.querySelector("#upload-file");
    if (up)
      up.addEventListener("change", async () => {
        const f = up.files[0];
        if (!f) return;
        if (f.size > GigCrypto.MAX_UPLOAD) return UI.toast(`This file is ${GigCrypto.fmtBytes(f.size)}; the limit is 5 MB.`, "error");
        const bytes = await UI.readFileBytes(f);
        setDraft({ name: f.name, type: f.type || "application/octet-stream", size: bytes.length, b64: UI.bytesToBase64(bytes) });
      });
    const note = el.querySelector("#note");
    if (note)
      note.addEventListener("input", () => {
        if (state.draft && state.draft.jobId === j.id && state.draft.idx === m.idx) state.draft.note = note.value;
      });
    const sb = el.querySelector("#submit-btn");
    if (sb)
      sb.addEventListener("click", () => {
        const d = state.draft;
        if (!d) return UI.toast("Choose or generate a file first", "error");
        action(sb, () => submitDeliverable(addr, j.id, m.idx, d, note.value.trim()));
      });
    const db = el.querySelector("#f-dispute-btn");
    if (db)
      db.addEventListener("click", () => {
        const reason = el.querySelector("#f-dispute-reason").value.trim();
        if (!reason) return UI.toast("Give a short reason for the arbiters", "error");
        action(db, () => raiseDispute(addr, j.id, m.idx, reason));
      });
  }

  // ---------- Arbitration panel ----------
  async function viewArbitration(el, { data, state, action }) {
    const arbs = data.arbiters;
    if (!arbs.length) {
      el.innerHTML = `${pageHead("Arbitration Panel", "No arbiter panel has been appointed yet.")}<div class="card empty">The GigSafe Council has not appointed the panel.</div>`;
      return;
    }
    if (!arbs.some((a) => sameAddr(a.address, state.arbiter))) state.arbiter = arbs[0].address;
    const me = arbs.find((a) => sameAddr(a.address, state.arbiter));
    const all = data.jobs.flatMap((j) => j.milestones.filter((m) => m.dispute).map((m) => ({ j, m })));
    const open = all.filter(({ m }) => m.status === MS.Disputed);
    const resolved = all.filter(({ m }) => m.status === MS.Resolved);
    const waiting = open.filter(({ m }) => !m.dispute.votes.some((v) => sameAddr(v.voter, me.address))).length;
    const ev = state.evidence;

    const cards = open.length
      ? open
          .map(({ j, m }) => {
            const k = key(j.id, m.idx);
            const mine = m.dispute.votes.find((v) => sameAddr(v.voter, me.address));
            const showEv = ev && ev.jobId === j.id && ev.idx === m.idx;
            const draftBps = (state.voteDraft || {})[k] ?? 5000;
            return `<div class="card dispute-card">
              <div class="card-head"><div><h2>Job #${j.id} · ${m.idx + 1}. ${UI.esc(msTitle(j, m.idx))}</h2><div class="job-sub">${UI.esc(j.title)} · ${UI.esc(Chain.label(j.client))} vs ${UI.esc(Chain.label(j.freelancer))}</div></div><span class="chip chip-bad">In dispute</span></div>
              <div class="dispute-grid">
                <div>
                  <div class="kv"><span>At stake</span><strong>${UI.esc(fmtEth(m.amount))}</strong></div>
                  <div class="kv"><span>Raised by</span><span>${UI.esc(Chain.label(m.dispute.raisedBy))} (${sameAddr(m.dispute.raisedBy, j.client) ? "client" : "freelancer"}), ${UI.fmtTime(m.dispute.raisedAt)}</span></div>
                  <div class="kv"><span>Reason</span><span>"${UI.esc(m.dispute.reason)}"</span></div>
                  ${m.feedback ? `<div class="kv"><span>Client's request</span><span>"${UI.esc(m.feedback)}"</span></div>` : ""}
                  ${m.note ? `<div class="kv"><span>Freelancer's note</span><span>"${UI.esc(m.note)}"</span></div>` : ""}
                  <div class="kv"><span>Delivered</span><span>${UI.fmtTime(m.submittedAt)} · ${m.submittedAt <= m.deadline ? "on time" : "late"} · ${m.revisions} revision(s)</span></div>
                  ${j.brief ? `<div class="brief"><p><strong>Agreed brief:</strong> ${UI.esc(j.brief.description)}</p></div>` : ""}
                  <div class="row" style="margin-top:10px"><button class="btn btn-sm ${showEv && ev.ok ? "btn-secondary" : ""}" data-evidence="${k}">${Shell.icon("check")} Verify evidence</button><span class="muted small">checks the brief and the file against their on-chain hashes</span></div>
                  <div data-ev-host="${k}">${showEv ? `<div id="evidence-steps" style="margin-top:12px">${UI.checklist(ev.items)}</div>` : ""}</div>
                </div>
                <div>
                  <div class="label">Votes (${m.dispute.votes.length} of 3)</div>
                  ${votesHtml(data, m, me.address)}
                  ${
                    mine
                      ? `<p class="small muted" style="margin-top:10px">You voted ${pct(mine.bps)} for the freelancer. Waiting for another arbiter to agree.</p>`
                      : `<form class="share-box" onsubmit="return false">
                      <label class="label" for="share-${k}">Your decision as ${UI.esc(me.name)}: freelancer's share</label>
                      <input type="range" id="share-${k}" data-share="${k}" min="0" max="100" step="10" value="${draftBps / 100}" aria-describedby="split-${k}">
                      <div class="share-split" id="split-${k}">${splitText(m.amount, draftBps)}</div>
                      <button type="button" class="btn" data-vote="${k}" style="margin-top:10px">${Shell.icon("check")} Cast vote</button>
                    </form>`
                  }
                  ${showEv && ev.ok ? fileBox(m) : ""}
                </div>
              </div>
            </div>`;
          })
          .join("")
      : `<div class="card empty">No open disputes. When a client or freelancer raises one, it appears here.</div>`;

    el.innerHTML = `
      ${pageHead(
        "Arbitration Panel",
        "Three independent arbiters, appointed by the GigSafe Council, settle disputes. Each one votes once on the freelancer's share of the disputed milestone. The contract executes the split as soon as two votes agree; if all three differ, the median vote is executed."
      )}
      <div class="segmented" style="margin-bottom:12px" role="tablist" aria-label="Arbiter">${arbs
        .map((a) => `<button type="button" role="tab" data-arbiter="${a.address}" class="${sameAddr(a.address, me.address) ? "active" : ""}">${UI.esc(a.name)}</button>`)
        .join("")}</div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-head" style="margin-bottom:8px"><h2>${UI.esc(me.name)}</h2><span class="chip chip-accent">Seat ${me.seat + 1} of 3</span></div>
        ${miniStats([
          ["Account", `<code>${UI.esc(UI.short(me.address, 4))}</code>`],
          ["Open disputes", String(open.length)],
          ["Waiting for my vote", String(waiting)],
          ["Resolved so far", String(resolved.length)],
        ])}
      </div>
      <div class="stack" id="disputes">${cards}</div>
      <div class="grid-3" style="align-items:start;margin-top:16px">
          <div class="card">
            <div class="card-head"><h2>Decision rule</h2></div>
            <ol class="demo-list">
              <li>Each arbiter proposes the freelancer's share (0 to 100 %) and votes once.</li>
              <li>As soon as <strong>two votes are identical</strong>, the contract pays that split: freelancer's share to the freelancer, the rest back to the client.</li>
              <li>If all <strong>three votes differ</strong>, the <strong>median</strong> is executed. With at most one biased arbiter, the median always lies between the two honest votes.</li>
              <li>The panel cannot be changed while any dispute is open.</li>
            </ol>
          </div>
          <div class="card">
            <div class="card-head"><h2>Panel</h2><span class="muted small">Appointed by the GigSafe Council (permissioned)</span></div>
            <div class="table-wrap"><table class="table"><thead><tr><th>Seat</th><th>Arbiter</th><th>Votes cast</th></tr></thead><tbody>${arbs
              .map(
                (a) =>
                  `<tr><td data-label="Seat">${a.seat + 1}</td><td data-label="Arbiter"><div><strong>${UI.esc(a.name)}</strong><div class="muted small"><code>${UI.esc(UI.short(a.address, 4))}</code></div></div></td><td data-label="Votes cast">${
                    all.filter(({ m }) => m.dispute.votes.some((v) => sameAddr(v.voter, a.address))).length
                  }</td></tr>`
              )
              .join("")}</tbody></table></div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Resolved disputes</h2></div>
            ${
              resolved.length
                ? `<div class="table-wrap"><table class="table" id="resolved"><thead><tr><th>Milestone</th><th>Votes</th><th>Executed</th></tr></thead><tbody>${resolved
                    .map(
                      ({ j, m }) => `<tr><td data-label="Milestone">Job #${j.id} · ${m.idx + 1}. ${UI.esc(msTitle(j, m.idx))}</td>
                      <td data-label="Votes">${m.dispute.votes.map((v) => pct(v.bps)).join(" · ")}</td>
                      <td data-label="Executed"><div><span class="chip chip-violet">${pct(m.share)} to freelancer</span><div class="muted small">${m.dispute.byMedian ? "median of 3" : "2 of 3 agreed"}</div></div></td></tr>`
                    )
                    .join("")}</tbody></table></div>`
                : `<p class="muted">None yet.</p>`
            }
          </div>
      </div>`;

    el.querySelectorAll("[data-arbiter]").forEach((b) =>
      b.addEventListener("click", () => {
        state.arbiter = b.dataset.arbiter;
        Shell.render();
      })
    );
    el.querySelectorAll("[data-evidence]").forEach((b) =>
      b.addEventListener("click", () => {
        const [jobId, idx] = parseKey(b.dataset.evidence);
        el.querySelectorAll("#evidence-steps").forEach((x) => x.removeAttribute("id"));
        el.querySelector(`[data-ev-host="${b.dataset.evidence}"]`).innerHTML = `<div id="evidence-steps" style="margin-top:12px"></div>`;
        action(b, () => verifyEvidence(data.jobs[jobId], idx));
      })
    );
    el.querySelectorAll("[data-share]").forEach((inp) =>
      inp.addEventListener("input", () => {
        const k = inp.dataset.share;
        const [jobId, idx] = parseKey(k);
        const bps = Number(inp.value) * 100;
        state.voteDraft = { ...(state.voteDraft || {}), [k]: bps };
        el.querySelector(`#split-${CSS.escape(k)}`).innerHTML = splitText(data.jobs[jobId].milestones[idx].amount, bps);
      })
    );
    el.querySelectorAll("[data-vote]").forEach((b) =>
      b.addEventListener("click", () => {
        const k = b.dataset.vote;
        const [jobId, idx] = parseKey(k);
        const bps = Number(el.querySelector(`[data-share="${k}"]`).value) * 100;
        action(b, () => vote(me.address, jobId, idx, bps));
      })
    );
  }

  function splitText(amount, bps) {
    const toF = (amount * BigInt(bps)) / BigInt(BPS);
    return `<span>Freelancer <strong>${pct(bps)}</strong> = ${UI.esc(fmtEth(toF))}</span><span>Client <strong>${pct(BPS - bps)}</strong> = ${UI.esc(fmtEth(amount - toF))}</span>`;
  }

  // ---------- Reputation ----------
  async function viewReputation(el, { data }) {
    const rank = (list, volume) =>
      list.slice().sort((a, b) => {
        const ra = a.ratingCount ? a.ratingSum / a.ratingCount : -1;
        const rb = b.ratingCount ? b.ratingSum / b.ratingCount : -1;
        if (rb !== ra) return rb - ra;
        if (b.completedJobs !== a.completedJobs) return b.completedJobs - a.completedJobs;
        return volume(b) > volume(a) ? 1 : volume(b) < volume(a) ? -1 : 0;
      });
    const fl = rank(data.freelancers, (u) => u.earned);
    const cl = rank(data.clients, (u) => u.spent);
    const disputesOf = (addr) => data.jobs.filter((j) => sameAddr(j.client, addr) || sameAddr(j.freelancer, addr)).flatMap((j) => j.milestones).filter((m) => m.dispute).length;
    const rated = data.jobs.filter((j) => j.status === JOB.Completed);
    const table = (id, list, kind) =>
      list.length
        ? `<div class="table-wrap"><table class="table" id="${id}"><thead><tr><th>Rank</th><th>${kind === "f" ? "Freelancer" : "Client"}</th><th>Rating</th><th>Jobs done</th><th>${
            kind === "f" ? "Earned" : "Paid out"
          }</th><th>Disputes</th></tr></thead><tbody>${list
            .map(
              (u, i) => `<tr><td data-label="Rank"><span class="rank rank-${i + 1}">${i + 1}</span></td>
              <td data-label="${kind === "f" ? "Freelancer" : "Client"}"><div><strong>${UI.esc(u.name)}</strong><div class="muted small"><code>${UI.esc(UI.short(u.address, 4))}</code></div></div></td>
              <td data-label="Rating">${ratingHtml(u)}</td>
              <td data-label="Jobs done">${u.completedJobs} of ${u.jobs}</td>
              <td data-label="${kind === "f" ? "Earned" : "Paid out"}"><span class="money ${kind === "f" && u.earned > 0n ? "money-up" : ""}">${UI.esc(fmtEth(kind === "f" ? u.earned : u.spent))}</span></td>
              <td data-label="Disputes">${disputesOf(u.address)}</td></tr>`
            )
            .join("")}</tbody></table></div>`
        : `<div class="empty">Nobody yet.</div>`;

    el.innerHTML = `
      ${pageHead(
        "Reputation",
        "Ratings are written on-chain by the two parties of a completed job, once each. Outsiders cannot rate, nobody can edit a rating later, and volume is the ETH actually paid through the escrow."
      )}
      <div class="stack">
        <div class="card"><div class="card-head"><h2>Freelancers</h2><span class="muted small">Ranked by average rating, then completed jobs, then earnings</span></div>${table("freelancer-board", fl, "f")}</div>
        <div class="card"><div class="card-head"><h2>Clients</h2><span class="muted small">Freelancers rate clients too: fair reviews and prompt payment count</span></div>${table("client-board", cl, "c")}</div>
        <div class="card"><div class="card-head"><h2>Ratings per completed job</h2></div>${
          rated.length
            ? `<div class="table-wrap"><table class="table"><thead><tr><th>Job</th><th>Client → freelancer</th><th>Freelancer → client</th><th>Paid / refunded</th></tr></thead><tbody>${rated
                .map(
                  (j) => `<tr><td data-label="Job"><div><strong>${UI.esc(j.title)}</strong><div class="muted small">#${j.id} · ${UI.esc(Chain.label(j.client))} → ${UI.esc(Chain.label(j.freelancer))}</div></div></td>
                  <td data-label="Client gave">${j.clientRating ? givenStars(j.clientRating) : `<span class="muted small">not yet</span>`}</td>
                  <td data-label="Freelancer gave">${j.freelancerRating ? givenStars(j.freelancerRating) : `<span class="muted small">not yet</span>`}</td>
                  <td data-label="Paid / refunded">${UI.esc(fmtEth(j.released))} / ${UI.esc(fmtEth(j.refunded))}</td></tr>`
                )
                .join("")}</tbody></table></div>`
            : `<p class="muted">No completed jobs yet. Ratings open when every milestone of a job is settled.</p>`
        }</div>
      </div>`;
  }

  // ---------- Explorer + About ----------
  const msRef = (a) => `milestone ${Number(a.index) + 1} of job #${a.jobId}`;
  function formatEvent(e) {
    const a = e.args;
    switch (e.name) {
      case "ArbiterAppointed":
        return `${a.name} appointed to arbiter seat ${Number(a.seat) + 1} by the GigSafe Council`;
      case "UserRegistered":
        return `${a.name} registered as a ${Number(a.role) === ROLE.Client ? "client" : "freelancer"} (permissionless)`;
      case "JobCreated":
        return `${Chain.label(a.client)} posted job #${a.jobId} "${a.title}" for ${Chain.label(a.freelancer)} · ${fmtEth(a.budget)} locked in escrow · ${a.milestones} milestone(s)`;
      case "JobCancelled":
        return `Job #${a.jobId} cancelled before acceptance · ${fmtEth(a.refund)} credited back to the client`;
      case "JobAccepted":
        return `${Chain.label(a.freelancer)} accepted job #${a.jobId}`;
      case "MilestoneSubmitted":
        return `Delivery for ${msRef(a)}${Number(a.revision) ? ` (version ${Number(a.revision) + 1})` : ""} · file hash ${UI.short(a.deliverableHash, 4)}`;
      case "MilestoneApproved":
        return `Client approved ${msRef(a)} · ${fmtEth(a.amount)} released`;
      case "RevisionRequested":
        return `Revision ${a.revisions} requested on ${msRef(a)}: "${a.reason}" · due ${UI.fmtTime(a.newDeadline)}`;
      case "MilestoneAutoReleased":
        return `${msRef(a)[0].toUpperCase()}${msRef(a).slice(1)} auto-released after the review window · ${fmtEth(a.amount)}`;
      case "MilestoneRefunded":
        return `Deadline missed: ${msRef(a)} refunded to the client · ${fmtEth(a.amount)}`;
      case "DisputeRaised":
        return `${Chain.label(a.raisedBy)} disputed ${msRef(a)}: "${a.reason}"`;
      case "DisputeVoted":
        return `${Chain.label(a.arbiter)} voted ${pct(a.freelancerShareBps)} for the freelancer on ${msRef(a)} (${a.votes} of 3 votes)`;
      case "DisputeResolved":
        return `Dispute on ${msRef(a)} settled ${a.byMedian ? "by the median of 3 votes" : "by 2 matching votes"}: ${fmtEth(a.toFreelancer)} to the freelancer, ${fmtEth(a.toClient)} to the client`;
      case "JobCompleted":
        return `Job #${a.jobId} completed · ${fmtEth(a.released)} paid to the freelancer, ${fmtEth(a.refunded)} refunded`;
      case "Rated":
        return `${Chain.label(a.from)} rated ${Chain.label(a.to)} ${a.stars}/5 for job #${a.jobId}`;
      case "Credited":
        return `${fmtEth(a.amount)} credited to ${Chain.label(a.account)} (available to withdraw)`;
      case "Withdrawn":
        return `${Chain.label(a.account)} withdrew ${fmtEth(a.amount)} to their wallet`;
      default:
        return "";
    }
  }

  async function viewExplorer(el) {
    el.innerHTML = `${pageHead(
      "Blockchain Explorer",
      "Every deposit, delivery hash, decision, vote and payout is a transaction in a block. Each block stores the hash of the previous one, so nobody can quietly change what was delivered or agreed."
    )}<div id="explorer-host"></div>`;
    await Explorer.render(el.querySelector("#explorer-host"), { formatEvent });
  }

  async function viewAbout(el) {
    el.innerHTML = `
      ${pageHead("About the project", "GigSafe: a smart contract-based freelance payment escrow with milestone payments, proof of delivery, time-based release, 2-of-3 arbitration and on-chain reputation.")}
      <div class="stack">
        <div class="card">
          <h2>Problem</h2>
          <p style="margin-top:8px">Clients and freelancers who have never met do not trust each other. Freelancers fear doing the work and not being paid; clients fear paying and not getting the work. Platforms hold the money, charge high fees, and decide disputes behind closed doors.</p>
          <h2 style="margin-top:14px">Solution</h2>
          <ul style="margin:8px 0 0;padding-left:18px">
            <li><strong>Money first:</strong> the client deposits the whole budget into a smart contract, split into milestones with deadlines. Neither side can take it alone.</li>
            <li><strong>Proof of delivery:</strong> the freelancer commits the SHA-256 hash of each deliverable. The block time proves when, the hash proves exactly which file.</li>
            <li><strong>No silent clients:</strong> approval releases the money at once; if the client neither approves nor objects within the review window, the freelancer claims it automatically. Missed deadlines refund the client.</li>
            <li><strong>Fair disputes:</strong> three appointed arbiters vote on the split; the contract executes it when two agree (median if all three differ).</li>
            <li><strong>Reputation:</strong> both sides rate each other once per completed job, on-chain.</li>
          </ul>
        </div>
        <div class="card">
          <h2>Syllabus mapping (22CS743)</h2>
          <div class="table-wrap" style="margin-top:8px"><table class="table"><thead><tr><th>Module</th><th>Concept</th><th>Where it is used</th></tr></thead><tbody>
            <tr><td data-label="Module">II</td><td data-label="Concept"><div>Hash functions and commitments, timestamps, consensus by majority / Byzantine agreement, hash-linked blocks</div></td><td data-label="Used in"><div>SHA-256 of every deliverable and of the job brief committed on-chain with the block time; any changed byte is detected (Tamper test). Arbiters reach agreement by 2-of-3 majority, the median rule tolerates one biased arbiter. The explorer checks every block's previous-hash link.</div></td></tr>
            <tr><td data-label="Module">III</td><td data-label="Concept"><div>Ethereum, smart contracts, <code>payable</code>, time-based logic, signed transactions</div></td><td data-label="Used in"><div><code>FreelanceEscrow.sol</code>: <code>createJob</code> is payable and must receive exactly the budget; <code>block.timestamp</code> enforces review windows (auto-release) and deadlines (refund); every action is a transaction signed by the party's own account.</div></td></tr>
            <tr><td data-label="Module">IV</td><td data-label="Concept"><div>Permissioned / consortium governance</div></td><td data-label="Used in"><div>A small permissioned panel: only the GigSafe Council appoints the 3 arbiters, and the panel cannot change while a dispute is open. Clients and freelancers join without permission.</div></td></tr>
            <tr><td data-label="Module">V</td><td data-label="Concept"><div>Smart-contract security, real-world applications</div></td><td data-label="Used in"><div>Pull payments (credit + <code>withdraw()</code>), checks-effects-interactions, a re-entrancy lock (tested with an attack contract), role checks and custom errors. Application: the gig economy, trust and reputation without a middleman.</div></td></tr>
          </tbody></table></div>
        </div>
        <div class="grid-2">
          <div class="card">
            <h2>On-chain vs off-chain</h2>
            <p class="muted small" style="margin-top:6px">Everything on a blockchain is public, so files stay off-chain and only their fingerprints go on-chain.</p>
            <ul style="margin:6px 0 0;padding-left:18px">
              <li><strong>On-chain:</strong> users and roles, arbiter panel, job title, budget, milestone amounts and deadlines, brief hash, deliverable hashes, notes and revision requests, timestamps, disputes and votes, ratings, credited balances.</li>
              <li><strong>Off-chain:</strong> the job brief text and the deliverable files (a simulated file server in this demo). Anyone can check them against the on-chain hashes.</li>
            </ul>
          </div>
          <div class="card">
            <h2>Smart-contract security</h2>
            <ul style="margin:6px 0 0;padding-left:18px">
              <li>Pull payments: business functions only credit balances; ETH leaves only through <code>withdraw()</code>. A recipient that rejects ETH cannot block anyone else.</li>
              <li>Checks-effects-interactions and a re-entrancy lock on <code>withdraw()</code>; the <code>call</code> result is checked.</li>
              <li>Invariant (tested): contract balance = escrowed + credited but not withdrawn.</li>
              <li>Role checks (client, freelancer, arbiter, Council), conflict-of-interest rules and clear custom errors.</li>
            </ul>
          </div>
        </div>
        <div class="card">
          <h2>Technology</h2>
          <ul style="margin:6px 0 0;padding-left:18px">
            <li>Solidity 0.8.24 smart contract, Hardhat (local blockchain + 29 tests, including a re-entrancy attack contract)</li>
            <li>In-browser Ethereum chain (Ganache) for zero-install demos; test ETH only</li>
            <li>ethers.js v6, Web Crypto API (SHA-256); sample deliverables (SVG, text, CSV) generated in the browser</li>
            <li>HTML, CSS and JavaScript (no build step), hosted on GitHub Pages</li>
          </ul>
        </div>
        <div class="card callout-warn">
          <h2>Limitations</h2>
          <ul style="margin:6px 0 0;padding-left:18px">
            <li>A hash proves which file was delivered and when, not that the work is good. Quality disputes still need human arbiters.</li>
            <li>Arbiters are trusted to be independent. A real platform would rotate them, pay them a fee and ask them to stake a deposit.</li>
            <li>Ratings can be gamed if one person controls both a client and a freelancer account; real platforms add identity checks or weight ratings by volume.</li>
            <li>Files are kept in browser storage in the demo. A real system would use IPFS or encrypted cloud storage, and a stablecoin instead of ETH to avoid price swings.</li>
            <li>Job titles, amounts, notes and revision requests are public on-chain; the brief and the files are not.</li>
          </ul>
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------
  Shell.start({
    brand: { name: "GigSafe", tagline: "Freelance payment escrow on blockchain", icon: "coins" },
    timeTravel: true,
    load,
    chain: {
      storageKey: "gigsafe",
      artifact: window.CONTRACT_ARTIFACT,
      errors: ERRORS,
      async isSeeded(chain) {
        const [accts] = await chain.contract.getArbiters();
        return accts[0] !== ethers.ZeroAddress;
      },
      async seed(chain) {
        const A = chain.accounts;
        await chain.send(A[0], "setArbiters", [ARBITERS.map(([i]) => A[i]), ARBITERS.map(([, n]) => n)]);
        for (const [i, name] of CLIENTS) await chain.send(A[i], "registerUser", [ROLE.Client, name]);
        for (const [i, name] of FREELANCERS) await chain.send(A[i], "registerUser", [ROLE.Freelancer, name]);
      },
    },
    routes: [
      { id: "home", title: "Overview", icon: "home", render: viewHome },
      { id: "jobs", title: "Jobs Board", icon: "layers", section: "Public", render: viewJobs },
      { id: "reputation", title: "Reputation", icon: "users", section: "Public", render: viewReputation },
      { id: "client", title: "Client", icon: "building", section: "Roles", render: viewClient },
      { id: "freelancer", title: "Freelancer", icon: "upload", section: "Roles", render: viewFreelancer },
      { id: "arbitration", title: "Arbitration Panel", icon: "shield", section: "Roles", render: viewArbitration },
      { id: "explorer", title: "Blockchain Explorer", icon: "blocks", section: "Investigate", render: viewExplorer },
      { id: "about", title: "About & Syllabus", icon: "book", section: "Project", render: viewAbout },
    ],
  });

  // Exposed for automated tests.
  window.GigApp = {
    postJob,
    acceptJob,
    cancelJob,
    submitDeliverable,
    verifyDeliverable,
    approve,
    requestRevision,
    raiseDispute,
    claim,
    refund,
    vote,
    rate,
    withdraw,
    verifyEvidence,
    load,
    SAMPLE_JOBS,
  };
})();
