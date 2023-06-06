#!/bin/bash

npx hardhat run ./scripts/generateABI.js
npx typechain --target ethers-v5 --out-dir typechain './abi/*.json'

if [ -e ../frontend/src/abi ]
    then rm -r ../frontend/src/abi
fi

if [ -e ../frontend/src/typechain ]
    then rm -r ../frontend/src/typechain
fi

cp -r ./abi ../frontend/src
cp -r ./typechain ../frontend/src

