#!/bin/bash

# @echo off
# :loop
# node index.js
# goto loop

while true; do
    # Start the node server and log to /tmp/node.log
    node index.js >> /tmp/node.log 2>&1
    sleep 1
done
