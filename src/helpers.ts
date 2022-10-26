import { NetworkConfig, Vote } from "./config";

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