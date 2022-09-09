const Long = require("long");
const axios = require("axios");
const moment = require("moment");
const crypto = require("@cosmjs/crypto");
const stargate = require("@cosmjs/stargate");
const { getClient, getConfig, intervals } = require("./helpers");
const config = getConfig();

const getProposalList = async (lcdUrl) => {
    let response = await axios.get(lcdUrl + "cosmos/gov/v1beta1/proposals?proposal_status=2");
    return response.data.proposals
}

const voteOptions = {
    "yes": 1,
    "abstain": 2,
    "no": 3,
    "no_with_veto": 4
}

const getMostPopularVoteOption = async (network, proposalId) => {
    let url = `${network.lcdUrl}cosmos/gov/v1beta1/proposals/${proposalId}/tally`;
    let { data: { tally } } = await axios.get(url);
    let mostVotes = Math.max(tally.yes, tally.no, tally.abstain, tally.no_with_veto);
    let key = Object.keys(tally).find(x => tally[x] === mostVotes.toString())

    return { key: key, option: voteOptions[key] };
}

const getPredefinedVoteOption = (network, proposalId) => {
    let key = network?.votingOptions?.predefinedVotes
        ?.find(x => x.proposalId.toString() === proposalId.toString())
        ?.key;

    return key ? { key, option: voteOptions[key] } : null;
}

const vote = async (network, signer, proposalId, address) => {
    let voteOption =
        getPredefinedVoteOption(network, proposalId) ||
        await getMostPopularVoteOption(network, proposalId);

    let msg = {
        typeUrl: "/cosmos.gov.v1beta1.MsgVote",
        value: {
            proposalId: Long.fromString(proposalId),
            voter: address,
            option: voteOption.option
        }
    }

    console.log(`trying to vote for prop ${proposalId} - ${voteOption.key} from ${address}`);
    return await signer.signAndBroadcast(address, [msg], network?.votingOptions?.votingFee);
}

const processWallet = async (wallet, network, proposals) => {
    let derivationPaths = wallet.indexes
        .map(x => crypto.stringToPath(network.derivationPath + x));

    let client = await getClient(network.rpcUrl, wallet.mnemonic, derivationPaths, network.prefix);
    let addresses = await client.wallet.getAccounts();

    for (let p of proposals)
        for (let a of addresses) {
            try {
                let voteResult = await vote(network, client.signer, p.proposal_id, a.address);
                stargate.assertIsDeliverTxSuccess(voteResult);
                console.log(`${network.prefix}: voting for proposal ${p.proposal_id} success`);
            } catch (err) { console.log(err?.message) }
        }
}

const main = async () => {
    console.log(`${new Date().toLocaleString()} Running voter job`);

    for (let network of config.networks) {
        try {
            let proposals = await getProposalList(network.lcdUrl);

            if (!proposals || proposals.length === 0) {
                console.log(`${network.prefix}: no active proposals`);
                continue;
            }

            proposals = proposals.filter(p => {
                let votingEndTime = moment(p.voting_end_time).utc();
                let now = moment().utc();
                let diff = votingEndTime.diff(now, "hours");
                if (diff > 1) {
                    console.log(`${network.prefix}: proposal ${p.proposal_id} ends in ${diff} hours`);
                    return false;
                }

                return true;
            });

            if (proposals.length === 0)
                continue;

            for (let w of config.wallets)
                await processWallet(w, network, proposals);
        }
        catch (e) {
            console.error(e);
        }
    }
};

main();
setInterval(main, intervals.hour);