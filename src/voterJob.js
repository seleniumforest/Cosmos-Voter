const Long = require("long");
const axios = require("axios");
const config = require("../config.json");
const moment = require("moment");
const crypto = require("@cosmjs/crypto");
const stargate = require("@cosmjs/stargate");
const { createLogger, getClient } = require("./helpers");

const log = createLogger("voter.log");
const getProposalList = async (lcdUrl) =>
    (await axios.get(lcdUrl + "/cosmos/gov/v1beta1/proposals?proposal_status=2"))
        .data
        .proposals;

const voteOptions = {
    "yes": 1,
    "abstain": 2,
    "no": 3,
    "no_with_veto": 4
}

const getMostPopularVoteOption = (network, proposalId) => {
    let url = `${network.lcdUrl}cosmos/gov/v1beta1/proposals/${proposalId}/tally`;
    let tally = (await axios.get(url)).data.tally;
    let mostVotes = Math.max(tally.yes, tally.no, tally.abstain, tally.no_with_veto);
    let key = Object.keys(tally).find(x => tally[x] === mostVotes.toString())

    return { key: key, option: voteOptions[key] };
}

const getPredefinedVoteOption = (network, proposalId) => {
    let key = network?.predefinedVotes?.find(x => x.proposalId.toString() === proposalId.toString())?.key;
    if (!key) return;

    return { key, option: voteOptions[key] }
}

const vote = async (network, signer, proposalId, address) => {
    let voteOption = getPredefinedVoteOption(network, proposalId) ||
                await getMostPopularVoteOption(network, proposalId);

    let msg = {
        typeUrl: "/cosmos.gov.v1beta1.MsgVote",
        value: {
            proposalId: Long.fromString(proposalId),
            voter: address,
            option: voteOption.option
        }
    }

    log.info(`trying to vote for prop ${proposalId} - ${voteOption.key} from ${address}`);
    return await signer.signAndBroadcast(address, [msg], network.votingFee);
}

const processWallet = async (wallet, network, proposals) => {
    let derivationPaths = wallet
        .indexes
        .map(x => crypto.stringToPath(network.derivationPath + x));

    let client = await
        getClient(network.rpcUrl, wallet.mnemonic, derivationPaths, network.prefix);
    let addresses = await client.wallet.getAccounts();

    for (let p of proposals) {
        for (let a of addresses) {
            let voteResult = await
                vote(network, client.signer, p.proposal_id, a.address);

            try {
                stargate.assertIsDeliverTxSuccess(voteResult);
                log.info(`${network.prefix}: voting for proposal ${p.proposal_id} success`);
            }
            catch (e) {
                log.error(e);
            }
        }
    }
}

const main = async () => {
    let wallets = config.wallets;
    let networks = config.networks;

    if (!(wallets instanceof Array) || wallets.length === 0)
        log.error("no wallets found");
    if (!(networks instanceof Array) || networks.length === 0)
        log.error("no networks found");

    for (let n of networks) {
        let proposals = (await getProposalList(n.lcdUrl));

        if (!proposals || proposals.length === 0) {
            log.info(`${n.prefix}: no active proposals`);
            continue;
        }

        proposals = proposals.filter(p => {
            let votingEndTime = moment(p.voting_end_time).utc();
            let now = moment().utc();
            let diff = votingEndTime.diff(now, "hours");
            if (diff > 1) {
                log.info(`${n.prefix}: proposal ${p.proposal_id} ends in ${diff} hours`);
                return false;
            }
            else
                return true;
        });

        for (let w of wallets)
            await processWallet(w, n, proposals);
    }
}

const _main = async () => {
    try {
        await main();
    }
    catch (e) {
        log.error(e);
    }
}

_main();
setInterval(_main, 60 * 60 * 1000);