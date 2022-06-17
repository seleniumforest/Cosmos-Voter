# Cosmos-Voter
Script for auto-voting on Cosmos SDK networks.

Rename config.json.example to config.json and edit this file as you need. 
Wallet indexes means an last digit in derivation path, i.e. account index generated from seed

Run ``` npm install ``` 

and then ``` node src/jobYouNeed.js ```

or to run all the jobs ``` npm run runall  ```

# todo

[x] dont check proposals multiple times for every wallet

make logs prettier

[x] add restaking feature

[started] refactor - split script into multiple files

add networks - [x] cosmoshub, [x] juno, secret, terra, evmos
