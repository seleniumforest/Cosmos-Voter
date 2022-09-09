# Cosmos-Voter
Script for auto-voting on Cosmos SDK networks.

Rename config.json.example to config.json and edit this file as you need. 
Wallet indexes means an last digit in derivation path, i.e. account index generated from seed.
Voter will choose most popular option at the end of voting. It can be predefined in configuration (see example)

Run ``` npm install ``` 

and then ``` node src/jobYouNeed.js ```

or to run all the jobs ``` npm run runall  ``` or ``` pm2 start ecosystem.config.js  ```

# todo

[x] fix evmos errors

[x] dont check proposals multiple times for every wallet

make logs prettier

[x] add restaking feature

[started] refactor - split script into multiple files

add networks - [x] cosmoshub, [x] juno, [x] secret, terra, [x] evmos, stars

feature to harvest rewards to one account

feature to restake from jailed or inactive validators for a long time

telegram bot integration
