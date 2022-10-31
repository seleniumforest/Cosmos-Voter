import Long from "long";
import { ApiManager, Proposal } from "./api/apiManager";
import { stringToPath } from "@cosmjs/crypto";

import { Network } from "./api/constants";
import { EndpointType } from "./api/networkManager";
import { getConfig, NetworkConfig, toFeeObject, Vote, VoteOption, Wallet } from "./config";

import moment from "moment";
import { DirectSecp256k1HdWallet as HdWallet } from "@cosmjs/proto-signing";
import getPredefinedVoteOption, { getSigner, Intervals } from "./helpers";

const getMostPopularVoteOption = async (apiManager: ApiManager, proposalId: string): Promise<Vote | undefined> => {
    let tally = await apiManager.getVoteTally(proposalId);
    if (!tally)
        return;

    let mostVotes = Math.max(tally.yes, tally.no, tally.abstain, tally.no_with_veto);
    let key = Object.keys(tally).find(x => tally![x as keyof typeof tally] === mostVotes.toString())!

    return { proposalId: proposalId, option: VoteOption[key as keyof typeof VoteOption] };
}

const vote = async (prop: Proposal, addr: string, apiManager: ApiManager, wallet: HdWallet, network: NetworkConfig) => {
    let endpoints = apiManager.manager.getEndpoints(EndpointType.RPC);
    let voteOption = (getPredefinedVoteOption(network, prop.proposal_id) ||
        await getMostPopularVoteOption(apiManager, prop.proposal_id))!;

    for (let endp of endpoints) {
        let signer = await getSigner(endp, wallet);

        let msg = {
            typeUrl: "/cosmos.gov.v1beta1.MsgVote",
            value: {
                proposalId: Long.fromString(prop.proposal_id),
                voter: addr,
                option: voteOption.option
            }
        }

        console.log(`trying to vote for prop ${prop.proposal_id} - ${voteOption.option} from ${addr}`);
        let txResult = await signer.signAndBroadcast(addr, [msg], toFeeObject(network.votingOptions.votingFee));
        if (txResult.code === 0) {
            console.log(`${network.prefix}: voting for proposal ${prop.proposal_id} success`);
            break;
        }
        else
            console.log(`${network.prefix}: voting for proposal ${prop.proposal_id} failed with code ${txResult.code}`);
    }
}

const processWallet = async (wallet: Wallet, network: NetworkConfig, apiManager: ApiManager, proposals: Proposal[]) => {
    let derivationPaths = wallet.indexes.map(x => stringToPath(network.derivationPath + x));
    let walletObj = await HdWallet.fromMnemonic(wallet.mnemonic, { hdPaths: derivationPaths, prefix: network.prefix });
    let addresses = await walletObj.getAccounts();

    for (let prop of proposals)
        for (let addr of addresses)
            await vote(prop, addr.address, apiManager, walletObj, network);

}

const processNetwork = async (apiManager: ApiManager, network: NetworkConfig, wallets: Wallet[]) => {
    let proposals = await apiManager.getActiveProposals();

    if (!proposals || proposals.length === 0) {
        console.log(`${network.name}: no active proposals`);
        return;
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
        return;

    for (let wallet of wallets)
        await processWallet(wallet, network, apiManager, proposals);
}

const main = async () => {
    console.log(`${new Date().toLocaleString()} Running voter job`);
    let config = await getConfig();

    for (let network of config.networks) {
        try {
            let apiManager = await ApiManager.createApiManager(network.name as Network);
            await processNetwork(apiManager, network, config.wallets);
        } catch (err) { console.error(err) }
    }

    console.log("finished")
};

main();
setInterval(main, Intervals.hour);