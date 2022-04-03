const Long = require("long");
const { Registry } = require("@cosmjs/proto-signing");
const axios = require("axios");
const config = require("./config.json");
const moment = require("moment");
const proto_signing = require("@cosmjs/proto-signing");
const crypto = require("@cosmjs/crypto");
const stargate = require("@cosmjs/stargate");

const getProposalList = async (lcdUrl) =>
    (await axios.get(lcdUrl + "/cosmos/gov/v1beta1/proposals?proposal_status=2")).data.proposals;

const vote = async (rpc, signer, proposalId, address) => {

    let url = rpc + `cosmos/gov/v1beta1/proposals/${proposalId}/tally`;
    let tally = (await axios.get(url)).data.tally;
    let mostVotes = Math.max(tally.yes, tally.no, tally.abstain, tally.no_with_veto);
    let key = Object.keys(tally).find(x => tally[x] === mostVotes.toString())

    let option = 0;
    switch (key) {
        case "yes": option = 1; break;
        case "no": option = 3; break;
        case "abstain": option = 2; break;
        case "no_with_veto": option = 4; break;
    }

    let msg = {
        typeUrl: "/cosmos.gov.v1beta1.MsgVote",
        value: {
            proposalId: Long.fromString(proposalId),
            voter: address,
            option: option
        }
    }

    let fee = {
        gas: "250000",
        amount: [
            {
                denom: "uosmo",
                amount: "6250"
            }
        ]
    }

    console.log(`trying to vote for prop ${proposalId} from ${address} rpc ${rpc}`);
    return await signer.signAndBroadcast(address, msg, fee);
}

const getClient = async (rpc, mnemonic, hdPaths, prefix) => {
    const wallet = await proto_signing.DirectSecp256k1HdWallet.fromMnemonic(
        mnemonic,
        { hdPaths, prefix }
    );

    const signer = await stargate.SigningStargateClient.connectWithSigner(
        rpc,
        wallet,
        { registry: new Registry(stargate.defaultRegistryTypes) }
    );

    return { signer, wallet }
}

const processWallet = async (wallet, network) => {
    let derivationPaths = wallet.indexes.map(x => crypto.stringToPath(network.derivationPath + x));
    let client = await getClient(network.rpcUrl, wallet.mnemonic, derivationPaths, network.prefix);
    let proposals = await getProposalList(network.lcdUrl);
    let addresses = await client.wallet.getAccounts();

    for (let p of proposals) {
        let votingEndTime = moment(p.voting_end_time).utc();
        let now = moment().utc();
        let diff = votingEndTime.diff(now, "hours");
        if (diff > 2) {
            console.log(`proposal ${p.proposal_id} ends in ${diff} hours`)
            continue;
        }

        for (let a of addresses) {
            let voteResult = await vote(network.lcdUrl, client.signer, p.proposal_id, a.address);
        }
    }
}

const main = async () => {
    let wallets = config.wallets;
    let networks = config.networks;

    for (let w of wallets)
        for (let n of networks)
            await processWallet(w, n);
}

//main();
setInterval(() => main(), 1000 * 60 * 3600)