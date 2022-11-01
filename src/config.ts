import { coin, StdFee } from "@cosmjs/stargate";
import { Fee as EvmosFee } from "@tharsis/transactions";

export const getConfig = async (): Promise<AppConfig> => {
    let config = await import("../config.json");

    return {
        wallets: config.wallets,
        networks: config.networks.map(net => ({
            ...net,
            votingOptions: {
                predefinedVotes: ((net.votingOptions as any)?.predefinedVotes || [])
                    .map((vote: any) => ({ proposalId: vote.proposalId, option: vote.option as unknown as VoteOption })),
                votingFee: net.votingOptions.votingFee as Fee
            },
            restakeOptions: {
                ...net.restakeOptions,
                claimFee: net.restakeOptions.claimFee as Fee,
                delegateFee: net.restakeOptions.delegateFee as Fee
            }
        }))
    }
}

export interface AppConfig {
    wallets: Wallet[],
    networks: NetworkConfig[]
}

export type Wallet = {
    mnemonic: string,
    indexes: Array<Number>
}

export type Fee = [gas: string, denom: string, amount: string];

export const toEvmosFee = (fee: Fee): EvmosFee => {
    return {
        gas: fee[0],
        amount: fee[2],
        denom: fee[1]
    }
}

export const toFeeObject = (fee: Fee): StdFee => {
    return {
        gas: fee[0],
        amount: [coin(fee[2], fee[1])]
    }
}

export enum VoteOption {
    yes = 1,
    abstain = 2,
    no = 3,
    no_with_veto = 4
}

export type Vote = {
    proposalId: string,
    option: VoteOption
}

export interface NetworkConfig {
    prefix: string,
    name: string,
    derivationPath: string,
    votingOptions: {
        votingFee: Fee,
        predefinedVotes: Vote[]
    },
    restakeOptions: {
        minRestakeAmount: string,
        minWalletBalance: string,
        denom: string,
        claimFee: Fee,
        delegateFee: Fee
    }
}