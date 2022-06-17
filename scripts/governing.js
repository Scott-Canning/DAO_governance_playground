
const { ethers } = require("hardhat");

async function getBlockTimestamp() {
    let blockNum = await ethers.provider.getBlockNumber();
    let block = await ethers.provider.getBlock(blockNum);
    console.log("   blockNum: ", blockNum);
    return block.timestamp;
}

async function main () {
    const interval = 14;
    let blockNum = await ethers.provider.getBlockNumber();
    let block = await ethers.provider.getBlock(blockNum);
    let timestamp = block.timestamp;
    let propState = [
                    "Pending",
                    "Active",
                    "Canceled",
                    "Defeated",
                    "Succeeded",
                    "Queued",
                    "Expired",
                    "Executed"
                    ]

    const [ signer1, signer2 ] = await ethers.getSigners();

    // Deploy governance token
    const GovToken = await ethers.getContractFactory("GovToken");
    const govToken = await GovToken.deploy();
    await govToken.deployed();
    
    // Deploy timelock contract
    const Timelock = await ethers.getContractFactory("@openzeppelin/contracts/governance/TimelockController.sol:TimelockController");
    const timelock = await Timelock.deploy(1, [], []);
    await timelock.deployed();

    // Deploy governor contract
    const Governor = await ethers.getContractFactory("MyGovernor");
    const governor = await Governor.deploy(govToken.address, timelock.address);
    await governor.deployed();
    
    // Get voting configuration from governor contract
    const votingDelay = ethers.BigNumber.from(await governor.votingDelay()).toNumber();
    const votingPeriod = ethers.BigNumber.from(await governor.votingPeriod()).toNumber()

    // Deploy ERC20 source token
    const SourceToken = await ethers.getContractFactory("SourceToken");
    const sourceToken = await SourceToken.deploy();
    await sourceToken.deployed();

    // Signer 1 transfers full supply of source token to the timelock
    const transferAmount1 = ethers.utils.parseUnits("100000000", 18);
    await sourceToken.transfer(timelock.address, transferAmount1);

    // Governor is proposer, anyone can execute, timelock is self-administrated
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), governor.address);
    await timelock.grantRole(await timelock.EXECUTOR_ROLE(), '0x0000000000000000000000000000000000000000');
    await timelock.revokeRole(await timelock.TIMELOCK_ADMIN_ROLE(), signer1.address);

    // Pre-proposal balances
    const srcTkn_GovBalance = await sourceToken.balanceOf(governor.address);
    const f_srcTkn_GovBalance = ethers.utils.formatUnits(srcTkn_GovBalance, 18);
    
    let srcTkn_Signer2Balance = await sourceToken.balanceOf(signer2.address);
    let f_srcTkn_Signer2Balance = ethers.utils.formatUnits(srcTkn_Signer2Balance, 18);

    const govTok_Signer1Balance = await govToken.balanceOf(signer1.address);
    const f_govTok_Signer1Balance = ethers.utils.formatUnits(govTok_Signer1Balance, 18);

    console.log("   --------------------------------------------");
    console.log("   GovToken: ", govToken.address);
    console.log("   Governor: ", governor.address);
    console.log("   TimeLock: ", timelock.address);
    console.log("   SourceToken: ", sourceToken.address);
    console.log("   Governor SourceToken balance: ", ethers.utils.commify(f_srcTkn_GovBalance));
    console.log("   Signer2 SourceToken balance BEFORE vote: ", ethers.utils.commify(f_srcTkn_Signer2Balance));
    console.log("   Signer1 GovToken balance: ", ethers.utils.commify(f_govTok_Signer1Balance)); 
    console.log("   --------------------------------------------");

    // Signer 1 self-delegates voting power
    await govToken.delegate(signer1.address, { from: signer1.address })

    // Generate proposal call data to grant 1_000_000 source tokens to Signer 2
    const tokenAddress = sourceToken.address;
    const token = await ethers.getContractAt('ERC20', tokenAddress);
    const teamAddress = signer2.address;
    const grant = 1_000_000;
    const grantAmount = ethers.utils.parseUnits(grant.toString(), 18);
    const transferCalldata = token.interface.encodeFunctionData("transfer", [teamAddress, grantAmount]);
    await getBlockTimestamp();

    // Propose transaction
    const proposeTx = await governor.propose([tokenAddress],
                                            [0],
                                            [transferCalldata],
                                            "Proposal #1: Give grant to signer 2",
                                            );
    const proposeReceipt = await proposeTx.wait(1);
    const proposalId = proposeReceipt.events[0].args.proposalId;
    console.log("   *propose()*");
            
    /*
        The proposal id is produced by hashing the RLC encoded targets array, 
        the values array, the calldatas array and the descriptionHash (bytes32 
        which itself is the keccak256 hash of the description string). This
        proposal id can be produced from the proposal data which is part of the 
        ProposalCreated event. It can even be computed in advance, before the 
        proposal is submitted.

        Note that the chainId and the governor address are not part of the 
        proposal id computation. Consequently, the same proposal (with same 
        operation and same description) will have the same id if submitted on 
        multiple governors across multiple networks. This also means that in 
        order to execute the same operation twice (on the same governor) the 
        proposer will have to change the description in order to avoid proposal 
        id conflicts.
    */
    
    // Advance time forward 1 block to allow voting
    timestamp = await getBlockTimestamp();
    let endTimestamp = timestamp + (votingDelay * interval)
    while(timestamp <= endTimestamp) {
        await ethers.provider.send('evm_increaseTime', [interval]);
        await ethers.provider.send('evm_mine');
        timestamp = await getBlockTimestamp();
    }
    
    // Signer 1 votes
    console.log("   *voteCast()*");
    await governor.connect(signer1).castVote(proposalId, 1);

    // Advance time forward 'votingPeriod' number of blocks
    endTimestamp = timestamp + (votingPeriod * interval);
    while(timestamp <= endTimestamp) {
        await ethers.provider.send('evm_increaseTime', [interval]);
        await ethers.provider.send('evm_mine');
        timestamp = await getBlockTimestamp();
    }
    
    // Gather proposal state information
    let voteCount = await governor.proposalVotes(proposalId);
    const [againstVotes, forVotes, abstainVotes] = voteCount;
    let state = await governor.state(proposalId);
    let proposalSnapshot = ethers.BigNumber.from(await governor.proposalSnapshot(proposalId)).toString();
    let proposalDeadline = ethers.BigNumber.from(await governor.proposalDeadline(proposalId)).toString();
    let proposalThreshold = ethers.BigNumber.from(await governor.proposalThreshold()).toString();

    /*
        proposalSnapshot():
        Block number used to retrieve user’s votes and quorum. As per Compound’s Comp and 
        OpenZeppelin’s ERC20Votes, the snapshot is performed at the end of this block. 
        Hence, voting for this proposal starts at the beginning of the following block

        proposalDeadline():
        Block number at which votes close. Votes close at the end of this block, so it is 
        possible to cast a vote during this block.
    */

    console.log("   --------------------------------------------");
    console.log("   Against: ", ethers.utils.commify(ethers.utils.formatUnits(againstVotes, 18)),
                "\n   For:     ", ethers.utils.commify(ethers.utils.formatUnits(forVotes, 18)),
                "\n   Abstain: ", ethers.utils.commify(ethers.utils.formatUnits(abstainVotes, 18)));
    console.log("   State:   ", propState[state]);
    console.log("   Proposal Snapshot: ", proposalSnapshot);
    console.log("   Proposal Deadline: ", proposalDeadline);
    console.log("   Proposal Threshold: ", proposalThreshold);
    console.log("   --------------------------------------------");

    // Queue proposal in timelock
    const descriptionHash = ethers.utils.id("Proposal #1: Give grant to signer 2");
    console.log("   *queue()*");
    await governor.queue([tokenAddress], [0], [transferCalldata], descriptionHash,);
    await getBlockTimestamp()

    // Execute proposal
    console.log("   *execute()*");
    await governor.execute([tokenAddress], [0],[transferCalldata], descriptionHash,);
    await getBlockTimestamp()

    // Post-proposal execution balance
    srcTkn_Signer2Balance = await sourceToken.balanceOf(signer2.address);
    f_srcTkn_Signer2Balance = ethers.utils.formatUnits(srcTkn_Signer2Balance, 18);
    console.log("   Signer2 SourceToken balance AFTER vote: ", ethers.utils.commify(f_srcTkn_Signer2Balance));
        
};

main()
.then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
});