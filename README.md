# Cosmos-Voter
Script for auto-voting on Cosmos SDK networks.

Rename config.json.example to config.json and edit this file as you need. 
Wallet indexes means an last digit in derivation path, i.e. account index generated from seed.
Voter will choose most popular option at the end of voting. It can be predefined in configuration (see example)

Run 

``` yarn install ``` and ``` tsc ```

then ``` node build/src/jobYouNeed.js ```

or to run all the jobs ``` yarn run runall  ``` or ``` pm2 start ecosystem.config.js  ```

# TODO

Create reward collector, make promises work in parallel 