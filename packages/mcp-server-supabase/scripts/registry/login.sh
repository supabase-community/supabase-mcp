#!/bin/bash

# Check for DOMAIN_VERIFICATION_KEY environment variable first
if [ -n "$DOMAIN_VERIFICATION_KEY" ]; then
  # Use the PEM content from environment variable
  PRIVATE_KEY_HEX=$(echo "$DOMAIN_VERIFICATION_KEY" | openssl pkey -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')
else
  # Default to reading from file
  PRIVATE_KEY_PATH=domain-verification-key.pem
  PRIVATE_KEY_HEX=$(openssl pkey -in $PRIVATE_KEY_PATH -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')
fi

mcp-publisher login http \
  --domain supabase.com \
  --private-key=$PRIVATE_KEY_HEX
