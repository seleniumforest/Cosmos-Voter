# Cosmos-Voter
Script to auto-voting on Cosmos SDK networks.

Add mnemonics and account indexes to config 
```
"wallets": [
        { 
            "mnemonic": "12 seed words",
            "indexes": [0, 1, 2]
        },
        { 
            "mnemonic": "another 12 seed words",
            "indexes": [0, 1]
        }
]
```
Run ``` npm install ``` 

and then ``` node index ```

todo:

dont check proposals multiple times for every wallet

add restaking feature

add networks - cosmoshub, juno, secret, terra
