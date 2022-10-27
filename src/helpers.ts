import { Registry, DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { defaultRegistryTypes, GasPrice, SigningStargateClient } from "@cosmjs/stargate";
import { NetworkConfig, Vote } from "./config";

export const getSigner = async (endpoint: string, wallet: DirectSecp256k1HdWallet) =>
    await SigningStargateClient.connectWithSigner(
        endpoint,
        wallet,
        { registry: new Registry(defaultRegistryTypes) }
    );

export const shortAddress = (addr: string, start = 9, end = 4) =>
    `${addr.slice(0, start)}...${addr.slice(addr.length - end, addr.length)}`;

export enum VoteOption {
    yes = 1,
    abstain = 2,
    no = 3,
    no_with_veto = 4
}

const getPredefinedVoteOption = (network: NetworkConfig, proposalId: string): Vote | undefined =>
    network.votingOptions.predefinedVotes.find(x => x.proposalId === proposalId);

let minute = 1000 * 60;
let hour = minute * 60;
let day = hour * 24;

export const Intervals = {
    minute,
    hour,
    day
}

export default getPredefinedVoteOption