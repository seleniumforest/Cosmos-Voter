const Long = require("long");
const { Registry } = require("@cosmjs/proto-signing");
const axios = require("axios");
const config = require("./config.json");
const moment = require("moment");
const proto_signing = require("@cosmjs/proto-signing");
const crypto = require("@cosmjs/crypto");
const stargate = require("@cosmjs/stargate");

const log = require('simple-node-logger').createSimpleLogger({
    logFilePath: 'mylogfile.log',
    timestampFormat: 'MM-DD HH:MM'
});

const getProposalList = async (lcdUrl) =>
    (await axios.get(lcdUrl + "/cosmos/gov/v1beta1/proposals?proposal_status=2"))
        .data
        .proposals;

const vote = async (network, signer, proposalId, address) => {
    let url = `${network.lcdUrl}cosmos/gov/v1beta1/proposals/${proposalId}/tally`;
    let tally = (await axios.get(url)).data.tally;
    let mostVotes = Math.max(tally.yes, tally.no, tally.abstain, tally.no_with_veto);
    let key = Object.keys(tally).find(x => tally[x] === mostVotes.toString())

    let option = -1;
    switch (key) {
        case "yes": option = 1; break;
        case "abstain": option = 2; break;
        case "no": option = 3; break;
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

    log.info(`trying to vote for prop ${proposalId} - ${key} from ${address}`);
    return await signer.signAndBroadcast(address, [msg], network.votingFee);
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